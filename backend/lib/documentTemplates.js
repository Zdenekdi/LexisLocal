/**
 * documentTemplates.js — šablonový režim pro Spisovatele.
 *
 * FILOZOFIE (deterministicky tam, kde na tom záleží):
 *   • Právní text (struktura, formulace, paragrafy) je FIXNÍ a ověřený —
 *     model ho NEvymýšlí, takže odpadá komolená čeština i halucinované §.
 *   • Proměnné (částka, lhůta, …) se doplní DETERMINISTICKY z textu zadání.
 *   • Co nelze bezpečně určit → [Doplnit: …]; advokát doeditovává v LexisEditoru.
 *
 * Ověřené zákonné náležitosti (zdroje – česká legislativa, srpen 2026):
 *   • Předžalobní výzva: § 142a o. s. ř. (výzva min. 7 dní před podáním žaloby).
 *   • Žaloba: § 79 odst. 1 + § 42 odst. 4 o. s. ř. (skutečnosti, důkazy, petit).
 *   • Odvolání: § 205 odst. 2 + § 204 odst. 1 o. s. ř. (důvody, lhůta 15 dnů).
 *   • Smlouva: zákon č. 89/2012 Sb., občanský zákoník.
 *
 * POZNÁMKA k regexům: JavaScriptové \b (hranice slova) rozeznává jen ASCII —
 * u českých slov končících diakritikou („Kč", „dnů", „žalob", „odvolání")
 * proto \b NEPOUŽÍVÁME na koncích, jinak by matchování selhalo.
 */
'use strict';

// ---------------------------------------------------------------------------
// Pomocné funkce (bez závislostí, bez ICU)
// ---------------------------------------------------------------------------

function _norm(s) {
    return String(s || '').toLowerCase().normalize('NFC');
}

