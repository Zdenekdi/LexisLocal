/**
 * Testy řízení přístupu ke spisu a sdílení (lib/access.js + spisy.js + routes).
 *  • solo režim NEOMEZUJE,
 *  • firemní režim je FAIL-CLOSED (cizí nevidí; owner/admin ano),
 *  • grant/revoke, write implikuje read, owner nelze odebrat,
 *  • vizitka složky nese ACL,
 *  • sdílení/odebrání se zapíše do deníku,
 *  • routy /access, /share, /revoke fungují (solo happy-path).
 */
'use strict';

const path = require('path');
const os = require('os');

const TEST_TOKEN = 'test-api-token';
process.env.API_TOKEN = TEST_TOKEN;
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_access_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_access_key_${Date.now()}`);

const request = require('supertest');
const app = require('../server');
const db = require('../lib/database');
const spisy = require('../lib/spisy');
const access = require('../lib/access');
const sf = require('../lib/spisFolders');

const P = (uid, scopes) => ({ userId: uid, name: uid, scopes: scopes || [] });
const H = (r) => r.set('X-API-Token', TEST_TOKEN);

beforeEach(() => {
    db.set('spisy', []);
    db.set('spis_events', []);
    access.setFirmMode(null);
});
afterEach(() => access.setFirmMode(null));

describe('access — solo vs. firemní režim', () => {
    test('solo režim nic neomezuje (i bez principala)', () => {
        access.setFirmMode(false);
        const spis = spisy.createSpis({ spisZn: '15 C 1/2026', klient: 'Novák' });
        expect(access.canAccess(spis, null, 'write')).toBe(true);
        expect(access.canAccess(spis, P('kdokoliv'), 'admin')).toBe(true);
    });

    test('createSpis nastaví owner = odpovědný advokát', () => {
        const spis = spisy.createSpis({ spisZn: '9 C 2/2026', klient: 'X', odpovednyAdvokat: 'advokat:pavel' });
        expect(spisy.getSpisAccess(spis.id).owner).toBe('advokat:pavel');
    });

    test('firemní režim je fail-closed', () => {
        access.setFirmMode(true);
        const spis = spisy.createSpis({ spisZn: '8 As 3/2026', klient: 'Y', odpovednyAdvokat: 'advokat:pavel' });
        expect(access.canAccess(spis, P('cizi'), 'read')).toBe(false);
        expect(access.canAccess(spis, P('advokat:pavel'), 'write')).toBe(true);
        expect(access.canAccess(spis, P('spravce', ['admin']), 'admin')).toBe(true);
        expect(access.canAccess(null, P('x'), 'read')).toBe(false);
    });
});

describe('access — sdílení', () => {
    test('grant read/write, write implikuje read, owner nelze odebrat', () => {
        access.setFirmMode(true);
        const spis = spisy.createSpis({ spisZn: '15 C 9/2026', klient: 'Novák', odpovednyAdvokat: 'advokat:pavel' });
        sf.ensureSpisFolder(spis);

        spisy.shareSpis(spis.id, 'kolega:jana', 'read');
        let s2 = spisy.getSpis(spis.id);
        expect(access.canAccess(s2, P('kolega:jana'), 'read')).toBe(true);
        expect(access.canAccess(s2, P('kolega:jana'), 'write')).toBe(false);

        spisy.shareSpis(spis.id, 'kolega:jana', 'write');
        s2 = spisy.getSpis(spis.id);
        expect(access.canAccess(s2, P('kolega:jana'), 'write')).toBe(true);
        expect(s2.access.readers.includes('kolega:jana')).toBe(false);

        const marker = sf.readMarker(sf.findFolderBySpisId(spis.id).folderPath);
        expect(marker.access.writers).toContain('kolega:jana');

        spisy.revokeSpisAccess(spis.id, 'kolega:jana');
        s2 = spisy.getSpis(spis.id);
        expect(access.canAccess(s2, P('kolega:jana'), 'read')).toBe(false);

        expect(() => spisy.revokeSpisAccess(spis.id, 'advokat:pavel')).toThrow();
    });

    test('sdílení a odebrání se zapíše do spisového deníku', () => {
        const spis = spisy.createSpis({ spisZn: '3 C 4/2026', klient: 'Z' });
        spisy.shareSpis(spis.id, 'kolega:petr', 'read');
        spisy.revokeSpisAccess(spis.id, 'kolega:petr');
        const types = spisy.getSpisTimeline(spis.id).timeline.filter(i => i.kind === 'denik').map(i => i.type);
        expect(types).toContain('sdileni');
        expect(types).toContain('odebrani-pristupu');
    });
});

describe('access — routy (solo happy-path s hlavním tokenem)', () => {
    test('POST /share změní ACL a GET /access ho vrátí', async () => {
        const spis = spisy.createSpis({ spisZn: '15 C 20/2026', klient: 'Novák' });
        const share = await H(request(app).post(`/api/spisy/${spis.id}/share`)).send({ userId: 'kolega:jana', level: 'write' });
        expect(share.statusCode).toBe(200);
        expect(share.body.access.writers).toContain('kolega:jana');

        const get = await H(request(app).get(`/api/spisy/${spis.id}/access`));
        expect(get.statusCode).toBe(200);
        expect(get.body.access.writers).toContain('kolega:jana');

        const rev = await H(request(app).post(`/api/spisy/${spis.id}/revoke`)).send({ userId: 'kolega:jana' });
        expect(rev.statusCode).toBe(200);
        expect(rev.body.access.writers).not.toContain('kolega:jana');
    });
});
