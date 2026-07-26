/**
 * Testy pathsafe (js ../lib/pathsafe.js) — obrana proti path traversal.
 * Bezpečnostně kritické: výstup safePathInWatchDir MUSÍ vždy zůstat uvnitř WATCH_DIR.
 */

const path = require('path');
const os = require('os');

// WATCH_DIR se v config.js čte při načtení — nastavíme před require.
const TMP = path.join(os.tmpdir(), 'lexis_pathsafe_test');
process.env.WATCH_DIR = TMP;

const { safePathInWatchDir, sanitizeFileName } = require('../lib/pathsafe');
const ROOT = path.resolve(TMP);

describe('safePathInWatchDir — traversal defense', () => {
    test('běžný název → cesta uvnitř WATCH_DIR', () => {
        const p = safePathInWatchDir('spis.txt');
        expect(p).toBe(path.join(ROOT, 'spis.txt'));
        expect(p.startsWith(ROOT)).toBe(true);
    });

    test('"../" únik se zahodí (basename) → zůstane uvnitř', () => {
        const p = safePathInWatchDir('../../../etc/passwd');
        expect(p).toBe(path.join(ROOT, 'passwd'));
        expect(p.startsWith(ROOT + path.sep)).toBe(true);
    });

    test('absolutní cesta se zahodí na basename', () => {
        const p = safePathInWatchDir('/etc/shadow');
        expect(p).toBe(path.join(ROOT, 'shadow'));
    });

    test('null byte → chyba', () => {
        expect(() => safePathInWatchDir('a\0b.txt')).toThrow(/Neplatný název/);
    });

    test('"." / ".." / prázdné → chyba', () => {
        expect(() => safePathInWatchDir('.')).toThrow();
        expect(() => safePathInWatchDir('..')).toThrow();
        expect(() => safePathInWatchDir('')).toThrow(/Neplatný název/);
        expect(() => safePathInWatchDir(null)).toThrow();
    });

    test('zachová českou diakritiku v názvu', () => {
        const p = safePathInWatchDir('žaloba_Nováková.pdf');
        expect(p).toBe(path.join(ROOT, 'žaloba_Nováková.pdf'));
    });
});

describe('sanitizeFileName', () => {
    test('nahradí nebezpečné znaky podtržítkem, zachová diakritiku a číslice', () => {
        expect(sanitizeFileName('Výzva: 23 C 120/2026')).toBe('Výzva__23_C_120_2026');
    });

    test('ořízne na 100 znaků', () => {
        expect(sanitizeFileName('a'.repeat(250)).length).toBe(100);
    });

    test('null/undefined → prázdný řetězec', () => {
        expect(sanitizeFileName(null)).toBe('');
        expect(sanitizeFileName(undefined)).toBe('');
    });
});
