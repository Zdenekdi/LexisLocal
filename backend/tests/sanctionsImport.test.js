/**
 * Testy importéru sankčních seznamů (lib/sanctionsImport) + celého řetězu
 * import → zápis → načtení do sanctions engine → screening. Bez sítě (fixtury).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_simport_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_simport_key_${Date.now()}`);

const imp = require('../lib/sanctionsImport');
const sanctions = require('../lib/sanctions');

describe('parsery sankčních seznamů', () => {
    test('OFAC CSV: jméno + program, přeskočí prázdné', () => {
        const e = imp.parseOfacCsv('1,"Ivan Hrozny",individual,RUSSIA-EO14024,-0-\n2,-0-,,,');
        expect(e.length).toBe(1);
        expect(e[0]).toMatchObject({ name: 'Ivan Hrozny', list: 'OFAC', program: 'RUSSIA-EO14024' });
    });

    test('EU XML: wholeName jako jméno + aliasy + programme', () => {
        const e = imp.parseEuXml('<x><sanctionEntity><nameAlias wholeName="Ivan Hrozny"/><nameAlias wholeName="Ivan Terrible"/><regulation programme="RU"/></sanctionEntity></x>');
        expect(e.length).toBe(1);
        expect(e[0].name).toBe('Ivan Hrozny');
        expect(e[0].aliases).toContain('Ivan Terrible');
        expect(e[0].list).toBe('EU');
    });

    test('UN XML: složené jméno + alias', () => {
        const e = imp.parseUnXml('<C><INDIVIDUAL><FIRST_NAME>Ivan</FIRST_NAME><SECOND_NAME>Hrozny</SECOND_NAME><ALIAS_NAME>Groznyj</ALIAS_NAME></INDIVIDUAL></C>');
        expect(e.length).toBe(1);
        expect(e[0].name).toBe('Ivan Hrozny');
        expect(e[0].aliases).toContain('Groznyj');
        expect(e[0].list).toBe('UN');
    });

    test('buildNormalized dedupuje podle jména napříč zdroji', () => {
        const merged = imp.buildNormalized({
            ofacCsv: '1,"Ivan Hrozny",individual,OFACPROG',
            euXml: '<sanctionEntity><nameAlias wholeName="Ivan Hrozny"/></sanctionEntity>'
        });
        expect(merged.length).toBe(1);
    });
});

describe('řetěz import → engine → screening', () => {
    afterEach(() => sanctions._reset());

    test('sestavený seznam se zapíše, načte a screening najde shodu', () => {
        const entries = imp.buildNormalized({ ofacCsv: '1,"Ivan Hrozny",individual,RU' });
        const outFile = path.join(os.tmpdir(), `lexis_sanctions_${Date.now()}.json`);
        imp.writeList(entries, outFile);
        expect(fs.existsSync(outFile)).toBe(true);

        const loaded = sanctions.loadList({ file: outFile, source: 'test-import' });
        expect(loaded.available).toBe(true);
        const r = sanctions.screenName('ivan hrozny');
        expect(r.matches.length).toBe(1);
    });
});
