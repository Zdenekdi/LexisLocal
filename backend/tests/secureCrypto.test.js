/**
 * Testy sdíleného šifrování (secure_crypto): AES-256-GCM, zpětné čtení CBC,
 * detekce manipulace (tamper) a migrace klíče mimo datovou složku.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmpWatch = path.join(os.tmpdir(), `lexis_sc_watch_${Date.now()}`);
const tmpKey = path.join(os.tmpdir(), `lexis_sc_key_${Date.now()}`);
fs.mkdirSync(tmpWatch, { recursive: true });
process.env.WATCH_DIR = tmpWatch;
process.env.LEXIS_KEY_DIR = tmpKey;

const sc = require('../lib/secure_crypto');

afterAll(() => {
    for (const d of [tmpWatch, tmpKey]) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
    }
});

describe('secure_crypto', () => {
    const key = crypto.randomBytes(32);

    test('AES-256-GCM round-trip (v2 + tag)', () => {
        const p = sc.encrypt(key, 'tajný obsah á č ř ž');
        expect(p.v).toBe(2);
        expect(p.tag).toBeTruthy();
        expect(sc.decrypt(key, p)).toBe('tajný obsah á č ř ž');
    });

    test('přečte i starší CBC formát (bez tagu)', () => {
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-cbc', key, iv);
        let enc = c.update('stará CBC data', 'utf8', 'hex') + c.final('hex');
        expect(sc.decrypt(key, { iv: iv.toString('hex'), data: enc })).toBe('stará CBC data');
    });

    test('detekce manipulace — změněná data (GCM) vyhodí chybu', () => {
        const p = sc.encrypt(key, 'nedotknutelné');
        const tampered = Object.assign({}, p, { data: p.data.slice(0, -2) + (p.data.endsWith('00') ? '11' : '00') });
        expect(() => sc.decrypt(key, tampered)).toThrow();
    });

    test('resolveKey vytvoří klíč MIMO WATCH_DIR', () => {
        const k = sc.resolveKey();
        expect(Buffer.isBuffer(k)).toBe(true);
        expect(k.length).toBe(32);
        expect(fs.existsSync(path.join(tmpKey, 'lexis.key'))).toBe(true);
        expect(fs.existsSync(path.join(tmpWatch, '.lexis.key'))).toBe(false);
    });

    test('migrace: starý klíč z WATCH_DIR se přesune a smaže', () => {
        // připrav čisté prostředí bez nového klíče, jen se starým u dat
        fs.rmSync(path.join(tmpKey, 'lexis.key'), { force: true });
        const legacy = crypto.randomBytes(32);
        fs.writeFileSync(path.join(tmpWatch, '.lexis.key'), legacy.toString('hex'));
        const resolved = sc.resolveKey();
        expect(resolved.equals(legacy)).toBe(true);
        expect(fs.existsSync(path.join(tmpKey, 'lexis.key'))).toBe(true);       // přesunut sem
        expect(fs.existsSync(path.join(tmpWatch, '.lexis.key'))).toBe(false);   // a smazán od dat
    });
});
