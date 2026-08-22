/**
 * Testy zjednodušeného nastavení e-mailu: derivace serverů + endpointy /derive a /test.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `lexis_test_provider_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const { deriveImapSmtp } = require('../lib/emailProviders');
const request = require('supertest');
const app = require('../server');
const H = (r) => r.set('X-API-Token', 'tok-test');

describe('deriveImapSmtp', () => {
    test('známý poskytovatel (Seznam)', () => {
        const d = deriveImapSmtp('jan@seznam.cz');
        expect(d.imap_host).toBe('imap.seznam.cz');
        expect(d.smtp_host).toBe('smtp.seznam.cz');
        expect(d.authorized_sender).toBe('jan@seznam.cz');
        expect(d.needsAppPassword).toBe(false);
    });
    test('Gmail → potřebuje heslo aplikace', () => {
        expect(deriveImapSmtp('x@gmail.com').needsAppPassword).toBe(true);
    });
    test('vlastní doména → imap./smtp.<doména>', () => {
        const d = deriveImapSmtp('advokat@akkovar.cz');
        expect(d.imap_host).toBe('imap.akkovar.cz');
        expect(d.smtp_host).toBe('smtp.akkovar.cz');
    });
    test('neplatný e-mail → null', () => {
        expect(deriveImapSmtp('nesmysl')).toBeNull();
        expect(deriveImapSmtp('')).toBeNull();
    });
});

describe('POST /api/email/derive', () => {
    test('vrátí odvozené nastavení', async () => {
        const r = await H(request(app).post('/api/email/derive')).send({ email: 'jan@seznam.cz' });
        expect(r.statusCode).toBe(200);
        expect(r.body.imap_host).toBe('imap.seznam.cz');
    });
    test('neplatný e-mail → 400', async () => {
        const r = await H(request(app).post('/api/email/derive')).send({ email: 'x' });
        expect(r.statusCode).toBe(400);
    });
});

describe('POST /api/email/test (bez sítě → ok:false)', () => {
    test('prázdné nastavení → imap i smtp ok:false, ale endpoint 200', async () => {
        const r = await H(request(app).post('/api/email/test')).send({ settings: {} });
        expect(r.statusCode).toBe(200);
        expect(r.body.imap.ok).toBe(false);
        expect(r.body.smtp.ok).toBe(false);
    });
});
