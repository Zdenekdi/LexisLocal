/**
 * Testy spisové služby (backend/lib/spisy.js) — spis jako entita:
 * párování sp. zn., migrace z inboxu, agregace (dokumenty/lhůty/čas), životní
 * cyklus stavu (archiv → retence, skartace) a spisový deník.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tempWatchDir = path.join(os.tmpdir(), `lexis_test_spisy_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) fs.mkdirSync(tempWatchDir, { recursive: true });
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const spisy = require('../lib/spisy');

function seedInbox() {
    db.set('spisy', []);
    db.set('spis_events', []);
    db.set('activities', [
        { id: 'a1', documentName: 'zaloba.pdf', activeSeconds: 3600, timestamp: '2026-01-01T10:00:00Z' },
        { id: 'a2', documentName: 'vyzva.pdf', activeSeconds: 1800, timestamp: '2026-01-01T11:00:00Z' },
        { id: 'a3', documentName: 'jiny.pdf', activeSeconds: 9999, timestamp: '2026-01-01T12:00:00Z' }
    ]);
    db.set('inbox_files', [
        {
            id: 'f1', caseNumber: '23 C 120/2026', fileName: 'zaloba.pdf', relativePath: 'zaloba.pdf',
            plaintiff: 'Klient s.r.o.', defendant: 'Dlužník a.s.', ico: '12345678',
            deadlineDate: '2099-01-15', deadlineDays: 15, summary: 'Žaloba',
            detectedDeadlines: [{ amount: 2, unit: 'month', deadlineDate: '2099-03-01', needsReview: true, source: 'ai' }]
        },
        { id: 'f2', caseNumber: '23 C 120/2026', fileName: 'vyzva.pdf', relativePath: 'vyzva.pdf' },
        { id: 'f3', caseNumber: 'Neznámá sp. zn.', fileName: 'sken.pdf' }
    ]);
}

afterAll(() => {
    if (fs.existsSync(tempWatchDir)) fs.rmSync(tempWatchDir, { recursive: true, force: true });
});

beforeEach(seedInbox);

describe('normalizace a párování sp. zn.', () => {
    test('_normCase sjednotí mezery', () => {
        expect(spisy._normCase('  23   C  120/2026 ')).toBe('23 C 120/2026');
    });
    test('_isRealCase odmítne prázdné a „Neznámá sp. zn."', () => {
        expect(spisy._isRealCase('23 C 120/2026')).toBe(true);
        expect(spisy._isRealCase('Neznámá sp. zn.')).toBe(false);
        expect(spisy._isRealCase('')).toBe(false);
    });
});

describe('createSpis + dedup', () => {
    test('nezaloží duplicitu na stejnou sp. zn. (tolerantně na mezery)', () => {
        const a = spisy.createSpis({ spisZn: '5 T 3/2025', klient: 'A' });
        const b = spisy.createSpis({ spisZn: '5  T 3/2025', klient: 'B' });
        expect(b.id).toBe(a.id);
        expect(spisy.listSpisy()).toHaveLength(1);
    });
    test('bez sp. zn. i názvu vyhodí chybu', () => {
        expect(() => spisy.createSpis({})).toThrow();
    });
});

describe('syncFromInbox (migrace)', () => {
    test('odvodí spisy z inboxu, přeskočí neznámou sp. zn., je idempotentní', () => {
        const r1 = spisy.syncFromInbox();
        expect(r1.created).toBe(1);
        expect(r1.skippedNoCase).toBe(1);
        const spis = spisy.findByCase('23 C 120/2026');
        expect(spis).toBeTruthy();
        expect(spis.klient).toBe('Klient s.r.o.');
        expect(spis.protistrana).toBe('Dlužník a.s.');
        // druhý běh nic nepřidá
        const r2 = spisy.syncFromInbox();
        expect(r2.created).toBe(0);
        expect(spisy.listSpisy()).toHaveLength(1);
    });
});

describe('getSpisDetail (agregace)', () => {
    test('sesbírá dokumenty, lhůty, čas a metriky', () => {
        spisy.syncFromInbox();
        const spis = spisy.findByCase('23 C 120/2026');
        const detail = spisy.getSpisDetail(spis.id);
        expect(detail.documents).toHaveLength(2);
        // primární (den) + detekovaná (měsíc, needsReview) = 2
        expect(detail.deadlines).toHaveLength(2);
        expect(detail.metrics.deadlinesNeedsReview).toBe(1);
        // čas: 3600 (zaloba) + 1800 (vyzva) = 5400 s; jiny.pdf se NEpočítá
        expect(detail.metrics.timeSeconds).toBe(5400);
        expect(detail.metrics.timeHours).toBe(1.5);
        expect(detail.metrics.nextDeadline).toBe('2099-01-15');
    });
});

describe('životní cyklus stavu', () => {
    test('archiv nastaví retenci dle retentionYears', () => {
        const spis = spisy.createSpis({ spisZn: '9 C 9/2020', retentionYears: 5 });
        const upd = spisy.setStav(spis.id, 'archiv', '2026-06-01T12:00:00Z');
        expect(upd.stav).toBe('archiv');
        expect(upd.retentionUntil).toBe('2031-06-01');
        expect(upd.archivedAt).toBeTruthy();
    });
    test('skartace jen navrhne; smazat lze až ve skartaci', () => {
        const spis = spisy.createSpis({ spisZn: '9 C 10/2020' });
        expect(() => spisy.deleteSpis(spis.id)).toThrow(); // aktivní nelze smazat
        spisy.setStav(spis.id, 'skartace', '2026-06-01T12:00:00Z');
        const s2 = spisy.getSpis(spis.id);
        expect(s2.skartaceProposedAt).toBeTruthy();
        const removed = spisy.deleteSpis(spis.id);
        expect(removed.id).toBe(spis.id);
        expect(spisy.getSpis(spis.id)).toBeNull();
    });
    test('neplatný stav vyhodí chybu', () => {
        const spis = spisy.createSpis({ spisZn: '9 C 11/2020' });
        expect(() => spisy.setStav(spis.id, 'nesmysl')).toThrow();
    });
});

describe('roztřídění dokumentů do spisů (filing)', () => {
    test('ensureSpisForCase založí spis pro reálnou sp. zn., je idempotentní', () => {
        const a = spisy.ensureSpisForCase('42 C 5/2026', { klient: 'Klient', source: 'watcher' });
        expect(a).toBeTruthy();
        const b = spisy.ensureSpisForCase('42 C 5/2026', {});
        expect(b.id).toBe(a.id);
        expect(spisy.ensureSpisForCase('Neznámá sp. zn.', {})).toBeNull();
    });

    test('listUnfiled vrátí dokumenty bez rozpoznané sp. zn.', () => {
        const unfiled = spisy.listUnfiled();
        expect(unfiled.map(f => f.id)).toEqual(['f3']);
    });

    test('assignFileToSpis naváže dokument na spis a zaloguje úkon', () => {
        spisy.syncFromInbox();
        const spis = spisy.findByCase('23 C 120/2026');
        const filed = spisy.assignFileToSpis('f3', spis.id);
        expect(filed.caseNumber).toBe('23 C 120/2026');
        expect(filed.filedAt).toBeTruthy();
        // f3 už není nezařazený
        expect(spisy.listUnfiled().find(f => f.id === 'f3')).toBeUndefined();
        expect(spisy.getEvents(spis.id).some(e => e.type === 'zarazeni')).toBe(true);
    });

    test('assignFileToSpis na neexistující spis/dokument vyhodí chybu', () => {
        expect(() => spisy.assignFileToSpis('f3', 'neexistuje')).toThrow();
    });
});

describe('spisový deník (events)', () => {
    test('založení a změny generují úkony v čase', () => {
        const spis = spisy.createSpis({ spisZn: '1 C 1/2026' });
        spisy.addEvent(spis.id, 'poznamka', 'Telefonát s klientem.');
        const events = spisy.getEvents(spis.id);
        expect(events.length).toBeGreaterThanOrEqual(2); // zalozeni + poznamka
        expect(events.map(e => e.type)).toContain('zalozeni');
        expect(events.map(e => e.type)).toContain('poznamka');
    });
});
