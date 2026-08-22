/**
 * Bezpečnostní invariant: hromadné odeslání (campaigns/send) NEPROJDE bez
 * výslovného souhlasu advokáta (confirmedByLawyer:true). Fail-closed.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_consent_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_consent_key_${Date.now()}`);

const request = require('supertest');
const app = require('../server');
const H = (r) => r.set('X-API-Token', 'tok-test');

describe('campaigns/send — souhlas advokáta', () => {
    const recipients = [{ ico: '45274649', name: 'Test', isdsId: null, text: 'x' }];

    test('bez confirmedByLawyer → 403 (fail-closed)', async () => {
        const r = await H(request(app).post('/api/campaigns/send')).send({ clientName: 'K', caseNumber: '15 C 1/2026', recipients });
        expect(r.statusCode).toBe(403);
    });

    test('s confirmedByLawyer:true → projde (není 403)', async () => {
        const r = await H(request(app).post('/api/campaigns/send')).send({ clientName: 'K', caseNumber: '15 C 1/2026', recipients, confirmedByLawyer: true });
        expect(r.statusCode).not.toBe(403);
    });
});
