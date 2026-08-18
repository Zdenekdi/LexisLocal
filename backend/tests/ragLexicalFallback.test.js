/**
 * Testy lexikálního (deterministického, offline) fallbacku RAG — chování při
 * NEDOSTUPNÉM embedding modelu (ollama.embeddings vyhazuje):
 *   • indexDocument uloží chunky textově (vector=null, embedded=false),
 *   • searchSimilar({ lexicalFallback:true }) dohledá dle klíčových slov,
 *   • přísné volání (bez opts) při výpadku modelu FAIL-CLOSED vyhodí chybu.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Simulace vypnutého modelu: embeddings vždy selžou.
jest.mock('ollama', () => ({
    embeddings: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    chat: jest.fn()
}));

const tempWatchDir = path.join(os.tmpdir(), `lexis_test_rag_lex_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;

const rag = require('../lib/rag');

describe('RAG lexikální offline fallback', () => {
    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        for (const f of fs.readdirSync(tempWatchDir)) {
            fs.unlinkSync(path.join(tempWatchDir, f));
        }
    });

    test('lexicalScore: shoda klíčových slov skóruje výš než nesouvisející text', () => {
        const q = 'nájemní smlouva byt Praha';
        const relevant = rag.lexicalScore(q, 'Nájemní smlouva na byt v Praze.');
        const unrelated = rag.lexicalScore(q, 'Záznam o dopravní nehodě na dálnici.');
        expect(relevant).toBeGreaterThan(unrelated);
        expect(relevant).toBeGreaterThan(0);
    });

    test('indexDocument bez modelu uloží chunky TEXTOVĚ (vector=null, embedded=false)', async () => {
        await rag.indexDocument('smlouva.txt', 'Nájemní smlouva na byt v Praze.');
        const part = rag.loadPartition('root');
        expect(part.chunks.length).toBeGreaterThan(0);
        expect(part.chunks.every(c => c.vector === null)).toBe(true);
        expect(part.chunks.every(c => c.embedded === false)).toBe(true);
    });

    test('searchSimilar s fallbackem najde relevantní dokument i bez modelu', async () => {
        await rag.indexDocument('najem.txt', 'Nájemní smlouva na byt v Praze. Výše nájmu 15000 Kč.');
        await rag.indexDocument('nehoda.txt', 'Záznam o dopravní nehodě na dálnici D1.');

        const matches = await rag.searchSimilar('nájemní smlouva byt', 5, null, { lexicalFallback: true });
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].fileName).toBe('najem.txt');
        expect(matches[0].method).toBe('lexical');
        expect(matches[0].degraded).toBe(true);
    });

    test('přísné volání (bez opts) při výpadku modelu vyhodí chybu (fail-closed)', async () => {
        await rag.indexDocument('x.txt', 'Nějaký text k indexaci.');
        await expect(rag.searchSimilar('cokoliv', 5, null)).rejects.toThrow();
    });
});
