/**
 * Testy deterministického parseru termínů (schedulingParse) — bez AI.
 */
'use strict';
const p = require('../lib/schedulingParse');

// Referenční „dnes": sobota 22. 8. 2026.
const NOW = new Date(2026, 7, 22);

describe('detectSchedulingIntent', () => {
    test('rozpozná žádost o schůzku', () => {
        expect(p.detectSchedulingIntent('domluv schůzku s klientem')).toBe(true);
        expect(p.detectSchedulingIntent('Sejdeme se ve čtvrtek')).toBe(true);
        expect(p.detectSchedulingIntent('rezervuj termín')).toBe(true);
    });
    test('nereaguje na nesouvisející zadání', () => {
        expect(p.detectSchedulingIntent('sepiš žalobu na dlužníka')).toBe(false);
    });
});

describe('parseMeeting', () => {
    test('den v týdnu + čas + délka', () => {
        expect(p.parseMeeting('Schůzka ve čtvrtek ve 14:00 na hodinu', NOW))
            .toEqual({ date: '2026-08-27', time: '14:00', durationMin: 60, location: '' });
    });
    test('zítra + čas + půl hodiny', () => {
        expect(p.parseMeeting('Sejdeme se zítra v 9:30, potrvá to půl hodiny.', NOW))
            .toMatchObject({ date: '2026-08-23', time: '09:30', durationMin: 30 });
    });
    test('explicitní datum + "na 2 hodiny" + místo', () => {
        expect(p.parseMeeting('Termín 3.9. v 10:00 na 2 hodiny u soudu v Brně.', NOW))
            .toMatchObject({ date: '2026-09-03', time: '10:00', durationMin: 120 });
    });
    test('"ve 14 hodin" je ČAS, ne délka (default 60)', () => {
        expect(p.parseMeeting('Schůzka 15.12.2026 ve 14 hodin.', NOW))
            .toEqual({ date: '2026-12-15', time: '14:00', durationMin: 60, location: '' });
    });
    test('bez konkrétního data/času → null (nehádá, fail-closed)', () => {
        expect(p.parseMeeting('Domluv někdy schůzku.', NOW)).toBeNull();
    });
});
