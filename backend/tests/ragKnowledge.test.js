/**
 * Testy per-agent RAG (znalostní báze agentů) + úrovně přístupu ke spisům.
 * Bez embedding modelu → používá lexikální fallback (jako ragLexicalFallback.test.js).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), `lexis_kb_${Date.now()}`);
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
process.env.WATCH_DIR = tmp;

const rag = require('../lib/rag');
const { applyAgentScope } = require('../lib/rag_request');
const { normalizeAgent } = require('../lib/agents');

describe('per-agent znalostní báze (rag.indexKnowledge / searchSimilar scopes)', () => {
    beforeAll(async () => {
        await rag.indexKnowledge('_kb_resersnik', 'judikatura.txt', 'Rozsudek Nejvyššího soudu o promlčení nároku ze smlouvy.');
        await rag.indexKnowledge('_kb_resersnik', 'legislativa.txt', 'Ustanovení občanského zákoníku o náhradě škody.');
        await rag.indexKnowledge('_kb_spisovatel', 'vzor.txt', 'Vzor kupní smlouvy na nemovitost s doložkou o smluvní pokutě.');
    });
    afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

    test('listKnowledge vidí VÍCE dokumentů v jedné bázi (izolovaný round-trip neztrácí data)', () => {
        const docs = rag.listKnowledge('_kb_resersnik').map(d => d.fileName).sort();
        expect(docs).toEqual(['judikatura.txt', 'legislativa.txt']);
    });

    test('indexKnowledge bez modelu uloží chunky textově (vector=null)', () => {
        const part = rag.loadPartition('_kb_resersnik');
        expect(part.chunks.length).toBeGreaterThan(0);
        expect(part.chunks.every(c => c.vector === null)).toBe(true);
        expect(part.chunks.every(c => c.scope === '_kb_resersnik')).toBe(true);
    });

    test('searchSimilar se scope najde v BÁZI agenta a NEvidí cizí bázi', async () => {
        const matches = await rag.searchSimilar('promlčení nároku', 5, { scopes: ['_kb_resersnik'] }, { lexicalFallback: true });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].fileName).toBe('judikatura.txt');
        // cizí báze spisovatele se sem nesmí dostat
        expect(matches.every(m => m.fileName !== 'vzor.txt')).toBe(true);
    });

    test('KB NEZNEČIŠŤUJE obecný index (loadIndex ani conflicts ji nevidí)', async () => {
        const index = await rag.loadIndex();
        expect(index.chunks.every(c => !c.scope)).toBe(true);            // žádné KB chunky
        expect(rag.getActiveDirectories().every(d => d.indexOf('_kb_') !== 0)).toBe(true);
    });

    test('deleteKnowledge odstraní dokument jen z dané báze', async () => {
        await rag.indexKnowledge('_kb_kontrolor', 'checklist.txt', 'Kontrolní seznam náležitostí žaloby.');
        const res = await rag.deleteKnowledge('_kb_kontrolor', 'checklist.txt');
        expect(res.removed).toBeGreaterThan(0);
        expect(rag.listKnowledge('_kb_kontrolor')).toEqual([]);
        // báze rešeršníka zůstala nedotčená
        expect(rag.listKnowledge('_kb_resersnik').length).toBe(2);
    });

    test('clientAccess:false → agent čerpá JEN z vlastní báze (klientský spis se vynechá)', async () => {
        await rag.indexDocument('klient.txt', 'Klientský spis: nájemní smlouva pana Nováka na byt v Praze, promlčení.');
        // s přístupem: kandidáti = klient + KB
        const withClient = await rag.searchSimilar('promlčení', 5, { scopes: ['_kb_resersnik'] }, { lexicalFallback: true });
        expect(withClient.some(m => m.fileName === 'klient.txt')).toBe(true);
        // bez přístupu: jen KB, klientský spis se nesmí objevit
        const kbOnly = await rag.searchSimilar('promlčení', 5, { scopes: ['_kb_resersnik'], clientAccess: false }, { lexicalFallback: true });
        expect(kbOnly.length).toBeGreaterThan(0);
        expect(kbOnly.every(m => m.fileName !== 'klient.txt')).toBe(true);
    });

    test('výsledky nesou scope: KB chunk = _kb_*, klientský = null (podklad pro redakci)', async () => {
        await rag.indexDocument('klient2.txt', 'Klientský spis pana Nováka: promlčení nároku.');
        const matches = await rag.searchSimilar('promlčení', 10, { scopes: ['_kb_resersnik'] }, { lexicalFallback: true });
        const kb = matches.find(m => m.fileName === 'judikatura.txt');
        const client = matches.find(m => m.fileName === 'klient2.txt');
        expect(kb && kb.scope).toBe('_kb_resersnik');
        expect(client && client.scope).toBeNull();
    });
});

describe('applyAgentScope (čistá funkce)', () => {
    test('přidá znalostní bázi agenta do scopes', () => {
        const f = applyAgentScope(null, { knowledgeScope: '_kb_resersnik', spisAccess: 'full' });
        expect(f.scopes).toEqual(['_kb_resersnik']);
        expect(f.clientAccess).toBeUndefined(); // plný přístup → neomezujeme
    });

    test('spisAccess "none" → clientAccess:false', () => {
        const f = applyAgentScope({ fileNames: ['spisA.txt'] }, { knowledgeScope: '_kb_stylista', spisAccess: 'none' });
        expect(f.clientAccess).toBe(false);
        expect(f.scopes).toEqual(['_kb_stylista']);
        expect(f.fileNames).toEqual(['spisA.txt']); // původní filtr zachován
    });

    test('debata (pole agentů): sjednotí scopes, omezí přístup když ho nemá KDOKOLI', () => {
        const f = applyAgentScope(null, [
            { knowledgeScope: '_kb_resersnik', spisAccess: 'full' },
            { knowledgeScope: '_kb_stylista', spisAccess: 'none' }
        ]);
        expect(f.scopes.sort()).toEqual(['_kb_resersnik', '_kb_stylista']);
        expect(f.clientAccess).toBe(false); // stylista nemá přístup → konzervativně omezeno
    });

    test('spisAccess "redacted" → redactClient:true, klientský přístup zůstává', () => {
        const f = applyAgentScope({ fileNames: ['spisA.txt'] }, { knowledgeScope: '_kb_kontrolor', spisAccess: 'redacted' });
        expect(f.redactClient).toBe(true);
        expect(f.clientAccess).toBeUndefined(); // pořád čte klienta, jen anonymizovaně
    });

    test('precedence none > redacted > full', () => {
        // redacted + none → vyhraje none (bez klientského přístupu, bez redakce)
        const a = applyAgentScope(null, [{ spisAccess: 'redacted' }, { spisAccess: 'none' }]);
        expect(a.clientAccess).toBe(false);
        expect(a.redactClient).toBeUndefined();
        // full + redacted → redacted
        const b = applyAgentScope(null, [{ spisAccess: 'full' }, { spisAccess: 'redacted' }]);
        expect(b.redactClient).toBe(true);
        expect(b.clientAccess).toBeUndefined();
    });

    test('nemutuje vstupní filtry', () => {
        const base = { fileNames: ['x.txt'] };
        const out = applyAgentScope(base, { knowledgeScope: '_kb_a', spisAccess: 'full' });
        expect(base.scopes).toBeUndefined();
        expect(out).not.toBe(base);
    });
});

describe('normalizeAgent (výchozí RAG pole)', () => {
    test('read_files:true → spisAccess full + vlastní scope', () => {
        expect(normalizeAgent({ id: 'resersnik', permissions: { read_files: true } }))
            .toMatchObject({ knowledgeScope: '_kb_resersnik', spisAccess: 'full' });
    });
    test('read_files:false → spisAccess none', () => {
        expect(normalizeAgent({ id: 'stylista', permissions: { read_files: false } }))
            .toMatchObject({ knowledgeScope: '_kb_stylista', spisAccess: 'none' });
    });
    test('zachová už nastavené hodnoty', () => {
        const a = normalizeAgent({ id: 'x', spisAccess: 'none', knowledgeScope: '_kb_custom', permissions: { read_files: true } });
        expect(a.spisAccess).toBe('none');
        expect(a.knowledgeScope).toBe('_kb_custom');
    });
    test('„redacted" je platná úroveň a zachová se', () => {
        expect(normalizeAgent({ id: 'k', spisAccess: 'redacted', permissions: { read_files: true } }).spisAccess).toBe('redacted');
    });
});
