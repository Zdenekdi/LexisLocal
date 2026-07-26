/**
 * Testy api_token (../lib/api_token.js) — generování + persistence API tokenu.
 * LEXIS_KEY_DIR se nastaví na temp před require (token jde vedle klíče).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lexis_apitoken_'));
process.env.LEXIS_KEY_DIR = TMP;
delete process.env.API_TOKEN;

const { resolveApiToken, tokenFile } = require('../lib/api_token');

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });
afterEach(() => { delete process.env.API_TOKEN; });

describe('resolveApiToken', () => {
    test('token z prostředí má přednost', () => {
        process.env.API_TOKEN = 'env-token-xyz';
        expect(resolveApiToken()).toBe('env-token-xyz');
    });

    test('bez env vygeneruje 64hex token a uloží ho na disk (0600)', () => {
        // úklid případného předchozího
        try { fs.unlinkSync(tokenFile()); } catch (e) {}
        const t = resolveApiToken();
        expect(t).toMatch(/^[0-9a-f]{64}$/);
        expect(fs.existsSync(tokenFile())).toBe(true);
        const mode = fs.statSync(tokenFile()).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    test('je perzistentní — druhé volání vrátí STEJNÝ token (načte ze souboru)', () => {
        const a = resolveApiToken();
        const b = resolveApiToken();
        expect(a).toBe(b);
        expect(fs.readFileSync(tokenFile(), 'utf8').trim()).toBe(a);
    });
});
