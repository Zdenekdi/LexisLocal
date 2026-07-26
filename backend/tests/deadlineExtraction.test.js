/**
 * Testy výpočtu lhůty (backend/lib/extraction.js calculateDeadlineDate) — posun
 * posledního dne na nejbližší NÁSLEDUJÍCÍ pracovní den při víkendu/svátku
 * (§ 57 odst. 2 o.s.ř.), včetně pohyblivých Velikonoc. Právně kritické, dnes bez testů.
 */

const { calculateDeadlineDate } = require('../lib/extraction');

describe('calculateDeadlineDate (§ 57)', () => {
    test('běžný pracovní den se neposouvá', () => {
        // 2026-06-01 (Po) + 15 = 2026-06-16 (Út) — pracovní
        expect(calculateDeadlineDate(15, '2026-06-01')).toBe('2026-06-16');
    });

    test('lhůta padne na sobotu → nejbližší následující pracovní den (pondělí)', () => {
        // 2026-06-05 (Pá) + 15 = 2026-06-20 (So) → 2026-06-22 (Po)
        expect(calculateDeadlineDate(15, '2026-06-05')).toBe('2026-06-22');
    });

    test('řetěz neděle + svátek (5.–6. 7.) → úterý', () => {
        // 2026-06-20 + 15 = 2026-07-05 (Ne, svátek), 6.7. svátek → 7.7. (Út)
        expect(calculateDeadlineDate(15, '2026-06-20')).toBe('2026-07-07');
    });

    test('Velikonoční pondělí (pohyblivý svátek) se přeskočí', () => {
        // Velikonoce 2026: neděle 5.4., pondělí 6.4. (svátek) → 2026-03-22 + 15 = 6.4. → 7.4.
        expect(calculateDeadlineDate(15, '2026-03-22')).toBe('2026-04-07');
    });

    test('bez počtu dní → null', () => {
        expect(calculateDeadlineDate(0, '2026-06-01')).toBeNull();
        expect(calculateDeadlineDate(null, '2026-06-01')).toBeNull();
    });

    test('výsledek je vždy pracovní den (fuzz)', () => {
        const dow = (iso) => new Date(iso + 'T12:00:00').getDay();
        for (let n = 1; n <= 40; n++) {
            const r = calculateDeadlineDate(n, '2026-01-05');
            expect(dow(r)).not.toBe(0); // ne neděle
            expect(dow(r)).not.toBe(6); // ne sobota
        }
    });
});
