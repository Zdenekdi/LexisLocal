/**
 * Testy oddělení dat od spisovny (lib/config.js: INGEST_DIR / DATA_DIR / dataPath).
 * Cíl: spisovna (INGEST_DIR) může být synchronizovaná (OneDrive), technická data
 * appky (DB, audit, inbox, RAG) žijí odděleně v DATA_DIR a nekolidují.
 *
 * Klíčový invariant: když je nastaven jen WATCH_DIR (režim testů/legacy),
 * DATA_DIR === INGEST_DIR, takže se žádné cesty nemění a nic se nerozbije.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function freshConfig(env) {
    jest.resetModules();
    const saved = { WATCH_DIR: process.env.WATCH_DIR, INGEST_DIR: process.env.INGEST_DIR, LEXIS_DATA_DIR: process.env.LEXIS_DATA_DIR };
    delete process.env.WATCH_DIR; delete process.env.INGEST_DIR; delete process.env.LEXIS_DATA_DIR;
    Object.assign(process.env, env);
    const c = require('../lib/config');
    // obnov původní env pro ostatní testy
    delete process.env.WATCH_DIR; delete process.env.INGEST_DIR; delete process.env.LEXIS_DATA_DIR;
    Object.keys(saved).forEach(k => { if (saved[k] !== undefined) process.env[k] = saved[k]; });
    return c;
}

describe('config — INGEST_DIR / DATA_DIR', () => {
    test('režim testů/legacy: jen WATCH_DIR → DATA_DIR === INGEST_DIR (cesty se nemění)', () => {
        const tmp = path.join(os.tmpdir(), `lexis_dd_legacy_${Date.now()}`);
        const c = freshConfig({ WATCH_DIR: tmp });
        expect(c.INGEST_DIR).toBe(tmp);
        expect(c.DATA_DIR).toBe(c.INGEST_DIR);
        expect(c.dataPath('.lexis.db')).toBe(path.join(tmp, '.lexis.db'));
    });

    test('oddělený režim: WATCH_DIR + LEXIS_DATA_DIR → INGEST != DATA', () => {
        const base = path.join(os.tmpdir(), `lexis_dd_split_${Date.now()}`);
        const ingest = path.join(base, 'Spisovna');
        const data = path.join(base, 'AppData');
        fs.mkdirSync(ingest, { recursive: true });
        const c = freshConfig({ WATCH_DIR: ingest, LEXIS_DATA_DIR: data });
        expect(c.INGEST_DIR).toBe(ingest);
        expect(c.DATA_DIR).toBe(data);
        expect(c.INGEST_DIR).not.toBe(c.DATA_DIR);
    });

    test('dataPath přesune legacy soubor ze spisovny do DATA_DIR', () => {
        const base = path.join(os.tmpdir(), `lexis_dd_mig_${Date.now()}`);
        const ingest = path.join(base, 'Spisovna');
        const data = path.join(base, 'AppData');
        fs.mkdirSync(ingest, { recursive: true });
        const c = freshConfig({ WATCH_DIR: ingest, LEXIS_DATA_DIR: data });

        fs.writeFileSync(path.join(ingest, '.lexis.db'), 'STARA_DB');
        const target = c.dataPath('.lexis.db');
        expect(target).toBe(path.join(data, '.lexis.db'));
        expect(fs.existsSync(path.join(ingest, '.lexis.db'))).toBe(false);
        expect(fs.readFileSync(target, 'utf8')).toBe('STARA_DB');
    });

    test('dataPath nepřepíše existující cíl v DATA_DIR', () => {
        const base = path.join(os.tmpdir(), `lexis_dd_noover_${Date.now()}`);
        const ingest = path.join(base, 'Spisovna');
        const data = path.join(base, 'AppData');
        fs.mkdirSync(ingest, { recursive: true });
        fs.mkdirSync(data, { recursive: true });
        const c = freshConfig({ WATCH_DIR: ingest, LEXIS_DATA_DIR: data });

        fs.writeFileSync(path.join(ingest, '.audit_log.json'), 'LEGACY');
        fs.writeFileSync(path.join(data, '.audit_log.json'), 'NOVY');
        const target = c.dataPath('.audit_log.json');
        expect(fs.readFileSync(target, 'utf8')).toBe('NOVY');
    });
});
