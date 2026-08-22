/**
 * Testy sankčního screeningu (lib/sanctions) a jeho napojení do AML (lib/aml).
 * Klíčové: FAIL-CLOSED — bez načteného seznamu je available:false a AML dál
 * nastaví needsManualScreening=true; shoda přidá vysoce rizikový faktor; absence
 * shody NIKDY neznamená „čistý".
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_sanctions_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_sanctions_key_${Date.now()}`);

const sanctions = require('../lib/sanctions');
const aml = require('../lib/aml');

const LIST = [{ name: 'Ivan Hrozný', aliases: ['Ivan Terrible'], list: 'EU', program: 'RU/2022' }];

afterEach(() => sanctions._reset());

describe('sanctions engine', () => {
    test('bez načteného seznamu → available:false (fail-closed)', () => {
        sanctions._reset();
        const r = sanctions.screenName('kdokoliv');
        expect(r.available).toBe(false);
        expect(r.matches).toEqual([]);
    });

    test('načtený seznam: shoda podle jména i bez diakritiky', () => {
        sanctions.loadList({ entries: LIST, source: 'test-EU' });
        const r = sanctions.screenName('ivan hrozny');
        expect(r.available).toBe(true);
        expect(r.matches.length).toBe(1);
        expect(r.matches[0].list).toBe('EU');
    });

    test('shoda přes alias', () => {
        sanctions.loadList({ entries: LIST });
        expect(sanctions.screenName('Ivan Terrible').matches.length).toBe(1);
    });

    test('nesouvisející jméno → žádná shoda (ale available:true)', () => {
        sanctions.loadList({ entries: LIST });
        const r = sanctions.screenName('Jan Novák');
        expect(r.available).toBe(true);
        expect(r.matches).toEqual([]);
    });
});

describe('AML + sankční seznam', () => {
    test('bez seznamu: needsManualScreening=true, sanctionsListAvailable=false', async () => {
        sanctions._reset();
        const rec = await aml.identify({ typ: 'FO', jmeno: 'Jan Novák', adresa: 'Praha', rc: 'x' });
        expect(rec.needsManualScreening).toBe(true);
        expect(rec.sanctionsListAvailable).toBe(false);
        expect(rec.sanctionsHits.length).toBe(0);
    });

    test('se seznamem a shodou: vysoce rizikový faktor, ale manual stále nutný', async () => {
        sanctions.loadList({ entries: LIST, source: 'test-EU' });
        const rec = await aml.identify({ typ: 'FO', jmeno: 'Ivan Hrozný', adresa: 'Moskva', rc: 'x' });
        expect(rec.sanctionsListAvailable).toBe(true);
        expect(rec.sanctionsHits.length).toBe(1);
        expect(rec.factors.some(f => f.code === 'sankcni_shoda_oficialni' && f.severity === 'high')).toBe(true);
        expect(rec.risk).toBe('high');
        expect(rec.needsManualScreening).toBe(true);
    });
});
