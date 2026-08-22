/**
 * Testy judikaturního provideru (legalSources/providers/justice) a enrichmentu
 * spisových značek ve verifieru. Mockovaný fetch/provider, fail-closed.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_just_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_just_key_${Date.now()}`);

const justice = require('../lib/legalSources/providers/justice');
const ls = require('../lib/legalSources');
const cv = require('../lib/citation_verifier');

afterEach(() => {
    ls._resetProviders();
    delete process.env.LEXIS_JUSTICE_ENABLED;
    delete process.env.LEXIS_JUSTICE_URL;
});

describe('justice.cz caseLaw provider', () => {
    beforeEach(() => {
        process.env.LEXIS_JUSTICE_ENABLED = '1';
        process.env.LEXIS_JUSTICE_URL = 'https://data.example/justice';
    });

    test('default bez konfigurace = vypnuto', () => {
        delete process.env.LEXIS_JUSTICE_ENABLED;
        expect(justice.isEnabled()).toBe(false);
    });

    test('nalezená sp. zn. → found:true', async () => {
        justice._setFetchForTests(async () => ({ ok: true, json: async () => ({ items: [{ id: 1 }] }) }));
        expect(await justice.verifyCaseLaw({ spisZn: '26 Cdo 1230/2021' })).toEqual({ found: true });
    });

    test('nenalezená → found:false', async () => {
        justice._setFetchForTests(async () => ({ ok: true, json: async () => ({ items: [] }) }));
        expect(await justice.verifyCaseLaw({ spisZn: '99 Xx 9/9999' })).toEqual({ found: false });
    });

    test('výpadek → null', async () => {
        justice._setFetchForTests(async () => { throw new Error('down'); });
        expect(await justice.verifyCaseLaw({ spisZn: '26 Cdo 1230/2021' })).toBeNull();
    });
});

describe('enrichment spisové značky ve verifieru', () => {
    const text = 'Viz rozhodnutí 26 Cdo 1230/2021.';
    const ref = { laws: {}, caseNumbers: new Set() };

    test('zdroj potvrdí judikát → verified_by_source', async () => {
        ls._setProvidersForTests([{ name: 'justice.cz', capabilities: ['caseLaw'], isEnabled: () => true, verifyCaseLaw: async () => ({ found: true }) }]);
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: ref });
        expect(en.citations.find(c => c.type === 'judikat').status).toBe('verified_by_source');
    });

    test('nedostupný zdroj → judikát beze změny (fail-closed)', async () => {
        const baseStatus = cv.verifyCitations(text, { referenceIndex: ref }).citations.find(c => c.type === 'judikat').status;
        ls._setProvidersForTests([{ name: 'x', capabilities: ['caseLaw'], isEnabled: () => true, verifyCaseLaw: async () => null }]);
        const en = await cv.verifyCitationsWithSources(text, { referenceIndex: ref });
        expect(en.citations.find(c => c.type === 'judikat').status).toBe(baseStatus);
    });
});
