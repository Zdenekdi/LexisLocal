/**
 * Testy read-endpointů konceptů spisové služby:
 *   GET /api/spisy/:id/drafts        — koncepty ve složce spisu (03_Koncepty)
 *   GET /api/spisy/nezarazeno-drafts — koncepty, které fail-closed skončily v _Nezařazeno
 * Ověřuje i to, že „nezarazeno-drafts" není omylem chytnuto routou /:id.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `lexis_test_spisyDrafts_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const request = require('supertest');
const app = require('../server');
const spisy = require('../lib/spisy');
const sf = require('../lib/spisFolders');
const H = (r) => r.set('X-API-Token', 'tok-test');

describe('GET /api/spisy/:id/drafts', () => {
    test('vrátí koncepty uložené ve složce spisu', async () => {
        const spis = spisy.createSpis({ spisZn: '15 C 500/2026', klient: 'Jan Novák', protistrana: 'ČSOB a.s.' });
        sf.ensureSpisFolder(spis);
        sf.saveDraftToSpis({ spisId: spis.id, fileName: 'zaloba.docx', content: 'obsah' });
        const r = await H(request(app).get(`/api/spisy/${spis.id}/drafts`));
        expect(r.statusCode).toBe(200);
        expect(Array.isArray(r.body.drafts)).toBe(true);
        expect(r.body.drafts.map(d => d.fileName)).toContain('zaloba.docx');
    });

    test('neexistující spis → 404', async () => {
        const r = await H(request(app).get('/api/spisy/neexistuje/drafts'));
        expect(r.statusCode).toBe(404);
    });
});

describe('GET /api/spisy/nezarazeno-drafts', () => {
    test('route se nechytne jako /:id a vrátí pole souborů', async () => {
        // fail-closed koncept → _Nezařazeno
        sf.saveDraftToSpis({ spisId: 'spis_NEEXISTUJE', fileName: 'podani.docx', content: 'x' });
        const r = await H(request(app).get('/api/spisy/nezarazeno-drafts'));
        expect(r.statusCode).toBe(200);
        expect(Array.isArray(r.body.files)).toBe(true);
        expect(r.body.files.map(f => f.fileName)).toContain('podani.docx');
    });
});
