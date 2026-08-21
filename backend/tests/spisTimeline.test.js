/**
 * Testy sjednocené časové osy spisu (spisy.getSpisTimeline) a auditní stopy na
 * spis (audit.getLogsForSpis). Ověřuje, že se do jedné chronologické osy sloučí
 * spisový deník i auditní záznamy a že se filtrují na správný spis.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), `lexis_test_timeline_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const db = require('../lib/database');
const spisy = require('../lib/spisy');
const audit = require('../lib/audit');
const sf = require('../lib/spisFolders');

beforeEach(() => {
    db.set('spisy', []);
    db.set('spis_events', []);
    audit.clearAuditLogs();
});

describe('audit.getLogsForSpis', () => {
    test('filtruje záznamy podle top-level spisId', () => {
        audit.logEvent('Test', 'Úkon X', 'cíl', { spisId: 'S1' });
        audit.logEvent('Test', 'Úkon Y', 'cíl', { spisId: 'S2' });
        const s1 = audit.getLogsForSpis('S1');
        expect(s1.length).toBe(1);
        expect(s1[0].operation).toBe('Úkon X');
        expect(s1[0].spisId).toBe('S1');
    });

    test('prázdné spisId → prázdné pole', () => {
        expect(audit.getLogsForSpis(null)).toEqual([]);
    });
});

describe('spisy.getSpisTimeline', () => {
    test('neexistující spis → null', () => {
        expect(spisy.getSpisTimeline('neexistuje')).toBeNull();
    });

    test('sloučí spisový deník i auditní stopu do jedné osy', () => {
        const spis = spisy.createSpis({ spisZn: '15 C 1/2026', klient: 'Novák', protistrana: 'ČSOB' });
        sf.ensureSpisFolder(spis);
        const d = sf.saveDraftToSpis({ spisId: spis.id, fileName: 'zaloba.docx', content: 'obsah' });
        expect(d.filed).toBe(true);

        const tl = spisy.getSpisTimeline(spis.id);
        expect(tl).not.toBeNull();
        expect(tl.count).toBeGreaterThanOrEqual(2);

        const kinds = tl.timeline.map(i => i.kind);
        expect(kinds).toContain('denik');   // založení + koncept
        expect(kinds).toContain('audit');   // auditní záznam uložení konceptu

        // událost "koncept" v deníku existuje
        const types = tl.timeline.filter(i => i.kind === 'denik').map(i => i.type);
        expect(types).toContain('zalozeni');
        expect(types).toContain('koncept');
    });

    test('osa je seřazená chronologicky (položky bez času na konci)', () => {
        const spis = spisy.createSpis({ spisZn: '8 As 2/2026', klient: 'Dvořák' });
        const tl = spisy.getSpisTimeline(spis.id);
        const times = tl.timeline.map(i => i.time);
        const withTime = times.filter(Boolean);
        const sorted = [...withTime].sort((a, b) => String(a).localeCompare(String(b)));
        expect(withTime).toEqual(sorted);
    });
});
