/**
 * Testy výpočtu a detekce lhůt v jednotkách (backend/lib/extraction.js) —
 * calculateDeadlineByUnit (§ 57/2: měsíce/týdny/roky) a detectDeadlines.
 * calculateDeadlineDate (dny) má vlastní test v deadlineExtraction.test.js;
 * tady ověřujeme, že přes něj delegovaná denní jednotka sedí.
 */
const { calculateDeadlineByUnit, calculateDeadlineDate, detectDeadlines } = require('../lib/extraction');

describe('calculateDeadlineByUnit (§ 57 odst. 2)', () => {
    test('měsíce: shoda čísla dne (2 měsíce od 30. 4. 2025 → 30. 6. 2025)', () => {
        expect(calculateDeadlineByUnit(2, 'month', '2025-04-30')).toBe('2025-06-30');
    });
    test('měsíce: ošetření konce měsíce (31. 1. + 1 měsíc → 28. 2. 2025)', () => {
        expect(calculateDeadlineByUnit(1, 'month', '2025-01-31')).toBe('2025-02-28');
    });
    test('týdny: 2 týdny (Po 6. 1. 2025 → Po 20. 1. 2025)', () => {
        expect(calculateDeadlineByUnit(2, 'week', '2025-01-06')).toBe('2025-01-20');
    });
    test('den je shodný s calculateDeadlineDate (zpětná kompatibilita)', () => {
        ['2026-06-01', '2026-06-05', '2026-03-22'].forEach(base => {
            expect(calculateDeadlineByUnit(15, 'day', base)).toBe(calculateDeadlineDate(15, base));
        });
    });
    test('amount ≤ 0 → null', () => {
        expect(calculateDeadlineByUnit(0, 'month', '2025-01-01')).toBeNull();
        expect(calculateDeadlineByUnit(null, 'day', '2025-01-01')).toBeNull();
    });
});

describe('detectDeadlines (backend, zrcadlí editor)', () => {
    const u = (t) => detectDeadlines(t).map(d => `${d.amount} ${d.unit}`);
    test('měsíce slovní i číslicí', () => {
        expect(u('Dovolání lze podat do dvou měsíců od doručení.')).toContain('2 month');
        expect(u('Žalobu podejte nejpozději do 2 měsíců.')).toContain('2 month');
    });
    test('dny a týdny', () => {
        const r = u('Odvolání do 15 dnů; kasační stížnost do 2 týdnů.');
        expect(r).toContain('15 day');
        expect(r).toContain('2 week');
    });
    test('NEfalešně: dvouletá smlouva není lhůta', () => {
        expect(u('Smlouva se uzavírá na dobu 2 let.')).toEqual([]);
    });
});
