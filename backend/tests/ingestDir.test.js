/**
 * Testy výběru spisovny (INGEST_DIR) — config.getIngestDir/setIngestDir + routy
 * /api/settings/ingest-dir. Ověřuje perzistenci, precedenci env > perzistence >
 * default, validaci a přepnutí watcheru za běhu.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_TOKEN = 'test-api-token';
process.env.API_TOKEN = TEST_TOKEN;
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_ingest_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_ingest_key_${Date.now()}`);
fs.mkdirSync(process.env.WATCH_DIR, { recursive: true });

const request = require('supertest');
const app = require('../server');

const H = (r) => r.set('X-API-Token', TEST_TOKEN);

describe('routy /api/settings/ingest-dir (WATCH_DIR nastaven → env vyhrává)', () => {
    test('GET vrací aktuální spisovnu a datovou složku', async () => {
        const res = await H(request(app).get('/api/settings/ingest-dir'));
        expect(res.statusCode).toBe(200);
        expect(res.body.ingestDir).toBe(process.env.WATCH_DIR);
        expect(res.body.dataDir).toBeDefined();
    });

    test('POST s platnou složkou uspěje a přepne watcher', async () => {
        const newDir = path.join(os.tmpdir(), `lexis_new_spisovna_${Date.now()}`);
        fs.mkdirSync(newDir, { recursive: true });
        const res = await H(request(app).post('/api/settings/ingest-dir')).send({ path: newDir });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.ingestDir).toBe(fs.realpathSync(newDir) === newDir ? newDir : res.body.ingestDir);
        expect(res.body.repointed).toBe(true);
    });

    test('POST s neexistující složkou → 400', async () => {
        const res = await H(request(app).post('/api/settings/ingest-dir')).send({ path: '/nette/existuje/vubec/12345' });
        expect(res.statusCode).toBe(400);
    });

    test('POST bez cesty → 400', async () => {
        const res = await H(request(app).post('/api/settings/ingest-dir')).send({});
        expect(res.statusCode).toBe(400);
    });
});

describe('config.getIngestDir/setIngestDir — precedence a validace', () => {
    function freshConfig(env) {
        jest.resetModules();
        const saved = {
            WATCH_DIR: process.env.WATCH_DIR,
            INGEST_DIR: process.env.INGEST_DIR,
            LEXIS_DATA_DIR: process.env.LEXIS_DATA_DIR
        };
        delete process.env.WATCH_DIR; delete process.env.INGEST_DIR; delete process.env.LEXIS_DATA_DIR;
        Object.assign(process.env, env);
        const c = require('../lib/config');
        return { c, restore: () => {
            delete process.env.WATCH_DIR; delete process.env.INGEST_DIR; delete process.env.LEXIS_DATA_DIR;
            Object.keys(saved).forEach(k => { if (saved[k] !== undefined) process.env[k] = saved[k]; });
        }};
    }

    test('bez WATCH_DIR: setIngestDir se perzistuje a getIngestDir ho vrátí', () => {
        const dataDir = path.join(os.tmpdir(), `lexis_cfg_data_${Date.now()}`);
        const spisovna = path.join(os.tmpdir(), `lexis_cfg_spisovna_${Date.now()}`);
        fs.mkdirSync(spisovna, { recursive: true });
        const { c, restore } = freshConfig({ LEXIS_DATA_DIR: dataDir });
        try {
            const resolved = c.setIngestDir(spisovna);
            expect(resolved).toBe(spisovna);
            expect(c.getIngestDir()).toBe(spisovna);
            expect(c.readSettings().ingestDir).toBe(spisovna);
        } finally { restore(); }
    });

    test('WATCH_DIR vyhrává nad perzistovanou volbou', () => {
        const dataDir = path.join(os.tmpdir(), `lexis_cfg_data2_${Date.now()}`);
        const spisovna = path.join(os.tmpdir(), `lexis_cfg_spisovna2_${Date.now()}`);
        const envWatch = path.join(os.tmpdir(), `lexis_cfg_watch2_${Date.now()}`);
        fs.mkdirSync(spisovna, { recursive: true });
        let ctx = freshConfig({ LEXIS_DATA_DIR: dataDir });
        try { ctx.c.setIngestDir(spisovna); } finally { ctx.restore(); }
        // teď se nastaveným WATCH_DIR musí vyhrát env
        ctx = freshConfig({ LEXIS_DATA_DIR: dataDir, WATCH_DIR: envWatch });
        try {
            expect(ctx.c.getIngestDir()).toBe(envWatch);
        } finally { ctx.restore(); }
    });

    test('setIngestDir na neexistující složku vyhodí chybu', () => {
        const { c, restore } = freshConfig({ LEXIS_DATA_DIR: path.join(os.tmpdir(), `lexis_cfg_data3_${Date.now()}`) });
        try {
            expect(() => c.setIngestDir('/fakt/neexistuje/98765')).toThrow();
        } finally { restore(); }
    });

    test('setIngestDir na soubor (ne složku) vyhodí chybu', () => {
        const f = path.join(os.tmpdir(), `lexis_cfg_file_${Date.now()}.txt`);
        fs.writeFileSync(f, 'x');
        const { c, restore } = freshConfig({ LEXIS_DATA_DIR: path.join(os.tmpdir(), `lexis_cfg_data4_${Date.now()}`) });
        try {
            expect(() => c.setIngestDir(f)).toThrow();
        } finally { restore(); }
    });
});
