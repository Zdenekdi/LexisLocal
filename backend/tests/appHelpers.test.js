/**
 * Behaviorální testy pomocných funkcí dashboardu (backend/public/app-helpers.js).
 * Klíčové je escapeHtml — obrana proti XSS při vykreslování dat do dashboardu.
 */
const { escapeHtml } = require('../public/app-helpers');

describe('escapeHtml (XSS obrana dashboardu)', () => {
    test('escapuje všech pět znaků', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#039;');
    });
    test('neutralizuje <script> payload', () => {
        expect(escapeHtml('<script>alert(1)</script>'))
            .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
    test('neutralizuje atributový breakout', () => {
        expect(escapeHtml('" onmouseover="alert(1)'))
            .toBe('&quot; onmouseover=&quot;alert(1)');
    });
    test('ampersand jako první (nedvojité escapování)', () => {
        expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
    });
    test('prázdné / null / undefined → prázdný řetězec', () => {
        expect(escapeHtml('')).toBe('');
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });
    test('čísla se převedou na řetězec', () => {
        expect(escapeHtml(42)).toBe('42');
    });
    test('běžný text zůstane beze změny', () => {
        expect(escapeHtml('Jan Novák, sp. zn. 12 C 3/2025')).toBe('Jan Novák, sp. zn. 12 C 3/2025');
    });
});
