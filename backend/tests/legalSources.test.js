/**
 * Testy abstrakce právních zdrojů (lib/legalSources) + e-Sbírka provideru
 * + nenásilného napojení do citation_verifier. Vše s mockovaným fetch/providerem
 * (žádná síť). Klíčové: FAIL-CLOSED a že zdroj citaci jen POTVRDÍ, nikdy nedegraduje.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_ls_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_ls_key_${Date.now()}`);

const esbirka = require('../lib/legalSources/providers/esbirka');
const ls = require('../lib/legalSources');
const cv = require('../lib/citation_verifier');

afterEach(() => {
    ls._resetProviders();
    delete process.env.LEXIS_ESBIRKA_ENABLED;
    delete process.env.LEXIS_ESBIRKA_BASE_URL;
});

describe('e-Sbírka provider', () => {
    beforeEach(() => {
        process.env.LEXIS_ESBIRKA_ENABLED = '1';
        process.env.LEXIS_ESBIRKA_BASE_URL = 'https://api.example/esbirka';
    });

    test('výchozí stav bez konfigurace = vypnuto', () => {
        delete process.env.LEXIS_ESBIRKA_ENABLED;
        expect(esbirka.isEnabled()).toBe(false);
    });

    test('po konfiguraci je zapnutý', () => {
        expect(esbirka.isEnabled()).toBe(true);
    });

    test('nalezený zákon → found:true', async () => {
        esbirka._setFetchForTests(async () => ({ ok: true, json: async () => ({ items: [{ cislo: 89, rok: 2012 }] }) }));
        expect(await esbirka.verifyStatute({ law: '89/2012' })).toEqual({ found: true });
    });

    test('nenalezený zákon → found:false', async () => {
        esbirka._setFetchForTests(async () => ({ ok: true, json: async () => ({ items: [] }) }));
        expect(await esbirka.verifyStatute({ law: '999/9999' })).toEqual({ found: false });
    });

    test('výpadek sítě → null (nedostupné)', async () => {
        esbirka._setFetchForTests(async () => { throw new Error('network down'); });
        expect(await esbirka.verifyStatute({ law: '89/2012' })).toBeNull();
    });

    test('HTTP chyba → null (fail-closed)', async () => {
        esbirka._setFetchForTests(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        expect(await esbirka.verifyStatute({ law: '89/2012' })).toBeNull();
    });
});

describe('legalSources agregace', () => {
    test('žádný provider zapnutý → UNKNOWN (no-provider)', async () => {
        ls._setProvidersForTests([{ name: 'x', capabilities: ['statute'], isEnabled: () => false }]);
        expect(await ls.verifyStatute({ law: '89/2012' })).toEqual({ ok: false, reason: 'no-provider' });
    });

    test('provider potvrdí → ok/found/source', async () => {
        ls._setProvidersForTests([{ name: 'MOCK', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => ({ found: true }) }]);
        expect(await ls.verifyStatute({ law: '89/2012' })).toEqual({ ok: true, found: true, source: 'MOCK' });
    });

    test('provider odpoví a nenajde → ok/found:false', async () => {
        ls._setProvidersForTests([{ name: 'MOCK', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => ({ found: false }) }]);
        expect(await ls.verifyStatute({ law: '1/1' })).toEqual({ ok: true, found: false });
    });

    test('provider nedostupný (null) → UNKNOWN (unreachable)', async () => {
        ls._setProvidersForTests([{ name: 'MOCK', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => null }]);
        expect(await ls.verifyStatute({ law: '89/2012' })).toEqual({ ok: false, reason: 'unreachable' });
    });
});

describe('citation_verifier + zdroje (fail-closed)', () => {
    const text = 'Nárok se opírá o zákon č. 89/2012 Sb.';
    const refNo = { laws: { '99/1963': new Set() }, caseNumbers: new Set() };   // 89/2012 NENÍ
    const refYes = { laws: { '89/2012': new Set() }, caseNumbers: new Set() };  // 89/2012 JE

    test('zdroj potvrdí neověřenou citaci → verified_by_source', async () => {
        ls._setProvidersForTests([{ name: 'e-Sbírka', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => ({ found: true }) }]);
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: refNo });
        const z = en.citations.find(c => c.type === 'zakon');
        expect(z.status).toBe('verified_by_source');
        expect(z.verified).toBe(true);
        expect(en.sourcesConsulted).toBe(true);
        expect(en.annotatedText).not.toContain('NEOVĚŘENO');
    });

    test('zdroj nedostupný → citace beze změny (fail-closed)', async () => {
        const base = cv.verifyCitations(text, { referenceIndex: refNo });
        const baseStatus = base.citations.find(c => c.type === 'zakon').status;
        ls._setProvidersForTests([{ name: 'x', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => null }]);
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: refNo });
        expect(en.citations.find(c => c.type === 'zakon').status).toBe(baseStatus);
    });

    test('vypnuté zdroje → chová se jako base (sourcesConsulted:false)', async () => {
        ls._resetProviders(); // esbirka default vypnutá
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: refNo });
        expect(en.sourcesConsulted).toBe(false);
    });

    test('lokálně ověřenou citaci zdroj nikdy nedegraduje', async () => {
        ls._setProvidersForTests([{ name: 'MOCK', capabilities: ['statute'], isEnabled: () => true, verifyStatute: async () => ({ found: false }) }]);
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: refYes });
        expect(en.citations.find(c => c.type === 'zakon').status).toBe('verified');
    });
});
