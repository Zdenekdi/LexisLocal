/**
 * Bezpečnostní testy: CORS allowlist, ochrana proti DNS-rebindingu (Host validace)
 * a Origin-guard vstřikování API tokenu do dashboardu.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_seccors_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_seccors_key_${Date.now()}`);

const request = require('supertest');
const app = require('../server');

describe('CORS / Host / token-guard', () => {
    test('dashboard same-origin: token vložen', async () => {
        const r = await request(app).get('/');
        expect(r.text).toContain('LEXIS_API_TOKEN');
    });
    test('cross-origin fetch na /: token NEvložen', async () => {
        const r = await request(app).get('/').set('Origin', 'https://evil.com');
        expect(r.text).not.toContain('LEXIS_API_TOKEN');
    });
    test('cizí Host → 403 (anti-rebinding)', async () => {
        const r = await request(app).get('/api/agents').set('Host', 'evil.com').set('X-API-Token', 'tok-test');
        expect(r.statusCode).toBe(403);
    });
    test('loopback Host + token → 200', async () => {
        const r = await request(app).get('/api/agents').set('X-API-Token', 'tok-test');
        expect(r.statusCode).toBe(200);
    });
    test('cizí origin → žádné ACAO', async () => {
        const r = await request(app).get('/api/agents').set('Origin', 'https://evil.com').set('X-API-Token', 'tok-test');
        expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });
    test('Electron null origin → ACAO povolen (editor nerozbit)', async () => {
        const r = await request(app).get('/api/agents').set('Origin', 'null').set('X-API-Token', 'tok-test');
        expect(r.headers['access-control-allow-origin']).toBeDefined();
    });
});
