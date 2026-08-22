/**
 * Testy kontroly DPH / nespolehlivého plátce (registries.checkVatReliability).
 * Mockovaný fetch, fail-closed, žádná fabrikace.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_vat_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_vat_key_${Date.now()}`);

const r = require('../lib/registries');
const resp = (attr) => `<env><Body><StatusNespolehlivyPlatceResponse><statusPlatceDPH nespolehlivyPlatce="${attr}" cisloFu="001"/></StatusNespolehlivyPlatceResponse></Body></env>`;

describe('DPH / nespolehlivý plátce', () => {
    test('NE → spolehlivý plátce DPH', async () => {
        const res = await r.checkVatReliability('CZ45274649', { fetchUrl: async () => resp('NE') });
        expect(res.available).toBe(true);
        expect(res.unreliable).toBe(false);
        expect(res.isVatPayer).toBe(true);
    });

    test('ANO → nespolehlivý plátce', async () => {
        const res = await r.checkVatReliability('45274649', { fetchUrl: async () => resp('ANO') });
        expect(res.unreliable).toBe(true);
    });

    test('bez atributu → nenalezen, žádná fabrikace', async () => {
        const res = await r.checkVatReliability('45274649', { fetchUrl: async () => '<env><Body><x><statusText>Subjekt nenalezen</statusText></x></Body></env>' });
        expect(res.available).toBe(true);
        expect(res.isVatPayer).toBe(false);
    });

    test('výpadek sítě → available:false', async () => {
        const res = await r.checkVatReliability('45274649', { fetchUrl: async () => { throw new Error('down'); } });
        expect(res.available).toBe(false);
    });

    test('neplatné DIČ → available:false', async () => {
        expect((await r.checkVatReliability('12')).available).toBe(false);
    });
});
