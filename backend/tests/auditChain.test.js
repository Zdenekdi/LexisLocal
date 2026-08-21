/**
 * Testy tamper-evident řetězu auditního logu (lib/audit.js):
 *  • každý záznam nese hash + prevHash a navazují,
 *  • změna obsahu záznamu je detekována (content-tampered),
 *  • smazání/přeuspořádání je detekováno (chain-broken),
 *  • ořez logu na kotvu nezpůsobí falešný poplach,
 *  • legacy záznamy bez hashe verifikaci neshodí.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), `lexis_test_auditchain_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const audit = require('../lib/audit');
const sc = require('../lib/secure_crypto');
const AUDIT_FILE = path.join(tmp, '.audit_log.json');

function rewrite(arr) {
    const key = sc.resolveKey();
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(sc.encrypt(key, JSON.stringify(arr))), 'utf8');
}
function readArr() {
    const key = sc.resolveKey();
    return JSON.parse(sc.decrypt(key, JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'))));
}

beforeEach(() => audit.clearAuditLogs());

describe('audit hash-chain', () => {
    test('nové záznamy nesou hash + prevHash a navazují', () => {
        audit.logEvent('U', 'Op1', 't1', { spisId: 'S1' });
        audit.logEvent('U', 'Op2', 't2', { spisId: 'S1' });
        const logs = audit.loadAuditLogs();
        expect(logs.every(e => e.hash && e.prevHash)).toBe(true);
        expect(logs[1].prevHash).toBe(logs[0].hash);
    });

    test('celý řetěz projde verifikací', () => {
        audit.logEvent('U', 'A', 't', {});
        audit.logEvent('U', 'B', 't', {});
        audit.logEvent('U', 'C', 't', {});
        const v = audit.verifyAuditChain();
        expect(v.ok).toBe(true);
        expect(v.checked).toBe(3);
    });

    test('změna obsahu záznamu je detekována', () => {
        audit.logEvent('U', 'A', 't', {});
        audit.logEvent('U', 'B', 't', {});
        const arr = readArr();
        arr[1].target = 'PODVRŽENO';
        rewrite(arr);
        const v = audit.verifyAuditChain();
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('content-tampered');
        expect(v.brokenAt).toBe(1);
    });

    test('smazání prostředního záznamu je detekováno', () => {
        audit.logEvent('U', 'A', 't', {});
        audit.logEvent('U', 'B', 't', {});
        audit.logEvent('U', 'C', 't', {});
        const arr = readArr();
        rewrite([arr[0], arr[2]]);
        const v = audit.verifyAuditChain();
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('chain-broken');
    });

    test('ořez logu (kotva) nezpůsobí falešný poplach', () => {
        audit.logEvent('U', 'A', 't', {});
        audit.logEvent('U', 'B', 't', {});
        audit.logEvent('U', 'C', 't', {});
        const arr = readArr();
        rewrite(arr.slice(1));
        expect(audit.verifyAuditChain().ok).toBe(true);
    });

    test('legacy záznam bez hashe: legacy++, verifikace projde', () => {
        rewrite([{ id: 'old', timestamp: '2020-01-01', operation: 'legacy' }]);
        audit.logEvent('U', 'New', 't', {});
        const v = audit.verifyAuditChain();
        expect(v.ok).toBe(true);
        expect(v.legacy).toBe(1);
        expect(v.checked).toBe(1);
    });
});
