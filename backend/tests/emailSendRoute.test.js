/**
 * Testy odesílacích endpointů e-mailu klientovi:
 *   POST /api/email/send        — reálné SMTP odeslání (fail-closed na souhlas advokáta)
 *   POST /api/case/email-logged — pravdivý zápis odeslání do timeline spisu
 * Klíčový invariant: bez confirmedByLawyer se NEODESÍLÁ.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `lexis_test_emailsend_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const request = require('supertest');
const app = require('../server');
const db = require('../lib/database');
const spisy = require('../lib/spisy');
const H = (r) => r.set('X-API-Token', 'tok-test');

describe('POST /api/email/send', () => {
    test('bez souhlasu advokáta → 403 NO_CONSENT (nic se neodešle)', async () => {
        const r = await H(request(app).post('/api/email/send'))
            .send({ to: 'klient@x.cz', subject: 'Věc', body: 'Text' });
        expect(r.statusCode).toBe(403);
        expect(r.body.code).toBe('NO_CONSENT');
    });

    test('se souhlasem, ale bez SMTP nastavení → 400 SMTP_CONFIG', async () => {
        db.set('email_settings', []); // žádné SMTP
        const r = await H(request(app).post('/api/email/send'))
            .send({ to: 'klient@x.cz', subject: 'Věc', body: 'Text', confirmedByLawyer: true });
        expect(r.statusCode).toBe(400);
        expect(r.body.code).toBe('SMTP_CONFIG');
    });

    test('bez příjemce → 400', async () => {
        const r = await H(request(app).post('/api/email/send'))
            .send({ subject: 'Věc', confirmedByLawyer: true });
        expect(r.statusCode).toBe(400);
    });
});

describe('POST /api/case/email-logged', () => {
    test('zapíše událost do timeline existujícího spisu (linkedToCase=true)', async () => {
        const spis = spisy.createSpis({ spisZn: '15 C 900/2026', klient: 'Doe' });
        const r = await H(request(app).post('/api/case/email-logged'))
            .send({ caseNumber: '15 C 900/2026', recipientEmail: 'klient@x.cz', subject: 'Podklady' });
        expect(r.statusCode).toBe(200);
        expect(r.body.success).toBe(true);
        expect(r.body.linkedToCase).toBe(true);
        const events = spisy.getEvents(spis.id);
        expect(events.some(e => e.type === 'email')).toBe(true);
    });

    test('neznámá sp. zn. → success ale linkedToCase=false (nespadne)', async () => {
        const r = await H(request(app).post('/api/case/email-logged'))
            .send({ caseNumber: 'Neexistuje 1/2026', recipientEmail: 'x@y.cz' });
        expect(r.statusCode).toBe(200);
        expect(r.body.success).toBe(true);
        expect(r.body.linkedToCase).toBe(false);
    });
});
