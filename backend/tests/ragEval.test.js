/**
 * Testy vyhodnocovacího jádra RAG evalu (lib/rag_eval.js) — čistá matematika
 * metrik s deterministickým fake searchFn (bez embedding modelu).
 */
const { isRelevant, distinctDocsInOrder, evaluateCase, aggregate, runEval } = require('../lib/rag_eval');

// Pomocník: výsledky jako pole {fileName, score} (score sestupně).
const R = (...names) => names.map((fileName, i) => ({ fileName, score: 1 - i * 0.01 }));

describe('isRelevant — párování názvů', () => {
    test('přesná shoda i shoda podřetězce/basename (case-insensitive)', () => {
        expect(isRelevant('judikatura_promlceni.txt', ['judikatura_promlceni.txt'])).toBe(true);
        expect(isRelevant('klient_x/judikatura_promlceni.txt', ['judikatura_promlceni'])).toBe(true);
        expect(isRelevant('JUDIKATURA_Promlceni.TXT', ['judikatura_promlceni.txt'])).toBe(true);
        expect(isRelevant('smlouva_novak.pdf', ['najem'])).toBe(false);
    });
    test('prázdné položky se ignorují', () => {
        expect(isRelevant('a.txt', ['', null, undefined])).toBe(false);
    });
});

describe('distinctDocsInOrder — redukce chunků na dokumenty', () => {
    test('zachová pořadí podle skóre a odstraní duplicitní fileName', () => {
        const res = R('a.txt', 'a.txt', 'b.txt', 'a.txt', 'c.txt');
        expect(distinctDocsInOrder(res)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });
});

describe('evaluateCase — metriky jednoho dotazu', () => {
    test('relevantní na 1. místě → hit, recall 1/1, RR 1', () => {
        const m = evaluateCase(R('cil.txt', 'x.txt', 'y.txt'), ['cil.txt'], 5);
        expect(m.hit).toBe(1);
        expect(m.recall).toBe(1);
        expect(m.firstRank).toBe(1);
        expect(m.reciprocalRank).toBe(1);
    });
    test('relevantní na 3. místě → RR = 1/3, recall 1/1', () => {
        const m = evaluateCase(R('x.txt', 'y.txt', 'cil.txt'), ['cil.txt'], 5);
        expect(m.firstRank).toBe(3);
        expect(m.reciprocalRank).toBeCloseTo(1 / 3, 6);
        expect(m.recall).toBe(1);
    });
    test('mimo top-k → hit=0, recall 0, ale RR odráží skutečný rank', () => {
        const m = evaluateCase(R('x', 'y', 'z', 'w', 'v', 'cil'), ['cil'], 5);
        expect(m.hit).toBe(0);
        expect(m.recall).toBe(0);
        expect(m.firstRank).toBe(6);
        expect(m.reciprocalRank).toBeCloseTo(1 / 6, 6);
    });
    test('2 relevantní, 1 v top-k → recall 1/2, precision 1/5 při k=5', () => {
        const m = evaluateCase(R('cilA', 'x', 'y', 'z', 'w'), ['cilA', 'cilB'], 5);
        expect(m.recall).toBe(0.5);
        expect(m.precision).toBeCloseTo(1 / 5, 6);
    });
    test('precision počítá jen z reálně vrácených dokumentů (méně než k)', () => {
        const m = evaluateCase(R('cil', 'x'), ['cil'], 5);
        expect(m.precision).toBe(0.5); // 1 relevantní ze 2 vrácených
    });
    test('duplicitní chunky téhož dokumentu se nezapočítají dvakrát', () => {
        const m = evaluateCase(R('cil', 'cil', 'cil'), ['cil'], 5);
        expect(m.retrievedInTopK).toBe(1);
        expect(m.precision).toBe(1);
    });
});

describe('aggregate — souhrn', () => {
    test('průměruje metriky přes případy', () => {
        const cms = [
            evaluateCase(R('cil'), ['cil'], 5),         // hit1 recall1 rr1
            evaluateCase(R('x', 'cil'), ['cil'], 5)     // hit1 recall1 rr0.5
        ];
        const s = aggregate(cms);
        expect(s.cases).toBe(2);
        expect(s.hitRate).toBe(1);
        expect(s.mrr).toBeCloseTo((1 + 0.5) / 2, 6);
    });
    test('prázdný vstup → nuly', () => {
        expect(aggregate([])).toEqual({ cases: 0, hitRate: 0, recallAtK: 0, precisionAtK: 0, mrr: 0 });
    });
});

describe('runEval — orchestrace nad searchFn', () => {
    const fakeSearch = async (query) => {
        if (query === 'trefa') return R('cil.txt', 'jiny.txt');
        if (query === 'mimo') return R('a', 'b', 'c');
        if (query === 'degrad') return [{ fileName: 'cil.txt', score: 0.2, degraded: true }];
        throw new Error('boom');
    };

    test('spočítá souhrn a označí sémantický režim', async () => {
        const rep = await runEval({
            cases: [
                { query: 'trefa', relevant: ['cil.txt'] },
                { query: 'mimo', relevant: ['cil.txt'] }
            ], searchFn: fakeSearch, k: 5
        });
        expect(rep.mode).toBe('semantic');
        expect(rep.summary.cases).toBe(2);
        expect(rep.summary.hitRate).toBe(0.5);
    });
    test('degradovaný výsledek → mode lexical-fallback', async () => {
        const rep = await runEval({ cases: [{ query: 'degrad', relevant: ['cil.txt'] }], searchFn: fakeSearch, k: 5 });
        expect(rep.mode).toBe('lexical-fallback');
    });
    test('chyba searchFn → případ se přeskočí, nespadne celý běh', async () => {
        const rep = await runEval({ cases: [{ query: 'boom', relevant: ['x'] }], searchFn: fakeSearch, k: 5 });
        expect(rep.perCase[0].skipped).toBe(true);
        expect(rep.summary.cases).toBe(0);
    });
    test('prázdná sada → chyba', async () => {
        await expect(runEval({ cases: [], searchFn: fakeSearch })).rejects.toThrow();
    });
});
