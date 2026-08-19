/**
 * Testy chunkText — dělení textu na chunky pro RAG.
 * Ověřuje: krátký text = 1 chunk (zpětná kompatibilita), dělení dlouhých odstavců na
 * věty, dodržení max. velikosti, PŘEKRYV mezi chunky a robustnost na prázdný vstup.
 * Žádná síť / model — jen čistá funkce.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// rag.js potřebuje WATCH_DIR ještě před require (kvůli config); nastavíme temp.
const tmp = path.join(os.tmpdir(), `lexis_chunk_${Date.now()}`);
if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
process.env.WATCH_DIR = tmp;

const rag = require('../lib/rag');

describe('chunkText', () => {
    afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

    test('krátký text → jeden chunk (beze změny chování)', () => {
        const out = rag.chunkText('Nájemní smlouva na byt v Praze. Výše nájmu 15000 Kč.');
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('Nájemní smlouva');
    });

    test('prázdný / neplatný vstup → []', () => {
        expect(rag.chunkText('')).toEqual([]);
        expect(rag.chunkText(null)).toEqual([]);
        expect(rag.chunkText(undefined)).toEqual([]);
        expect(rag.chunkText('   \n  \n ')).toEqual([]);
    });

    test('dlouhý odstavec se rozdělí na více chunků, každý do MAX (+překryv)', () => {
        const para = 'Toto je věta číslo ' + Array.from({ length: 60 }, (_, i) => `${i}`).join(' ') + '. '
            + 'Následuje další samostatná věta o předmětu smlouvy a jejích náležitostech. '
            + 'A do třetice věta o smluvní pokutě, úrocích z prodlení a rozhodčí doložce mezi stranami.';
        const out = rag.chunkText(para, { maxChars: 120, overlapChars: 30 });
        expect(out.length).toBeGreaterThan(1);
        // žádný chunk výrazně nepřesáhne MAX (povolený skluz o velikost překryvu)
        out.forEach(c => expect(c.length).toBeLessThanOrEqual(120 + 30 + 5));
    });

    test('PŘEKRYV: konec chunku se objeví na začátku dalšího', () => {
        // souvislý text bez interpunkce → tvrdé dělení po slovech, snadno ověřitelný překryv
        const words = Array.from({ length: 80 }, (_, i) => `slovo${i}`).join(' ');
        const out = rag.chunkText(words, { maxChars: 100, overlapChars: 40 });
        expect(out.length).toBeGreaterThan(1);
        // poslední slovo prvního chunku se objeví mezi PRVNÍMI slovy druhého (překryv)
        const w0 = out[0].split(' ');
        const w1 = out[1].split(' ');
        expect(w1.slice(0, 8)).toContain(w0[w0.length - 1]);
    });

    test('bez překryvu (overlapChars:0) se text neopakuje', () => {
        const words = Array.from({ length: 40 }, (_, i) => `x${i}`).join(' ');
        const out = rag.chunkText(words, { maxChars: 60, overlapChars: 0 });
        expect(out.length).toBeGreaterThan(1);
        const tailWord = out[0].split(' ').slice(-1)[0];
        expect(out[1].startsWith(tailWord)).toBe(false);
    });

    test('více krátkých odstavců se sbalí do jednoho chunku (do MAX)', () => {
        const text = 'Řádek A\nŘádek B\nŘádek C';
        const out = rag.chunkText(text, { maxChars: 500, overlapChars: 0 });
        expect(out).toHaveLength(1);
        expect(out[0]).toBe('Řádek A Řádek B Řádek C');
    });

    test('velmi dlouhé „slovo" bez mezer se tvrdě rozseká pod MAX', () => {
        const giant = 'a'.repeat(1000);
        const out = rag.chunkText(giant, { maxChars: 200, overlapChars: 0 });
        expect(out.length).toBeGreaterThan(1);
        out.forEach(c => expect(c.length).toBeLessThanOrEqual(200));
    });
});
