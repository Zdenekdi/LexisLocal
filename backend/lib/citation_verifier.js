/**
 * LexisLocal — Citation Verifier
 * ------------------------------------------------------------------
 * Deterministická (NE-AI) ověřovací vrstva. Bere odpověď modelu a každou
 * právní citaci (§, "zákon č. X/Y Sb.", spisové značky) ověří proti:
 *   (a) vytaženým RAG chunkům  → objevila se citace / citát v kontextu?
 *   (b) referenčnímu indexu    → existuje ten § v daném zákoně? je sp. zn. známá?
 *
 * Filozofie: model je NEDŮVĚRYHODNÝ. Důvěřujeme až tomuto verifieru.
 * Cokoli, co nelze ověřit, se označí (nebo odstraní) DŘÍV, než to uvidí advokát.
 *
 * Zero-dependency, CommonJS — v souladu se zbytkem backendu.
 *
 * ⚠️ Co tento modul ZARUČUJE: model neprotlačí § ani sp. zn., které
 *    neexistují nebo nebyly v podkladech (falešné citace a falešné doslovné
 *    citáty). Co NEZARUČUJE: že správně pochopí správně citovaný paragraf —
 *    to odchytí až člověk (human-in-the-loop).
 */

'use strict';

// ── Normalizace ────────────────────────────────────────────────────────────

/** Sjednotí bílé znaky a nedělitelné mezery, ať porovnání sedí. */
function normalizeWhitespace(str) {
    return String(str || '')
        .replace(/ /g, ' ')      // nbsp → mezera
        .replace(/\s+/g, ' ')
        .trim();
}

/** Normalizace pro porovnání citace (case-insensitive, sjednocené mezery). */
function normalizeCitation(str) {
    return normalizeWhitespace(str)
        .toLowerCase()
        .replace(/\s*\.\s*/g, '. ')   // "č.89" i "č. 89" → stejně
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Extrakce citací z volného textu ────────────────────────────────────────
// Záměrně parsujeme volný text (ne strukturovaný JSON), protože slabé 3B modely
// strukturu spolehlivě nedodrží. Strukturovaný kontrakt [[C1]] je bonus navíc.

// Zákon: "zákon č. 89/2012 Sb.", "zákona č. 40/2009 Sb."
const RE_ZAKON = /zákon(?:a|em|u|ě)?\s+č\.?\s*(\d{1,4})\/(\d{4})\s*Sb\./gi;

// Paragraf: "§ 2048", "§2048", "§ 2048 odst. 2 písm. a)", i rozsah "§ 2079 a násl."
const RE_PARAGRAF = /§\s?(\d+[a-z]?)(\s*odst\.\s*\d+)?(\s*písm\.\s*[a-z]\))?/gi;

// Spisová značka soudu (heuristika pokrývající běžné české formáty):
//   "26 Cdo 1230/2021", "II. ÚS 2168/07", "8 Afs 21/2009", "Pl. ÚS 19/08"
// Volitelný úvodní senát: arabské číslo (obecné soudy) NEBO římská číslice (ÚS).
const RE_SPISOVA_ZNACKA =
    /\b(?:\d{1,3}\s+|[IVX]{1,4}\.?\s+)?(?:Pl\.\s*ÚS|ÚS|Cdo|Tdo|Odo|Afs|As|Ads|Azs|Ao|Aps|Ncu|Nd|Konf|Cdon|Co|Tz|Nt)\s+\d+\/\d{2,4}\b/g;

/**
 * Vytáhne z textu všechny právní citace a jejich pozici.
 * @returns {Array<{raw, type, index, law?, paragraph?}>}
 */
