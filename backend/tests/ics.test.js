/**
 * Testy generátoru .ics (backend/lib/ics.js). Dřív se ICS stavěl na třech místech
 * a jinde syrově (čárka/středník/newline rozbily událost). Testy zamykají
 * escapování dle RFC 5545 i strukturu události.
 */

const ics = require('../lib/ics');

describe('escapeIcsText (RFC 5545)', () => {
    test('escapuje zpětné lomítko, středník, čárku a nový řádek', () => {
        expect(ics.escapeIcsText('a,b;c\nd\\e')).toBe('a\\,b\\;c\\nd\\\\e');
    });
    test('null/undefined → prázdný řetězec', () => {
        expect(ics.escapeIcsText(null)).toBe('');
    });
});

describe('icsStamp', () => {
    test('kompaktní UTC bez pomlček/dvojteček/milisekund + Z', () => {
        expect(ics.icsStamp(new Date('2026-07-20T09:30:00.123Z'))).toBe('20260720T093000Z');
    });
});

describe('buildIcs — celodenní událost', () => {
    const out = ics.buildIcs({
        id: 'lhuta1', title: 'Lhůta', date: '2026-07-20',
        description: 'Odvolání', stamp: new Date('2026-07-01T00:00:00Z')
    });

    test('má kostru VCALENDAR/VEVENT a UID s doménou', () => {
        expect(out).toContain('BEGIN:VCALENDAR');
        expect(out).toContain('BEGIN:VEVENT');
        expect(out).toContain('UID:lhuta1@lexislocal');
        expect(out).toContain('DTSTAMP:20260701T000000Z');
    });
    test('celodenní DTSTART/DTEND (DTEND = následující den)', () => {
        expect(out).toContain('DTSTART;VALUE=DATE:20260720');
        expect(out).toContain('DTEND;VALUE=DATE:20260721');
    });
    test('CRLF konce řádků', () => {
        expect(out).toContain('\r\n');
    });
    test('bez alarmu a bez STATUS, když se nezadá', () => {
        expect(out).not.toContain('BEGIN:VALARM');
        expect(out).not.toContain('STATUS:CANCELLED');
    });
});

describe('buildIcs — escapování a příznaky', () => {
    test('SUMMARY/DESCRIPTION/LOCATION se escapují', () => {
        const out = ics.buildIcs({ id: 'x', title: 'Věc, s čárkou; a středníkem', date: '2026-01-01', location: 'Brno, ČR' });
        expect(out).toContain('SUMMARY:Věc\\, s čárkou\\; a středníkem');
        expect(out).toContain('LOCATION:Brno\\, ČR');
    });
    test('zrušená událost → STATUS:CANCELLED', () => {
        expect(ics.buildIcs({ id: 'x', title: 'X', date: '2026-01-01', isCancelled: true })).toContain('STATUS:CANCELLED');
    });
    test('alarm → VALARM s výchozím triggerem -P1D', () => {
        const out = ics.buildIcs({ id: 'x', title: 'X', date: '2026-01-01', alarm: true });
        expect(out).toContain('BEGIN:VALARM');
        expect(out).toContain('TRIGGER:-P1D');
        expect(out).toContain('END:VALARM');
    });
    test('vlastní alarmTrigger', () => {
        expect(ics.buildIcs({ id: 'x', title: 'X', date: '2026-01-01', alarm: true, alarmTrigger: '-PT2H' })).toContain('TRIGGER:-PT2H');
    });
});

describe('buildIcs — časovaná událost', () => {
    test('DTSTART s TZID Europe/Prague a časem', () => {
        const out = ics.buildIcs({ id: 'x', title: 'Jednání', date: '2026-07-20', time: '09:30' });
        expect(out).toContain('DTSTART;TZID=Europe/Prague:20260720T093000');
        expect(out).toContain('DTEND;TZID=Europe/Prague:');
    });
});

describe('sanitizeFileName', () => {
    test('nepovolené znaky → _, česká písmena zůstanou, ořez na 100', () => {
        expect(ics.sanitizeFileName('Lhůta: 12 C 34/2026')).toBe('Lhůta__12_C_34_2026');
        expect(ics.sanitizeFileName('a'.repeat(150)).length).toBe(100);
        expect(ics.sanitizeFileName(null)).toBe('');
    });
});
