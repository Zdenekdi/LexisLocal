/**
 * Testy hearings (../lib/hearings.js) — perzistence hlídaných jednání a ICS generátor.
 * checkAllHearings (síť/portál) se netestuje; testujeme čisté a souborové funkce.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadMonitoredHearings, saveMonitoredHearings, generateIcs } = require('../lib/hearings');

describe('load/save monitored hearings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexis_hearings_'));
    afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });

    test('prázdný adresář → []', () => {
        expect(loadMonitoredHearings(dir)).toEqual([]);
    });

    test('round-trip save → load', () => {
        const data = [{ id: 'h1', title: 'Jednání', dueDate: '2026-09-01' }];
        saveMonitoredHearings(dir, data);
        expect(loadMonitoredHearings(dir)).toEqual(data);
    });

    test('poškozený soubor → [] (nespadne)', () => {
        fs.writeFileSync(path.join(dir, '.hearings.json'), '{ rozbité json', 'utf-8');
        expect(loadMonitoredHearings(dir)).toEqual([]);
    });
});

describe('generateIcs', () => {
    test('celodenní událost má DTSTART;VALUE=DATE a validní obálku', () => {
        const ics = generateIcs('h1', 'Jednání KS', '2026-09-01', '', 'Brno', 'poznámka', false);
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('END:VCALENDAR');
        expect(ics).toContain('UID:h1@lexislocal');
        expect(ics).toContain('DTSTART;VALUE=DATE:20260901');
        expect(ics).toContain('SUMMARY:Jednání KS');
        // řádky oddělené CRLF dle RFC 5545
        expect(ics).toContain('\r\n');
    });

    test('časovaná událost má TZID Europe/Prague', () => {
        const ics = generateIcs('h2', 'Jednání', '2026-09-01', '10:30', '', '', false);
        expect(ics).toContain('DTSTART;TZID=Europe/Prague:20260901T103000');
        expect(ics).toContain('DTEND;TZID=Europe/Prague:');
    });

    test('zrušené jednání → STATUS:CANCELLED a prefix ❌', () => {
        const ics = generateIcs('h3', 'Jednání', '2026-09-01', '', '', '', true);
        expect(ics).toContain('STATUS:CANCELLED');
        expect(ics).toContain('SUMMARY:❌ ZRUŠENO: Jednání');
    });

    test('escapuje čárky/středníky/nové řádky v textu (RFC 5545)', () => {
        const ics = generateIcs('h4', 'A, B; C', '2026-09-01', '', 'Praha, 1', 'řádek1\nřádek2', false);
        expect(ics).toContain('SUMMARY:A\\, B\\; C');
        expect(ics).toContain('LOCATION:Praha\\, 1');
        expect(ics).toContain('DESCRIPTION:řádek1\\nřádek2');
    });
});
