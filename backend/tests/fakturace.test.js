/**
 * Testy fakturace (backend/lib/fakturace.js) — výpočet součtů (DPH, záloha),
 * faktura ze spisu z časové dotace, přehled neuhrazených a úhrady.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const tempWatchDir = path.join(os.tmpdir(), `lexis_test_fakturace_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) fs.mkdirSync(tempWatchDir, { recursive: true });
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const spisy = require('../lib/spisy');
const fakturace = require('../lib/fakturace');

function seed() {
    db.set('spisy', []);
    db.set('spis_events', []);
    db.set('invoices', []);
    db.set('settings', [{ id: 's1', key: 'default_hourly_rate', value: '3000' }]);
    db.set('activities', [{ id: 'a1', documentName: 'smlouva.docx', activeSeconds: 7200, timestamp: '2026-01-01T10:00:00Z' }]);
    db.set('inbox_files', [{ id: 'f1', caseNumber: '7 C 7/2026', fileName: 'smlouva.docx', relativePath: 'smlouva.docx' }]);
}

afterAll(() => {
    if (fs.existsSync(tempWatchDir)) fs.rmSync(tempWatchDir, { recursive: true, force: true });
});

beforeEach(seed);

describe('computeTotals', () => {
    test('DPH 21 % a odečet zálohy', () => {
        const t = fakturace.computeTotals([{ amount: 6000 }, { amount: 1000 }], { dphRate: 21, zaloha: 2000 });
        expect(t.subtotal).toBe(7000);
        expect(t.dphAmount).toBe(1470);
        expect(t.total).toBe(8470);
        expect(t.toPay).toBe(6470);
    });
    test('neplátce DPH (dphRate 0)', () => {
        const t = fakturace.computeTotals([{ amount: 5000 }], { dphRate: 0 });
        expect(t.dphAmount).toBe(0);
        expect(t.total).toBe(5000);
    });
});

describe('createInvoiceFromSpis', () => {
    test('vyfakturuje čas ze spisu sazbou z nastavení + DPH', () => {
        const spis = spisy.createSpis({ spisZn: '7 C 7/2026', klient: 'Klient s.r.o.' });
        const inv = fakturace.createInvoiceFromSpis(spis.id, { dphRate: 21 });
        // 2 hod × 3000 = 6000; DPH 1260; total 7260
        expect(inv.items[0].hours).toBe(2);
        expect(inv.items[0].rate).toBe(3000);
        expect(inv.subtotal).toBe(6000);
        expect(inv.total).toBe(7260);
        expect(inv.toPay).toBe(7260);
        expect(inv.status).toBe('unpaid');
        expect(inv.variabilniSymbol).toMatch(/^\d{8}$/);
        // úkon zaznamenán do spisu
        expect(spisy.getEvents(spis.id).some(e => e.type === 'faktura')).toBe(true);
    });

    test('lze přidat ruční položku (např. tarif) a zálohu', () => {
        const spis = spisy.createSpis({ spisZn: '7 C 7/2026' });
        const inv = fakturace.createInvoiceFromSpis(spis.id, {
            dphRate: 0,
            zaloha: 1000,
            items: [{ type: 'tarif', popis: 'Úkon dle tarifu', amount: 1500 }]
        });
        // čas 6000 + tarif 1500 = 7500; DPH 0; záloha 1000 → toPay 6500
        expect(inv.subtotal).toBe(7500);
        expect(inv.toPay).toBe(6500);
    });

    test('nulový čas i bez položek → chyba', () => {
        db.set('activities', []);
        const spis = spisy.createSpis({ spisZn: '7 C 7/2026' });
        expect(() => fakturace.createInvoiceFromSpis(spis.id, {})).toThrow();
    });
});

describe('přehled a úhrady', () => {
    test('getOutstanding a markPaid', () => {
        const spis = spisy.createSpis({ spisZn: '7 C 7/2026' });
        const inv = fakturace.createInvoiceFromSpis(spis.id, { dphRate: 0 }); // 6000
        let out = fakturace.getOutstanding();
        expect(out.count).toBe(1);
        expect(out.totalDue).toBe(6000);

        const paid = fakturace.markPaid(inv.id); // plná úhrada
        expect(paid.status).toBe('paid');
        out = fakturace.getOutstanding();
        expect(out.count).toBe(0);
        expect(out.totalDue).toBe(0);
    });

    test('částečná úhrada → status partial', () => {
        const spis = spisy.createSpis({ spisZn: '7 C 7/2026' });
        const inv = fakturace.createInvoiceFromSpis(spis.id, { dphRate: 0 }); // 6000
        const p = fakturace.markPaid(inv.id, 2000);
        expect(p.status).toBe('partial');
        expect(p.paidAmount).toBe(2000);
    });
});
