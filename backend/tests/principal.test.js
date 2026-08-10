/**
 * Testy principal.js — jednotné „kdo volá" (identita + scopy). Solo = implicitní
 * uživatel s plnými právy (dnešní chování), agent token nese své scopy, hlavní
 * token = plná práva, vynucení bez tokenu = null (401). Šev pro firemní per-user.
 */
const os = require('os');
const path = require('path');
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_principal_${Date.now()}`);

const { resolvePrincipal, hasScope, FULL_SCOPES } = require('../lib/principal');
const agentTokens = require('../lib/agent_tokens');

const reqWith = (token) => ({ headers: token ? { 'x-api-token': token } : {}, query: {} });

describe('resolvePrincipal', () => {
    test('solo (bez vynucení, bez tokenu) → implicitní uživatel s plnými právy', () => {
        const p = resolvePrincipal(reqWith(null), { enforceToken: false });
        expect(p.userId).toBe('local');
        expect(p.kind).toBe('implicit');
        expect(p.scopes).toEqual(FULL_SCOPES);
        expect(p.isAuthenticated).toBe(false);
    });

    test('hlavní API token → lokální správce, plná práva, autentizován', () => {
        const p = resolvePrincipal(reqWith('SECRET'), { apiToken: 'SECRET', enforceToken: true });
        expect(p.kind).toBe('local-token');
        expect(p.scopes).toEqual(FULL_SCOPES);
        expect(p.isAuthenticated).toBe(true);
    });

    test('vynuceno a token nesedí → null (volající vrátí 401)', () => {
        expect(resolvePrincipal(reqWith('WRONG'), { apiToken: 'SECRET', enforceToken: true })).toBeNull();
        expect(resolvePrincipal(reqWith(null), { apiToken: 'SECRET', enforceToken: true })).toBeNull();
    });

    test('per-agent token → identita a jeho scopy', () => {
        const tok = agentTokens.createToken('resersnik', ['read']);
        const p = resolvePrincipal(reqWith(tok), { apiToken: 'SECRET', enforceToken: true });
        expect(p.kind).toBe('agent');
        expect(p.name).toBe('resersnik');
        expect(p.scopes).toEqual(['read']);
    });
});

describe('hasScope (admin implikuje vše)', () => {
    test('admin má na vše', () => {
        expect(hasScope({ scopes: ['admin'] }, 'write')).toBe(true);
    });
    test('read nemá write', () => {
        expect(hasScope({ scopes: ['read'] }, 'write')).toBe(false);
        expect(hasScope({ scopes: ['read'] }, 'read')).toBe(true);
    });
    test('prázdný/neexistující principal → false', () => {
        expect(hasScope(null, 'read')).toBe(false);
        expect(hasScope({}, 'read')).toBe(false);
    });
});