function extractCitations(text) {
    const src = String(text || '');
    const found = [];

    let m;
    RE_ZAKON.lastIndex = 0;
    while ((m = RE_ZAKON.exec(src)) !== null) {
        found.push({
            raw: normalizeWhitespace(m[0]),
            type: 'zakon',
            index: m.index,
            law: `${m[1]}/${m[2]}`
        });
    }

    RE_PARAGRAF.lastIndex = 0;
    while ((m = RE_PARAGRAF.exec(src)) !== null) {
        found.push({
            raw: normalizeWhitespace(m[0]),
            type: 'paragraf',
            index: m.index,
            paragraph: m[1].toLowerCase()
        });
    }

    RE_SPISOVA_ZNACKA.lastIndex = 0;
    while ((m = RE_SPISOVA_ZNACKA.exec(src)) !== null) {
        found.push({
            raw: normalizeWhitespace(m[0]),
            type: 'judikat',
            index: m.index
        });
    }

    // Přiřadí každému paragrafu nejbližší PŘEDCHÁZEJÍCÍ zákon (běžný zápis
    // "§ 2048 zákona č. 89/2012 Sb." i "podle zákona č. 89/2012 Sb. v § 2048").
    const laws = found.filter(c => c.type === 'zakon').sort((a, b) => a.index - b.index);
    for (const c of found) {
        if (c.type !== 'paragraf') continue;
        let nearest = null;
        for (const law of laws) {
            if (law.index <= c.index) nearest = law;
        }
        // Fallback: pokud žádný zákon nepředchází, vezmi nejbližší následující.
        if (!nearest && laws.length) nearest = laws[0];
        c.law = nearest ? nearest.law : null;
    }

    return found.sort((a, b) => a.index - b.index);
}

// ── Referenční index ───────────────────────────────────────────────────────
// Autoritativní mapa "co existuje". Naplní se při ingestu zákonů/judikatury.
// Struktura:
//   {
//     laws: { "89/2012": Set<"2048","2079",...>, ... },   // platné paragrafy
//     caseNumbers: Set<"26 cdo 1230/2021", ...>            // známé sp. zn. (normalizované)
//   }
// Když je index prázdný/chybí, verifier degraduje na ověření "bylo to v kontextu?".

function buildEmptyReferenceIndex() {
    return { laws: {}, caseNumbers: new Set() };
}

/**
 * Ověří jednu citaci proti kontextu i referenci.
 * @returns {{status, reason}} status ∈
 *   verified | unsupported_by_context | not_in_reference | unverified_case | no_reference_context_ok
 */
function verifyOne(citation, contextNorm, referenceIndex) {
    const rawNorm = normalizeCitation(citation.raw);
    const inContext = contextNorm.includes(rawNorm);

    const hasReference =
        referenceIndex &&
        ((referenceIndex.laws && Object.keys(referenceIndex.laws).length > 0) ||
         (referenceIndex.caseNumbers && referenceIndex.caseNumbers.size > 0));

    // 1) Judikatura — nejrizikovější, nejpřísnější.
    if (citation.type === 'judikat') {
        const key = normalizeCitation(citation.raw);
        if (referenceIndex && referenceIndex.caseNumbers && referenceIndex.caseNumbers.size > 0) {
            if (referenceIndex.caseNumbers.has(key)) return { status: 'verified', reason: 'sp. zn. je v referenčním indexu' };
            if (inContext) return { status: 'verified', reason: 'sp. zn. je doslovně v podkladech' };
            return { status: 'unverified_case', reason: 'sp. zn. není v indexu ani v podkladech' };
        }
        // Bez indexu judikatury: jediná opora je doslovný výskyt v podkladech.
        return inContext
            ? { status: 'verified', reason: 'sp. zn. je doslovně v podkladech' }
            : { status: 'unverified_case', reason: 'sp. zn. nelze ověřit (chybí index i výskyt v podkladech)' };
    }

    // 2) Zákon jako celek.
    if (citation.type === 'zakon') {
        if (referenceIndex && referenceIndex.laws && referenceIndex.laws[citation.law]) {
            return { status: 'verified', reason: 'zákon existuje v referenčním indexu' };
        }
        if (hasReference) {
            return { status: 'not_in_reference', reason: `zákon č. ${citation.law} Sb. není v referenčním indexu` };
        }
        return inContext
            ? { status: 'verified', reason: 'odkaz na zákon je v podkladech' }
            : { status: 'no_reference_context_ok', reason: 'bez indexu nelze existenci zákona ověřit' };
    }

    // 3) Paragraf (+ navázaný zákon).
    if (citation.type === 'paragraf') {
        const lawSet = citation.law && referenceIndex && referenceIndex.laws
            ? referenceIndex.laws[citation.law]
            : null;
        if (lawSet) {
            if (lawSet.has(citation.paragraph)) return { status: 'verified', reason: 'paragraf existuje v daném zákoně' };
            return { status: 'not_in_reference', reason: `§ ${citation.paragraph} v zákoně č. ${citation.law} Sb. neexistuje` };
        }
        // Reference pro tento zákon nemáme → opíráme se o kontext.
        if (inContext) return { status: 'verified', reason: 'paragraf je doslovně v podkladech' };
        if (hasReference && citation.law) {
            return { status: 'not_in_reference', reason: `zákon č. ${citation.law} Sb. není indexován` };
        }
        return { status: 'unsupported_by_context', reason: 'paragraf není v podkladech a nelze ho ověřit v referenci' };
    }

    return { status: 'unsupported_by_context', reason: 'neznámý typ citace' };
}

