/**
 * Regresní pojistka proti fikcím/atrapám. Hlídá, že se fabrikovaná data a
 * dříve odstraněné výmysly nevrátí. Doplňuje řádkový audit automatickou kontrolou.
 */
const fs = require('fs');
const path = require('path');

const LIB = path.join(__dirname, '..', 'lib');

describe('Anti-fabrikace: registry (CEE/Katastr)', () => {
    const { checkCee, checkKatastr } = require('../lib/registries');
    afterEach(() => { delete process.env.CEE_API_URL; delete process.env.KATASTR_API_URL; });

    test('bez konfigurace: CEE nevrací žádná data, jen available:false', async () => {
        const r = await checkCee('27082440');
        expect(r.available).toBe(false);
        expect(r.activeExecutions == null).toBe(true);
        expect(r.totalAmount == null).toBe(true);
        expect(String(r.reason || '')).toMatch(/přístup/i);
    });
    test('bez konfigurace: Katastr nevrací žádná data, jen available:false', async () => {
        const r = await checkKatastr('27082440');
        expect(r.available).toBe(false);
        expect(r.hasPlomba == null).toBe(true);
        expect(r.propertiesCount == null).toBe(true);
    });
    test('zdroj registries.js neobsahuje dříve fingovaná čísla', () => {
        const src = fs.readFileSync(path.join(LIB, 'registries.js'), 'utf-8');
        // fabrikovaná CEE/Katastr data z routy (odstraněná)
        expect(src).not.toMatch(/activeExecutions:\s*2\b/);
        expect(src).not.toMatch(/184500/);
    });
    test('routa registries.js negeneruje simulovaná data z číslic IČO', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'registries.js'), 'utf-8');
        expect(src).not.toMatch(/hasPlomba:\s*lastDigit/);
        expect(src).not.toMatch(/activeExecutions:\s*2\b/);
        expect(src).not.toMatch(/SIMULOVÁNO/);
    });
});

describe('Anti-fabrikace: judikatura (žádné vymyšlené citace)', () => {
    test('benchmarky nemají konkrétní (vymyšlené) spisové značky v title', () => {
        const src = fs.readFileSync(path.join(LIB, 'judikatura.js'), 'utf-8');
        expect(src).not.toMatch(/23 Cdo 1234\/2025/);
        expect(src).not.toMatch(/8 As 99\/2026/);
        // title pravidel nesmí obsahovat "sp. zn." (to by značilo konkrétní citaci)
        const titles = (src.match(/title:\s*"([^"]+)"/g) || []).join(' ');
        expect(titles).not.toMatch(/sp\. ?zn\./i);
    });
});
