const db = require('../lib/database');
const timeTracker = require('../lib/timetracking');

describe('TimeTracker Utility (Mocked DB)', () => {
    let insertSpy;

    beforeEach(() => {
        // Mock the db.insert method
        insertSpy = jest.spyOn(db, 'insert').mockImplementation((collection, data) => {
            return { id: 'mock-id-123', ...data };
        });
    });

    afterEach(() => {
        // Restore the original implementation
        insertSpy.mockRestore();
    });

    it('should log activity with valid arguments correctly via mocked db.insert', () => {
        const result = timeTracker.logActivity('Case File A', 60, 'review');

        expect(insertSpy).toHaveBeenCalledTimes(1);
        expect(insertSpy).toHaveBeenCalledWith('activities', {
            documentName: 'Case File A',
            activeSeconds: 60,
            actionType: 'review',
            timestamp: expect.any(String) // We expect a valid timestamp string
        });

        expect(result).toEqual({
            id: 'mock-id-123',
            documentName: 'Case File A',
            activeSeconds: 60,
            actionType: 'review',
            timestamp: expect.any(String)
        });
    });

    it('should log activity with default arguments correctly via mocked db.insert', () => {
        const result = timeTracker.logActivity(null);

        expect(insertSpy).toHaveBeenCalledTimes(1);
        expect(insertSpy).toHaveBeenCalledWith('activities', {
            documentName: 'Nepojmenovaný dokument',
            activeSeconds: 30,
            actionType: 'edit',
            timestamp: expect.any(String)
        });

        expect(result.documentName).toBe('Nepojmenovaný dokument');
        expect(result.activeSeconds).toBe(30);
        expect(result.actionType).toBe('edit');
    });

    it('should log activity with date string override correctly via mocked db.insert', () => {
        const overrideDateStr = '2025-01-01T12:00:00.000Z';
        const result = timeTracker.logActivity('Case File B', 45, 'write', overrideDateStr);

        expect(insertSpy).toHaveBeenCalledTimes(1);
        expect(insertSpy).toHaveBeenCalledWith('activities', {
            documentName: 'Case File B',
            activeSeconds: 45,
            actionType: 'write',
            timestamp: overrideDateStr
        });

        expect(result.timestamp).toBe(overrideDateStr);
    });

    it('should handle falsy activeSeconds by defaulting to 30 via mocked db.insert', () => {
        const result = timeTracker.logActivity('Case File C', 0, 'idle');

        expect(insertSpy).toHaveBeenCalledTimes(1);
        expect(insertSpy).toHaveBeenCalledWith('activities', {
            documentName: 'Case File C',
            activeSeconds: 30, // parseInt(0) is 0, which is falsy, so it defaults to 30
            actionType: 'idle',
            timestamp: expect.any(String)
        });

        expect(result.activeSeconds).toBe(30);
    });
});

describe('aggregateActivities + totalHoursFromSummary (přesnost fakturace)', () => {
    const tt = require('../lib/timetracking');
    const acts = (arr) => arr.map(([documentName, activeSeconds, actionType]) =>
        ({ documentName, activeSeconds, actionType, timestamp: '2025-01-01T10:00:00Z' }));

    test('agregace sčítá sekundy a sbírá akce po dokumentech', () => {
        const s = tt.aggregateActivities(acts([['A', 3600, 'edit'], ['A', 1800, 'review'], ['B', 900, 'edit']]));
        const a = s.find(x => x.documentName === 'A');
        expect(a.totalSeconds).toBe(5400);
        expect(a.saves).toBe(2);
    });

    test('celkový součet se počítá z SEKUND, ne ze zaokrouhlených hodin (3×50s → 0.04, ne 0.03)', () => {
        const s = tt.aggregateActivities(acts([['A', 50, 'e'], ['B', 50, 'e'], ['C', 50, 'e']]));
        expect(tt.totalHoursFromSummary(s)).toBe(0.04);
    });

    test('bez float šumu (0.1 h + 0.2 h → 0.3)', () => {
        const s = tt.aggregateActivities(acts([['A', 360, 'e'], ['B', 720, 'e']]));
        expect(tt.totalHoursFromSummary(s)).toBe(0.3);
    });

    test('1 h + 0,5 h → 1.5; prázdné → 0', () => {
        const s = tt.aggregateActivities(acts([['A', 3600, 'e'], ['B', 1800, 'e']]));
        expect(tt.totalHoursFromSummary(s)).toBe(1.5);
        expect(tt.totalHoursFromSummary([])).toBe(0);
    });
});
