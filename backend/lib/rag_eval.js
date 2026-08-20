/**
 * rag_eval.js — vyhodnocovací (eval) jádro pro RAG. Měří, jestli vyhledávání
 * vrací SPRÁVNÉ dokumenty na sadě testovacích dotazů. Čistý, deterministický
 * modul BEZ závislosti na embedding modelu — počítá metriky nad výsledky, které
 * mu předá volající (searchFn). Díky tomu je plně pokryt testy i bez Ollamy.
 *
 * Metriky se počítají na ÚROVNI DOKUMENTU (ne chunku): výsledky se zredukují na
 * unikátní fileName v pořadí podle skóre (první výskyt = nejlepší rank). To
 * odpovídá právní praxi — „vynořil se ten správný spis / judikát?".
 *
 *   recall@k    = (počet relevantních dokumentů v top-k) / (počet relevantních)
 *   precision@k = (počet relevantních v top-k) / (počet dokumentů v top-k)
 *   hit@k       = byl v top-k aspoň jeden relevantní? (0/1)
 *   RR          = 1 / rank prvního relevantního dokumentu (jinak 0) → agreg. MRR
 */
'use strict';

// Normalizace názvu pro párování: malá písmena, / místo \, ořez mezer.
function _norm(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\\/g, '/').trim();
}
function _basename(s) {
    const n = _norm(s);
    const i = n.lastIndexOf('/');
    return i >= 0 ? n.slice(i + 1) : n;
}

// Je kandidát (fileName z výsledku) relevantní vůči jednomu z očekávaných názvů?
// Shoda: přesná, substring, nebo shoda basename — aby uživatel mohl zadat
// „judikatura_promlceni" a trefit „klient_x/judikatura_promlceni.txt".
function isRelevant(candidateFileName, relevantList) {
    const c = _norm(candidateFileName);
    const cb = _basename(candidateFileName);
    return relevantList.some(rel => {
        const r = _norm(rel);
        if (!r) return false;
        return c === r || c.includes(r) || cb === r || cb.includes(r) || c.includes(_basename(rel));
    });
}

// Redukce výsledků (chunků) na unikátní dokumenty v pořadí podle skóre.
function distinctDocsInOrder(results) {
    const seen = new Set();
    const out = [];
    for (const rslt of (results || [])) {
        const key = _norm(rslt.fileName);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rslt.fileName);
    }
    return out;
}

/**
 * Metriky jednoho dotazu.
 * @param {Array} results  výstup searchFn (pole {fileName, score, ...})
 * @param {string[]} relevant  očekávané relevantní dokumenty (názvy)
 * @param {number} k
 */
function evaluateCase(results, relevant, k) {
    const rel = (relevant || []).filter(x => x != null && String(x).trim() !== '');
    const ranked = distinctDocsInOrder(results);
    const topK = ranked.slice(0, k);

    const hitsTopK = topK.filter(fn => isRelevant(fn, rel));
    const nRel = rel.length;

    // rank prvního relevantního dokumentu (1-based) v CELÉM pořadí
    let firstRank = null;
    for (let i = 0; i < ranked.length; i++) {
        if (isRelevant(ranked[i], rel)) { firstRank = i + 1; break; }
    }

    return {
        nRelevant: nRel,
        retrievedInTopK: hitsTopK.length,
        hit: hitsTopK.length > 0 ? 1 : 0,
        recall: nRel > 0 ? hitsTopK.length / nRel : 0,
        precision: topK.length > 0 ? hitsTopK.length / topK.length : 0,
        reciprocalRank: firstRank ? 1 / firstRank : 0,
        firstRank: firstRank,
        topK: topK
    };
}

// Agregace přes všechny případy.
function aggregate(caseMetrics) {
    const n = caseMetrics.length;
    if (n === 0) return { cases: 0, hitRate: 0, recallAtK: 0, precisionAtK: 0, mrr: 0 };
    const sum = (f) => caseMetrics.reduce((a, m) => a + f(m), 0);
    return {
        cases: n,
        hitRate: sum(m => m.hit) / n,
        recallAtK: sum(m => m.recall) / n,
        precisionAtK: sum(m => m.precision) / n,
        mrr: sum(m => m.reciprocalRank) / n
    };
}

/**
 * Spustí eval nad sadou případů.
 * @param {Object} o
 * @param {Array<{query:string, relevant:string[], filters?:object}>} o.cases
 * @param {(query:string, filters?:object)=>Promise<Array>} o.searchFn
 * @param {number} [o.k=5]
 * @returns {Promise<{k, mode, perCase, summary}>}
 */
async function runEval({ cases, searchFn, k = 5 }) {
    if (!Array.isArray(cases) || cases.length === 0) throw new Error('runEval: prázdná sada „cases".');
    if (typeof searchFn !== 'function') throw new Error('runEval: „searchFn" musí být funkce.');

    const perCase = [];
    let anyDegraded = false;
    for (const c of cases) {
        if (!c || !c.query || !String(c.query).trim()) {
            perCase.push({ query: c && c.query, error: 'prázdný dotaz', skipped: true });
            continue;
        }
        let results;
        try {
            results = await searchFn(String(c.query), c.filters || null);
        } catch (err) {
            perCase.push({ query: c.query, error: err.message, skipped: true });
            continue;
        }
        if (Array.isArray(results) && results.some(r => r && r.degraded)) anyDegraded = true;
        const m = evaluateCase(results, c.relevant || [], k);
        perCase.push({ query: c.query, label: c.label || null, ...m });
    }

    const scored = perCase.filter(p => !p.skipped);
    return {
        k,
        mode: anyDegraded ? 'lexical-fallback' : 'semantic',
        perCase,
        summary: aggregate(scored)
    };
}

module.exports = { isRelevant, distinctDocsInOrder, evaluateCase, aggregate, runEval };