/**
 * Hlavní API. Ověří všechny citace v odpovědi.
 * @param {string} text            Odpověď modelu.
 * @param {object} opts
 * @param {Array}  opts.contextChunks  Vytažené RAG pasáže: [{text, sourceId?, fileName?}]
 * @param {object} opts.referenceIndex Autoritativní index (viz buildEmptyReferenceIndex).
 * @param {boolean} opts.strict        V strict módu se neověřené citace považují za blokující.
 * @returns {{
 *   ok, citations, counts, hallucinationRate, unverified, annotatedText
 * }}
 */
function verifyCitations(text, opts = {}) {
    const contextChunks = Array.isArray(opts.contextChunks) ? opts.contextChunks : [];
    const referenceIndex = opts.referenceIndex || buildEmptyReferenceIndex();
    const strict = !!opts.strict;

    const contextNorm = normalizeCitation(
        contextChunks.map(c => (c && c.text) ? c.text : '').join('\n')
    );

    const raw = extractCitations(text);
    const citations = raw.map(c => {
        const res = verifyOne(c, contextNorm, referenceIndex);
        // Dohledá, ve kterém chunku citace je (pro odkaz v UI).
        let sourceId = null;
        const rawNorm = normalizeCitation(c.raw);
        for (const chunk of contextChunks) {
            if (chunk && chunk.text && normalizeCitation(chunk.text).includes(rawNorm)) {
                sourceId = chunk.sourceId || chunk.fileName || null;
                break;
            }
        }
        return {
            raw: c.raw,
            type: c.type,
            law: c.law || null,
            paragraph: c.paragraph || null,
            status: res.status,
            reason: res.reason,
            verified: res.status === 'verified' || res.status === 'no_reference_context_ok',
            sourceId
        };
    });

    const VERIFIED = new Set(['verified', 'no_reference_context_ok']);
    const unverified = citations.filter(c => !VERIFIED.has(c.status));

    const counts = citations.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
    }, {});

    const hallucinationRate = citations.length
        ? +(unverified.length / citations.length).toFixed(3)
        : 0;

    return {
        ok: strict ? unverified.length === 0 : true,
        citations,
        counts,
        total: citations.length,
        unverifiedCount: unverified.length,
        hallucinationRate,
        unverified,
        annotatedText: annotateText(text, citations)
    };
}

/**
 * Označí v textu neověřené citace inline značkou ⚠, ať je advokát na první
 * pohled pozná. (Nemaže je — o smazání/přegenerování rozhoduje volající.)
 */
function annotateText(text, citations) {
    let out = String(text || '');
    const bad = citations
        .filter(c => c.status !== 'verified' && c.status !== 'no_reference_context_ok')
        .map(c => c.raw)
        // nejdelší napřed, ať se kratší nezanoří do delšího
        .sort((a, b) => b.length - a.length);
    const seen = new Set();
    for (const raw of bad) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        // nahradí jen výskyty, které ještě nejsou označené
        const safe = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(safe + '(?!\\s*⚠ NEOVĚŘENO)', 'g'), raw + ' ⚠ NEOVĚŘENO');
    }
    return out;
}

module.exports = {
    verifyCitations,
    extractCitations,
    buildEmptyReferenceIndex,
    annotateText,
    normalizeCitation,
    // interní, exportováno kvůli testům
    _verifyOne: verifyOne
};
