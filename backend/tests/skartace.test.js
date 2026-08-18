/**
 * Testy skartačního/archivačního režimu (backend/lib/skartace.js) —
 * návrh dle uplynulé retence a skartační protokol (nikdy nemaže).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tempWatchDir = path.join(os.tmpdir(), `lexis_test_skartace_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) fs.mkdirSync(tempWatchDir, { recursive: true });
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const spisy = require('../lib/spisy');
const skartace = require('../lib/skartace');

const TODAY = '2026-06-01';

function seed() {
    db.set('spisy', []);
    db.set('spis_events', []);
    db.set('skartace_protokoly', []);
}

afterAll(() => {
    if (fs.existsSync(tempWatchDir)) fs.rmSync(tempWatchDir, { recursive: true, force: true });
});

beforeEach(seed);

describe('getSkartaceNavrh', () => {
    test('rozdělí archiv na expirované a stále retencované, plus inSkartace', () => {
        const s1 = spisy.createSpis({ spisZn: '1 C 1/2010' });
        spisy.setStav(s1.id, 'archiv', '2010-01-01T12:00:00Z'); // retence do 2015 → expirováno
        const s2 = spisy.createSpis({ spisZn: '2 C 2/2026' });
        spisy.setStav(s2.id, 'archiv', '2026-01-01T12:00:00Z'); // retence do 2031 → drží
        const s3 = spisy.createSpis({ spisZn: '3 C 3/2020' });
        spisy.setStav(s3.id, 'skartace', '2026-05-01T12:00:00Z');

        const navrh = skartace.getSkartaceNavrh(TODAY);
        expect(navrh.summary.expired).toBe(1);
        expect(navrh.summary.retained).toBe(1);
        expect(navrh.summary.inSkartace).toBe(1);
        expect(navrh.expired[0].id).toBe(s1.id);
        expect(navrh.retained[0].id).toBe(s2.id);
        expect(navrh.inSkartace[0].id).toBe(s3.id);
    });
});

describe('buildProtokol', () => {
    test('vytvoří protokol a zaloguje úkon do spisu, ale NEmaže', () => {
        const s1 = spisy.createSpis({ spisZn: '1 C 1/2010', klient: 'Klient' });
        spisy.setStav(s1.id, 'archiv', '2010-01-01T12:00:00Z');

        const protokol = skartace.buildProtokol([s1.id], { zpracoval: 'Advokát' });
        expect(protokol.pocet).toBe(1);
        expect(protokol.polozky[0].spisZn).toBe('1 C 1/2010');
        expect(protokol.zpracoval).toBe('Advokát');
        // spis stále existuje (nic se nesmazalo)
        expect(spisy.getSpis(s1.id)).toBeTruthy();
        // úkon zaznamenán
        expect(spisy.getEvents(s1.id).some(e => e.type === 'skartace')).toBe(true);
        // protokol dohledatelný
        expect(skartace.listProtokoly()).toHaveLength(1);
    });

    test('prázdný seznam vyhodí chybu', () => {
        expect(() => skartace.buildProtokol([])).toThrow();
    });
});
