/**
 * Testy napojení orchestrátoru na bezpečné uložení konceptu do spisu
 * (routes/agentSwarm.js /orchestrate). AI i RAG jsou mockované, ať test nesahá
 * na žádný model. Ověřuje:
 *  • bez spisId/saveDraft se neuloží nic,
 *  • známý spis + saveDraft → koncept do 03_Koncepty (filed),
 *  • neznámý spis → fail-closed do _Nezařazeno,
 *  • odmítnutí kvůli nedostatku podkladů se NEUKLÁDÁ jako koncept.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_TOKEN = 'test-api-token';
process.env.API_TOKEN = TEST_TOKEN;
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_orchdraft_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_orchdraft_key_${Date.now()}`);

// Mock orchestrátoru — vrátí koncept bez volání AI. Na 'REFUSE' vrátí odmítnutí.
jest.mock('../lib/orchestrator', () => ({
    orchestrate: jest.fn(async (prompt) => ({
        model: 'test',
        steps: [],
        finalOutput: /REFUSE/.test(String(prompt))
            ? 'Nedostatek podkladů ze spisů pro bezpečné vypracování. Chybí podklad X.'
            : 'FINÁLNÍ KONCEPT PODÁNÍ — tělo dokumentu.',
        durationMs: 1
    }))
}));
// Mock RAG filtrů, ať /orchestrate nesahá na embeddingy.
jest.mock('../lib/rag_request', () => ({
    resolveRagFilters: jest.fn(async () => null),
    applyAgentScope: jest.fn((x) => x)
}));

const request = require('supertest');
const app = require('../server');
const spisy = require('../lib/spisy');
const sf = require('../lib/spisFolders');

const H = (r) => r.set('X-API-Token', TEST_TOKEN);

describe('Orchestrátor → bezpečné uložení konceptu', () => {
    test('bez spisId/saveDraft se neuloží nic', async () => {
        const res = await H(request(app).post('/api/agent-swarm/orchestrate'))
            .send({ prompt: 'napiš žalobu' });
        expect(res.statusCode).toBe(200);
        expect(res.body.draft).toBeUndefined();
    });

    test('známý spis + saveDraft → koncept do 03_Koncepty (filed)', async () => {
        const spis = spisy.createSpis({ spisZn: '15 C 5/2026', klient: 'Novák', protistrana: 'ČSOB' });
        const res = await H(request(app).post('/api/agent-swarm/orchestrate'))
            .send({ prompt: 'napiš žalobu', spisId: spis.id, saveDraft: true, fileName: 'zaloba.docx' });
        expect(res.statusCode).toBe(200);
        expect(res.body.draft).toBeDefined();
        expect(res.body.draft.filed).toBe(true);
        expect(res.body.draft.savedPath).toContain('03_Koncepty');
        expect(fs.existsSync(res.body.draft.savedPath)).toBe(true);
    });

    test('neznámý spis + saveDraft → fail-closed do _Nezařazeno', async () => {
        const res = await H(request(app).post('/api/agent-swarm/orchestrate'))
            .send({ prompt: 'napiš žalobu', spisId: 'spis_NEEXISTUJE', saveDraft: true });
        expect(res.statusCode).toBe(200);
        expect(res.body.draft).toBeDefined();
        expect(res.body.draft.filed).toBe(false);
        expect(res.body.draft.savedPath).toContain(sf.NEZARAZENO);
    });

    test('odmítnutí kvůli nedostatku podkladů se NEUKLÁDÁ', async () => {
        const spis = spisy.createSpis({ spisZn: '8 As 7/2026', klient: 'Dvořák' });
        const res = await H(request(app).post('/api/agent-swarm/orchestrate'))
            .send({ prompt: 'REFUSE prosím', spisId: spis.id, saveDraft: true });
        expect(res.statusCode).toBe(200);
        expect(res.body.draft).toBeUndefined();
        expect(res.body.draftSkipped).toBe('refused-insufficient-material');
    });
});
