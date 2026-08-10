// --- principal — jednotné určení „kdo volá" (identita + scopy) ---
// Šev pro budoucí per-user identitu (firemní režim). Solo režim = JEDEN implicitní
// uživatel s plnými právy → dnešní chování se nemění. Nebetonuje „jeden token =
// plný přístup": principal nese scopy, na kterých později postaví role a etické zdi.
//
// resolvePrincipal(req, { apiToken, enforceToken }) → principal | null
//   principal = { userId, name, scopes[], isAuthenticated, kind }
//   null = vynucení zapnuté a token nesedí (volající vrátí 401).

'use strict';

const { extractToken } = require('./auth');
const agentTokens = require('./agent_tokens');

const FULL_SCOPES = ['read', 'write', 'admin'];

function resolvePrincipal(req, opts) {
    opts = opts || {};
    const token = extractToken(req);

    if (token) {
        // 1) Per-agent token se scopy — základ budoucí per-user identity.
        try {
            const a = agentTokens.verifyToken(token);
            if (a) {
                return { userId: 'agent:' + a.name, name: a.name, scopes: Array.isArray(a.scopes) ? a.scopes : [], isAuthenticated: true, kind: 'agent' };
            }
        } catch (e) { /* ignore — spadneme na další možnost */ }

        // 2) Hlavní API token = lokální správce s plnými právy.
        if (opts.apiToken && token === opts.apiToken) {
            return { userId: 'local', name: 'Místní uživatel', scopes: FULL_SCOPES.slice(), isAuthenticated: true, kind: 'local-token' };
        }
    }

    // 3) Bez vynucení = solo režim: jeden implicitní uživatel s plnými právy.
    if (!opts.enforceToken) {
        return { userId: 'local', name: 'Místní uživatel', scopes: FULL_SCOPES.slice(), isAuthenticated: false, kind: 'implicit' };
    }

    // 4) Vynuceno a token nesedí → žádný principal.
    return null;
}

// admin scope implikuje vše ostatní.
function hasScope(principal, scope) {
    return !!(principal && Array.isArray(principal.scopes) &&
        (principal.scopes.indexOf('admin') !== -1 || principal.scopes.indexOf(scope) !== -1));
}

module.exports = { resolvePrincipal, hasScope, FULL_SCOPES };
