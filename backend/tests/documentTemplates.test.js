/**
 * Testy modulu šablon (documentTemplates) — šablonový režim Spisovatele.
 * Bez sítě, bez modelu: čistě deterministická detekce typu, extrakce slotů
 * a rendering s ověřenými paragrafy. Kritické pro pilot (nahrazuje nespolehlivou
 * volnou generaci u běžných podání).
 */
'use strict';

const T = require('../lib/documentTemplates');

describe('detectDocumentType', () => {
    test('předžalobní výzva (i s tagem [Spisovatel])', () => {
        expect(T.detectDocumentType('[Spisovatel] Sepiš předžalobní výzvu k úhradě 15 000 Kč')).toBe('predzalobni_vyzva');
    });
    test('„výzva k úhradě" → předžalobní výzva', () => {
        expect(T.detectDocumentType('výzva k úhradě 500 Kč')).toBe('predzalobni_vyzva');
    });
    test('žaloba o zaplacení', () => {
        expect(T.detectDocumentType('Připrav žalobu o zaplacení 1 500 000 Kč')).toBe('zaloba_o_zaplaceni');
    });
    test('odvolání (končí diakritikou — nesmí selhat na \\b)', () => {
        expect(T.detectDocumentType('Sepiš odvolání proti rozsudku')).toBe('odvolani');
    });
    test('smlouva', () => {
        expect(T.detectDocumentType('Vytvoř smlouvu o dílo')).toBe('smlouva');
    });
    test('„předžalobní" NESMÍ spadnout do žaloby (pořadí detekce)', () => {
        expect(T.detectDocumentType('předžalobní výzva')).toBe('predzalobni_vyzva');
    });
    test('nerozpoznané zadání → null (→ volná generace)', () => {
        expect(T.detectDocumentType('Napiš mi shrnutí případu')).toBeNull();
        expect(T.detectDocumentType('')).toBeNull();
    });
});

describe('extractCastka', () => {
    test('mezery po tisících', () => {
        expect(T.extractCastka('dluh 15 000 Kč').text).toBe('15 000 Kč');
    });
    test('bez mezer', () => {
        expect(T.extractCastka('15000 Kč').value).toBe(15000);
    });
    test('tečkový tisícový oddělovač + ,-', () => {
        expect(T.extractCastka('cena 250.000,- Kč').text).toBe('250 000 Kč');
    });
    test('milionová částka se seskupí', () => {
        expect(T.extractCastka('1 500 000 Kč').text).toBe('1 500 000 Kč');
    });
    test('haléře se zachovají', () => {
        expect(T.extractCastka('15 000,50 Kč').text).toBe('15 000,50 Kč');
    });
    test('bez částky → null', () => {
        expect(T.extractCastka('žádná částka')).toBeNull();
    });
});

describe('extractLhuta', () => {
    test('„14 dnů" (končí diakritikou)', () => {
        expect(T.extractLhuta('splatností 14 dnů').days).toBe(14);
    });
    test('„do 15 dní"', () => {
        expect(T.extractLhuta('do 15 dní').days).toBe(15);
    });
    test('skloňování: 3 dny', () => {
        expect(T.extractLhuta('do 3 dnů').text).toBe('3 dny');
    });
    test('skloňování: 1 den', () => {
        expect(T.extractLhuta('1 den').text).toBe('1 den');
    });
    test('bez lhůty → null', () => {
        expect(T.extractLhuta('bez lhůty tady')).toBeNull();
    });
});

describe('extractIco', () => {
    test('IČO s 8 číslicemi', () => {
        expect(T.extractIco('IČO 27074358')).toBe('27074358');
    });
    test('samotné 8místné číslo bez označení IČO → null (neplete s částkou)', () => {
        expect(T.extractIco('12345678')).toBeNull();
    });
});

describe('renderTemplate / tryTemplate — ověřené paragrafy', () => {
    test('předžalobní výzva obsahuje § 142a a doplněnou částku i lhůtu', () => {
        const r = T.tryTemplate('Sepiš předžalobní výzvu k úhradě 15 000 Kč se splatností 14 dnů');
        expect(r.matched).toBe(true);
        expect(r.type).toBe('predzalobni_vyzva');
        expect(r.markdown).toContain('§ 142a');
        expect(r.markdown).toContain('15 000 Kč');
        expect(r.markdown).toContain('14 dnů');
        expect(r.warnings).toHaveLength(0);
    });
    test('lhůta < 7 dnů → upozornění dle § 142a', () => {
        const r = T.tryTemplate('výzva k úhradě 500 Kč do 3 dnů');
        expect(r.warnings.length).toBeGreaterThan(0);
        expect(r.warnings[0]).toMatch(/7 dn/);
    });
    test('žaloba obsahuje § 79 odst. 1 a žalobní petit', () => {
        const r = T.tryTemplate('žaloba o zaplacení 1 500 000 Kč');
        expect(r.markdown).toContain('§ 79 odst. 1');
        expect(r.markdown).toMatch(/petit/i);
        expect(r.markdown).toContain('1 500 000 Kč');
    });
    test('odvolání obsahuje § 205 odst. 2 a lhůtu 15 dnů (§ 204 odst. 1)', () => {
        const r = T.tryTemplate('Sepiš odvolání proti rozsudku');
        expect(r.markdown).toContain('§ 205 odst. 2');
        expect(r.markdown).toContain('§ 204 odst. 1');
        expect(r.markdown).toContain('15 dn');
    });
    test('smlouva odkazuje na zák. 89/2012 Sb.', () => {
        const r = T.tryTemplate('Vytvoř smlouvu o dílo, cena 250.000,- Kč');
        expect(r.markdown).toContain('89/2012 Sb.');
        expect(r.markdown).toContain('250 000 Kč');
    });
    test('nerozpoznaný typ → matched:false (spadne na volnou generaci)', () => {
        expect(T.tryTemplate('Napiš mi shrnutí případu').matched).toBe(false);
    });
    test('podklad od advokáta se propíše do dokumentu (nic se nevymýšlí)', () => {
        const zadani = 'Sepiš předžalobní výzvu k úhradě 15 000 Kč';
        const r = T.tryTemplate(zadani);
        expect(r.markdown).toContain('Podklad od advokáta');
        expect(r.markdown).toContain(zadani);
    });
});
