/**
 * Testy ISDS vyhledání datové schránky (registries.findDataBox). Mockovaný fetch,
 * žádná síť. Klíčové: NIKDY nefabrikuje ID — bez konfigurace/shody vrací poctivé
 * "není k dispozici"; při více shodách je výsledek nejednoznačný (fail-closed).
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_isds_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_isds_key_${Date.now()}`);

const r = require('../lib/registries');

const mkFetch = (xml) => async (url, opts) => {
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    return xml;
};

afterEach(() => { delete process.env.ISDS_LOGIN; delete process.env.ISDS_PASSWORD; });

describe('ISDS findDataBox', () => {
    test('bez přihlašovacích údajů → available:false, žádné ID', async () => {
        const res = await r.findDataBox('45274649');
        expect(res.available).toBe(false);
        expect(res.configured).toBe(false);
        expect(res.dataBoxId).toBeUndefined();
    });

    test('neplatné IČO → available:false', async () => {
        const res = await r.findDataBox('123');
        expect(res.available).toBe(false);
    });

    test('nalezená schránka → found + dataBoxId + jméno', async () => {
        process.env.ISDS_LOGIN = 'user'; process.env.ISDS_PASSWORD = 'pass';
        const res = await r.findDataBox('45274649', { fetchUrl: mkFetch('<x><dbID>abc123xyz</dbID><firmName>ČEZ, a. s.</firmName></x>') });
        expect(res.found).toBe(true);
        expect(res.dataBoxId).toBe('abc123xyz');
        expect(res.subjectName).toBe('ČEZ, a. s.');
    });

    test('bez shody → found:false a žádné ID', async () => {
        process.env.ISDS_LOGIN = 'user'; process.env.ISDS_PASSWORD = 'pass';
        const res = await r.findDataBox('45274649', { fetchUrl: mkFetch('<x></x>') });
        expect(res.found).toBe(false);
        expect(res.available).toBe(true);
        expect(res.dataBoxId).toBeUndefined();
    });

    test('více shod → ambiguous + candidates, nevybírá automaticky', async () => {
        process.env.ISDS_LOGIN = 'user'; process.env.ISDS_PASSWORD = 'pass';
        const res = await r.findDataBox('45274649', { fetchUrl: mkFetch('<x><dbID>id1</dbID><dbID>id2</dbID></x>') });
        expect(res.found).toBe(false);
        expect(res.ambiguous).toBe(true);
        expect(res.candidates).toEqual(['id1', 'id2']);
    });

    test('výpadek sítě → available:false, žádné ID', async () => {
        process.env.ISDS_LOGIN = 'user'; process.env.ISDS_PASSWORD = 'pass';
        const res = await r.findDataBox('45274649', { fetchUrl: async () => { throw new Error('down'); } });
        expect(res.available).toBe(false);
        expect(res.dataBoxId).toBeUndefined();
    });
});
