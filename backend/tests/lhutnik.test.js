/**
 * Testy centrálního lhůtníku (backend/lib/lhutnik.js) — agregace lhůt napříč
 * inboxem, urgence (overdue/urgent/soon/ok), potvrzení a odložení needsReview lhůt.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tempWatchDir = path.join(os.tmpdir(), `lexis_test_lhutnik_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) fs.mkdirSync(tempWatchDir, { recursive: true });
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const spisy = require('../lib/spisy');
const lhutnik = require('../lib/lhutnik');

const TODAY = '2026-06-01';

function seed() {
    db.set('spisy', []);
    db.set('spis_events', []);
    db.set('inbox_files', [
        {
            id: 'f1', caseNumber: '23 C 120/2026', fileName: 'zaloba.pdf',
            deadlineDate: '2026-09-01', deadlineDays: null, summary: 'ok lhůta',
            detectedDeadlines: [{ amount: 2, unit: 'month', deadlineDate: '2026-06-10', needsReview: true, source: 'ai' }]
        },
        { id: 'f2', caseNumber: '5 T 3/2025', fileName: 'vyzva.pdf', deadlineDate: '2026-05-20', summary: 'po termínu' },
        {
            id: 'f3', caseNumber: '5 T 3/2025', fileName: 'odvolani.pdf',
            detectedDeadlines: [{ amount: 1, unit: 'week', deadlineDate: '2026-06-02', needsReview: true, source: 'regex' }]
        }
    ]);
    spisy.syncFromInbox(); // vytvoří spisy pro obě reálné sp. zn.
}

afterAll(() => {
    if (fs.existsSync(tempWatchDir)) fs.rmSync(tempWatchDir, { recursive: true, force: true });
});

beforeEach(seed);

describe('getLhutnik — agregace a urgence', () => {
    test('sesbírá všechny lhůty, spočítá souhrn a urgenci', () => {
        const { items, summary } = lhutnik.getLhutnik({ today: TODAY });
        expect(items).toHaveLength(4);
        expect(summary.overdue).toBe(1);   // 2026-05-20
        expect(summary.urgent).toBe(1);    // 2026-06-02 (1 den)
        expect(summary.soon).toBe(1);      // 2026-06-10 (9 dní)
        expect(summary.needsReview).toBe(2);
        // seřazeno dle data — po termínu první
        expect(items[0].date).toBe('2026-05-20');
    });

    test('položky jsou navázané na spis (spisId)', () => {
        const { items } = lhutnik.getLhutnik({ today: TODAY });
        expect(items.every(i => i.spisId)).toBe(true);
    });

    test('filtr onlyReview vrátí jen nejisté lhůty', () => {
        const { items } = lhutnik.getLhutnik({ today: TODAY, onlyReview: true });
        expect(items).toHaveLength(2);
        expect(items.every(i => i.needsReview)).toBe(true);
    });
});

describe('confirm / dismiss', () => {
    test('potvrzení sníží počet needsReview a zaloguje úkon do spisu', () => {
        lhutnik.confirmDeadline('f1', 0);
        const { summary } = lhutnik.getLhutnik({ today: TODAY });
        expect(summary.needsReview).toBe(1);
        const spis = spisy.findByCase('23 C 120/2026');
        expect(spisy.getEvents(spis.id).some(e => e.type === 'lhuta')).toBe(true);
    });

    test('odložení skryje lhůtu z přehledu', () => {
        lhutnik.dismissDeadline('f3', 0);
        const { items } = lhutnik.getLhutnik({ today: TODAY });
        expect(items).toHaveLength(3);
        expect(items.find(i => i.fileId === 'f3')).toBeUndefined();
    });

    test('neexistující lhůta/dokument vyhodí chybu', () => {
        expect(() => lhutnik.confirmDeadline('neexistuje', 0)).toThrow();
        expect(() => lhutnik.confirmDeadline('f2', 5)).toThrow();
    });
});

describe('_urgency / _daysLeft', () => {
    test('hranice urgence', () => {
        expect(lhutnik._urgency(lhutnik._daysLeft('2026-05-31', TODAY))).toBe('overdue');
        expect(lhutnik._urgency(lhutnik._daysLeft('2026-06-03', TODAY))).toBe('urgent');
        expect(lhutnik._urgency(lhutnik._daysLeft('2026-06-14', TODAY))).toBe('soon');
        expect(lhutnik._urgency(lhutnik._daysLeft('2026-08-01', TODAY))).toBe('ok');
    });
});
