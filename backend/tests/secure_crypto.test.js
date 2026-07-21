const crypto = require('crypto');
const path = require('path');
const os = require('os');
const secureCrypto = require('../lib/secure_crypto');

describe('secure_crypto (AES-256-GCM vrstva)', () => {
    const key = crypto.randomBytes(32);

    describe('encrypt / decrypt (GCM)', () => {
        it('round-trip: dešifruje zpět původní text', () => {
            const plaintext = JSON.stringify({ tajne: 'důvěrné', num: 42 });
            const payload = secureCrypto.encrypt(key, plaintext);
            expect(secureCrypto.decrypt(key, payload)).toBe(plaintext);
        });

        it('payload je označen jako aes-256-gcm a nese authTag', () => {
            const payload = secureCrypto.encrypt(key, 'ahoj');
            expect(payload.alg).toBe('aes-256-gcm');
            expect(typeof payload.authTag).toBe('string');
            expect(payload.authTag.length).toBeGreaterThan(0);
            expect(payload.data).not.toContain('ahoj'); // opravdu zašifrováno
        });

        it('detekuje manipulaci s daty (integrita)', () => {
            const payload = secureCrypto.encrypt(key, 'citlivá data');
            // Pozměníme šifrovaná data — GCM ověření musí selhat.
            const tampered = { ...payload, data: payload.data.replace(/.$/, (c) => (c === '0' ? '1' : '0')) };
            expect(() => secureCrypto.decrypt(key, tampered)).toThrow();
        });

        it('detekuje pozměněný authTag', () => {
            const payload = secureCrypto.encrypt(key, 'citlivá data');
            const tampered = { ...payload, authTag: payload.authTag.replace(/.$/, (c) => (c === '0' ? '1' : '0')) };
            expect(() => secureCrypto.decrypt(key, tampered)).toThrow();
        });

        it('špatný klíč nedešifruje', () => {
            const payload = secureCrypto.encrypt(key, 'data');
            expect(() => secureCrypto.decrypt(crypto.randomBytes(32), payload)).toThrow();
        });
    });

    describe('zpětná kompatibilita se starším AES-256-CBC', () => {
        it('dešifruje legacy CBC payload (bez authTag)', () => {
            const plaintext = 'starý zašifrovaný obsah';
            // Ručně vyrobíme legacy CBC payload ve starém formátu.
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let enc = cipher.update(plaintext, 'utf8', 'hex');
            enc += cipher.final('hex');
            const legacyPayload = { iv: iv.toString('hex'), data: enc };

            expect(secureCrypto.decrypt(key, legacyPayload)).toBe(plaintext);
        });

        it('neplatný payload vyhodí čitelnou chybu', () => {
            expect(() => secureCrypto.decrypt(key, { iv: 'aa' })).toThrow(/Neplatný formát/);
        });
    });

    describe('resolveKeyDir', () => {
        const origKeyDir = process.env.LEXIS_KEY_DIR;
        afterEach(() => {
            if (origKeyDir === undefined) delete process.env.LEXIS_KEY_DIR;
            else process.env.LEXIS_KEY_DIR = origKeyDir;
        });

        it('respektuje explicitní LEXIS_KEY_DIR', () => {
            process.env.LEXIS_KEY_DIR = '/tmp/moje-klice';
            expect(secureCrypto.resolveKeyDir()).toBe('/tmp/moje-klice');
        });

        it('v testovacím prostředí míří mimo WATCH_DIR (do temp)', () => {
            delete process.env.LEXIS_KEY_DIR; // NODE_ENV=test větev
            const dir = secureCrypto.resolveKeyDir();
            expect(dir).toBe(path.join(os.tmpdir(), 'lexislocal-test-keys'));
        });
    });
});