// Skupinování tisíců mezerami: 1500000 -> "1 500 000"
function _groupCz(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// České skloňování "den" podle počtu
function _denWord(n) {
    if (n === 1) return 'den';
    if (n >= 2 && n <= 4) return 'dny';
    return 'dnů';
}

// ---------------------------------------------------------------------------
// Extrakce slotů (deterministicky, žádný model)
// ---------------------------------------------------------------------------

// Částka v Kč: "15 000 Kč", "15000 Kč", "15.000,- Kč", "1 500 000 Kč", "15 000,50 Kč"
function extractCastka(text) {
    const re = /(\d{1,3}(?:[.\s ]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:,-\s*)?(k[čc]|korun\w*|czk)/i;
    const m = String(text || '').match(re);
    if (!m) return null;
    const intPart = m[1].replace(/[.\s ]/g, '');
    const num = parseInt(intPart, 10);
    if (isNaN(num)) return null;
    const hal = m[2] ? (',' + m[2]) : '';
    return { text: _groupCz(num) + hal + ' Kč', value: num };
}

// Lhůta / splatnost ve dnech: "14 dnů", "do 15 dní", "splatností 14 dnů", "lhůtu 7 dnů"
function extractLhuta(text) {
    const m = String(text || '').match(/(\d{1,3})\s*(?:den|dnech|dn[ůíyueě])/i);
    if (!m) return null;
    const days = parseInt(m[1], 10);
    if (isNaN(days)) return null;
    return { text: days + ' ' + _denWord(days), days };
}

// IČO: 8 číslic výslovně označené jako IČ/IČO (ať se neplete s částkou)
function extractIco(text) {
    const m = String(text || '').match(/i[čc]o?[:\s]*(\d{8})/i);
    return m ? m[1] : null;
}

// Datum ve formátu d.m.rrrr
function extractDatum(text) {
    const m = String(text || '').match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    return m ? (m[1] + '. ' + m[2] + '. ' + m[3]) : null;
}

function extractSlots(text) {
    return {
        castka: extractCastka(text),
        lhuta: extractLhuta(text),
        ico: extractIco(text),
        datum: extractDatum(text)
    };
}

// ---------------------------------------------------------------------------
// Detekce typu dokumentu (pořadí záleží: „předžalobní" obsahuje „žalob")
// ---------------------------------------------------------------------------

function detectDocumentType(text) {
    const t = _norm(text);
    if (/odvol[áa]n[íi]|odvol[áa]v[áa]|odvolat/.test(t)) return 'odvolani';
    if (/p[řr]ed[žz]alobn|upom[íi]nk|v[ýy]zv\w*\s+k\s+(?:[úu]hrad|zaplacen|pln[ěe]n)/.test(t)) return 'predzalobni_vyzva';
    if (/[žz]alob/.test(t)) return 'zaloba_o_zaplaceni';
    if (/smlouv|smluvn/.test(t)) return 'smlouva';
    return null;
}

const TYPE_TITLES = {
    predzalobni_vyzva: 'Předžalobní výzva',
    zaloba_o_zaplaceni: 'Žaloba o zaplacení',
    odvolani: 'Odvolání',
    smlouva: 'Smlouva'
};

// ---------------------------------------------------------------------------
// Rendering šablon → markdown (převede se dál na HTML/DOCX v emailTask.js)
// ---------------------------------------------------------------------------

const D = (label) => `[Doplnit: ${label}]`;
const PODPIS = '________________________________';

function _footer(original) {
    const src = String(original || '').replace(/\s+/g, ' ').trim();
    return src ? `\n\n*Podklad od advokáta (ke kontrole a doplnění): ${src}*` : '';
}

function _renderPredzalobniVyzva(slots, original) {
    const castka = slots.castka ? `**${slots.castka.text}**` : D('dlužná částka');
    const lhuta = slots.lhuta ? `**${slots.lhuta.text}**` : D('lhůta k úhradě, min. 7 dnů');
    const md = `# PŘEDŽALOBNÍ VÝZVA K ÚHRADĚ
(výzva k plnění dle § 142a zákona č. 99/1963 Sb., občanský soudní řád)

**Věřitel:** ${D('jméno / název, adresa / sídlo, IČO věřitele')}
**Dlužník:** ${D('jméno / název, adresa / sídlo dlužníka')}

Vážená paní / Vážený pane,

jako ${D('věřitel / právní zástupce věřitele')} Vás tímto vyzývám k úhradě níže specifikované splatné pohledávky.

## I. Specifikace pohledávky
Ke dni této výzvy za Vámi eviduji splatnou pohledávku ve výši ${castka}.
Právní důvod pohledávky: ${D('označení smlouvy / faktury č. …, ze dne …, s datem splatnosti …')}.

## II. Výzva k úhradě
Vyzývám Vás, abyste dlužnou částku uhradil(a) nejpozději do ${lhuta} ode dne doručení této výzvy, a to na účet č. ${D('číslo účtu')}, variabilní symbol ${D('VS')}.

## III. Následky neuhrazení
Nebude-li pohledávka v uvedené lhůtě uhrazena, budu nucen(a) domáhat se jejího zaplacení soudní cestou. V takovém případě se dlužná částka navýší o náklady soudního řízení a náklady právního zastoupení. Tato výzva je činěna rovněž ve smyslu § 142a občanského soudního řádu, tj. nejméně 7 dnů před podáním žaloby.

V ${D('místo')} dne ${D('datum')}

${PODPIS}
${D('jméno a podpis')}${_footer(original)}`;
    const warnings = [];
    if (slots.lhuta && slots.lhuta.days < 7) {
        warnings.push('Zadaná lhůta (' + slots.lhuta.text + ') je kratší než zákonné minimum 7 dnů dle § 142a o. s. ř. — pro nárok na náhradu nákladů řízení stanovte alespoň 7 dnů.');
    }
    return { markdown: md, warnings };
}

function _renderZaloba(slots, original) {
    const castka = slots.castka ? `**${slots.castka.text}**` : D('žalovaná částka');
    const castkaNadpis = (slots.castka ? slots.castka.text : D('žalovaná částka')) + ' s příslušenstvím';
    const md = `# ŽALOBA
o zaplacení ${castkaNadpis}

**Žalobce:** ${D('jméno / název, bydliště / sídlo, IČO')}, zast. ${D('advokát')}
**Žalovaný:** ${D('jméno / název, bydliště / sídlo, IČO')}

Adresováno: ${D('označení věcně a místně příslušného soudu')}

## I. Skutkový stav
(vylíčení rozhodujících skutečností dle § 79 odst. 1 občanského soudního řádu)

${D('popis vzniku pohledávky — smlouva, poskytnuté plnění, splatnost, výše dluhu')}

## II. Označení důkazů
(dle § 79 odst. 1 občanského soudního řádu)

${D('listinné důkazy — smlouva, faktura, dodací list, korespondence; případně svědci')}

## III. Předžalobní výzva
Žalovaný byl před podáním této žaloby vyzván k úhradě ve smyslu § 142a o. s. ř. ${D('datum a způsob zaslání výzvy')}.

## IV. Žalobní petit
Navrhuji, aby soud vydal tento

**r o z s u d e k :**

Žalovaný je povinen zaplatit žalobci částku ${castka} ${D('s úrokem z prodlení ve výši … % ročně od … do zaplacení')} do tří dnů od právní moci tohoto rozsudku a nahradit žalobci náklady řízení, to vše do tří dnů od právní moci rozsudku.

## V. Soudní poplatek
Soudní poplatek za žalobu bude uhrazen ${D('kolkem / na výzvu soudu')}.

V ${D('místo')} dne ${D('datum')}

${PODPIS}
${D('podpis žalobce / advokáta')}${_footer(original)}`;
    return { markdown: md, warnings: [] };
}

function _renderOdvolani(slots, original) {
    const md = `# ODVOLÁNÍ
proti ${D('označení napadeného rozhodnutí — soud, č. j., ze dne …')}

**Odvolatel:** ${D('jméno / název, adresa / sídlo')}, zast. ${D('advokát')}
**Další účastník řízení:** ${D('jméno / název, adresa / sídlo')}

Podáno prostřednictvím ${D('soud, který rozhodl v prvním stupni')}.

## I. Rozsah napadení
Shora označené rozhodnutí napadám v ${D('celém rozsahu / v části výroku …')}.

## II. Odvolací důvod
(dle § 205 odst. 2 občanského soudního řádu)

Nesprávnost rozhodnutí spatřuji v tom, že ${D('konkrétní důvod — např. dle § 205 odst. 2 písm. g) rozhodnutí spočívá na nesprávném právním posouzení věci')}.

## III. Odůvodnění
${D('konkrétní argumentace, v čem je rozhodnutí nebo postup soudu prvního stupně nesprávný')}

## IV. Odvolací návrh
Navrhuji, aby odvolací soud napadené rozhodnutí ${D('změnil tak, že … / zrušil a věc vrátil soudu prvního stupně k dalšímu řízení')}.

_Poučení: Odvolání se podává do 15 dnů od doručení písemného vyhotovení rozhodnutí u soudu, proti jehož rozhodnutí směřuje (§ 204 odst. 1 o. s. ř.)._

V ${D('místo')} dne ${D('datum')}

${PODPIS}
${D('podpis odvolatele / advokáta')}${_footer(original)}`;
    return { markdown: md, warnings: [] };
}

function _renderSmlouva(slots, original) {
    const cenaRadek = slots.castka
        ? `Cena / odměna činí **${slots.castka.text}**.`
        : D('cena / odměna a její výše');
    const md = `# SMLOUVA
${D('druh smlouvy — např. kupní, o dílo, o poskytování služeb')}

uzavřená níže uvedeného dne, měsíce a roku podle zákona č. 89/2012 Sb., občanský zákoník, mezi:

**1.** ${D('jméno / název, adresa / sídlo, IČO')} (dále jen „strana A")

a

**2.** ${D('jméno / název, adresa / sídlo, IČO')} (dále jen „strana B")

## I. Předmět smlouvy
${D('přesné vymezení předmětu plnění')}

## II. Cena a platební podmínky
${cenaRadek}
${D('způsob a termín úhrady, číslo účtu')}

## III. Doba a místo plnění
${D('termín a místo plnění')}

## IV. Práva a povinnosti smluvních stran
${D('konkrétní práva a povinnosti stran')}

## V. Závěrečná ustanovení
Tato smlouva se řídí právním řádem České republiky, zejména zákonem č. 89/2012 Sb., občanský zákoník. Smlouva je vyhotovena ve dvou stejnopisech s platností originálu, po jednom pro každou smluvní stranu. Měnit či doplňovat ji lze pouze písemnými, vzestupně číslovanými dodatky podepsanými oběma stranami.

V ${D('místo')} dne ${D('datum')}

strana A: ...........................        strana B: ...........................${_footer(original)}`;
    return { markdown: md, warnings: [] };
}

const RENDERERS = {
    predzalobni_vyzva: _renderPredzalobniVyzva,
    zaloba_o_zaplaceni: _renderZaloba,
    odvolani: _renderOdvolani,
    smlouva: _renderSmlouva
};

function renderTemplate(type, slots, original) {
    const fn = RENDERERS[type];
    if (!fn) return null;
    const r = fn(slots || {}, original || '');
    return { type, title: TYPE_TITLES[type], markdown: r.markdown, warnings: r.warnings || [] };
}

/**
 * tryTemplate(instruction) → hlavní vstupní bod pro Spisovatele.
 * Vrátí { matched:false } když typ nerozpozná (→ volná generace modelem),
 * jinak { matched:true, type, title, markdown, warnings, slots }.
 */
function tryTemplate(instruction) {
    const text = String(instruction || '');
    const type = detectDocumentType(text);
    if (!type) return { matched: false };
    const slots = extractSlots(text);
    const rendered = renderTemplate(type, slots, text);
    return {
        matched: true,
        type,
        title: rendered.title,
        markdown: rendered.markdown,
        warnings: rendered.warnings,
        slots
    };
}

module.exports = {
    tryTemplate,
    detectDocumentType,
    extractSlots,
    renderTemplate,
    extractCastka,
    extractLhuta,
    extractIco,
    extractDatum,
    TYPE_TITLES
};
