/**
 * Testy e-mailového úkolování: POST /api/email/process
 *  • JEN autorizovaný e-mail advokáta smí spustit flow (jinak 403).
 *  • Sekretářka (ChiefOrchestrator) roztřídí a deleguje na agenty.
 *  • Auto-odpověď smí jít VÝHRADNĚ na authorized_sender (fail-closed).
 *  • Bez SMTP se výstup uloží, replied=false (nespadne).
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `lexis_test_emailproc_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';
process.env.OLLAMA_HOST = 'http://127.0.0.1:1'; // model nedostupný → deterministický fallback

const request = require('supertest');
const app = require('../server');
const db = require('../lib/database');
const { dataPath } = require('../lib/config');
const H = (r) => r.set('X-API-Token', 'tok-test');

beforeEach(() => { db.set('email_settings', [{ authorized_sender: 'advokat@dias.cz' }]); });

describe('POST /api/email/process — e-mailové úkolování', () => {
    test('neautorizovaný odesílatel → 403 (nikdo cizí neovládne agenty)', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'utocnik@zlo.cz', subject: 'Udělej', body: 'cokoliv' });
        expect(r.statusCode).toBe(403);
    });

    test('chybějící pole → 400', async () => {
        const r = await H(request(app).post('/api/email/process')).send({ sender: 'advokat@dias.cz', subject: 'x' });
        expect(r.statusCode).toBe(400);
    });

    test('autorizovaný → orchestrace, uložený úkol, bez SMTP replied=false', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'Rešerše a dopis', body: 'Rešerše k promlčení a návrh dopisu klientovi.' });
        expect(r.statusCode).toBe(200);
        expect(r.body.success).toBe(true);
        expect(r.body.replied).toBe(false);
        expect(r.body.task).toBeTruthy();
        expect(typeof r.body.task.responseSent).toBe('string');
        expect(r.body.task.responseSent.length).toBeGreaterThan(50);
        expect(String(r.body.mode)).toMatch(/orchestrate/);
    });

    test('explicitní volba [Spisovatel] → single agent', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: '[Spisovatel] Smlouva', body: 'Kupní smlouva.' });
        expect(r.statusCode).toBe(200);
        expect(r.body.mode).toBe('single');
    });

    test('velká/malá písmena a mezery v adrese odesílatele se tolerují', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: '  Advokat@Dias.CZ ', subject: 'Test', body: 'Něco.' });
        expect(r.statusCode).toBe(200);
    });
});

describe('POST /api/email/process — rezervace schůzky z e-mailu', () => {
    beforeEach(() => { db.set('email_settings', [{ authorized_sender: 'advokat@dias.cz' }]); db.set('meetings', []); db.set('alerts', []); });

    test('e-mail se schůzkou (konkrétní budoucí termín) → rezervováno', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'Klient Novák', body: 'Domluv schůzku s klientem 3.9.2027 ve 14:00 na hodinu.' });
        expect(r.statusCode).toBe(200);
        expect(r.body.scheduling).toBeTruthy();
        expect(r.body.scheduling.booked).toBe(true);
        expect(r.body.task.responseSent).toMatch(/rezervov/i);
    });

    test('kolizní druhý termín → nbooked:false + alternativy', async () => {
        await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'A', body: 'Schůzka 3.9.2027 ve 14:00 na hodinu.' });
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'B', body: 'Sejdeme se 3.9.2027 ve 14:15 na hodinu.' });
        expect(r.body.scheduling.booked).toBe(false);
        expect(r.body.scheduling.suggestions.length).toBeGreaterThan(0);
    });

    test('vágní žádost → intent true, parsed false, nic se nerezervuje', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'X', body: 'Domluv někdy schůzku s klientem.' });
        expect(r.body.scheduling.intent).toBe(true);
        expect(r.body.scheduling.parsed).toBe(false);
    });

    test('nekalendářové zadání → scheduling null', async () => {
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'Rešerše', body: 'Rešerše k promlčení.' });
        expect(r.body.scheduling == null).toBe(true);
    });
});

describe('rezervace je řízena oprávněním sekretářky (manage_calendar)', () => {
    const agentsFile = dataPath('.agents.json');
    afterAll(() => { try { fs.unlinkSync(agentsFile); } catch (e) {} });

    test('bez oprávnění manage_calendar se NErezervuje', async () => {
        db.set('email_settings', [{ authorized_sender: 'advokat@dias.cz' }]);
        db.set('meetings', []);
        const { loadAgents } = require('../lib/agents');
        const agents = loadAgents();
        agents.sekretarka.permissions.manage_calendar = false;
        fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2), 'utf8');
        const r = await H(request(app).post('/api/email/process'))
            .send({ sender: 'advokat@dias.cz', subject: 'X', body: 'Domluv schůzku 3.9.2027 ve 14:00 na hodinu.' });
        expect(r.body.scheduling.skipped).toBe('no-permission');
        expect((db.get('meetings') || []).length).toBe(0);
    });
});

