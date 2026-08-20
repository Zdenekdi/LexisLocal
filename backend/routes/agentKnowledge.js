/**
 * routes/agentKnowledge.js — správa VLASTNÍ znalostní báze agenta (per-agent RAG).
 * Každý agent má izolovanou partition `_kb_<id>` (rešeršník = judikatura/legislativa,
 * spisovatel = vzory, kontrolor = checklisty…), do níž se plní dokumenty NEZÁVISLE na
 * klientských spisech. Do vyhledávání vstupuje jen když se ptá daný agent.
 * Montuje se v server.js na /api/agent-knowledge.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { loadAgents } = require('../lib/agents');
const rag = require('../lib/rag');
const { logEvent } = require('../lib/audit');

// Vrátí agenta + jeho scope, nebo pošle 404.
function resolveAgent(req, res) {
    const agents = loadAgents();
    const agent = agents[req.params.agentId];
    if (!agent) {
        res.status(404).json({ error: `Agent „${req.params.agentId}" nebyl nalezen.` });
        return null;
    }
    if (!agent.knowledgeScope) {
        res.status(500).json({ error: `Agent „${agent.id}" nemá nastavenou znalostní bázi (knowledgeScope).` });
        return null;
    }
    return agent;
}

// GET /api/agent-knowledge/:agentId — seznam dokumentů ve znalostní bázi agenta
router.get('/:agentId', (req, res) => {
    const agent = resolveAgent(req, res);
    if (!agent) return;
    try {
        res.json({ success: true, agentId: agent.id, scope: agent.knowledgeScope, documents: rag.listKnowledge(agent.knowledgeScope) });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst znalostní bázi: ${err.message}` });
    }
});

// POST /api/agent-knowledge/:agentId — přidá/aktualizuje dokument ve znalostní bázi
// Body: { fileName, text }
router.post('/:agentId', async (req, res) => {
    const agent = resolveAgent(req, res);
    if (!agent) return;
    const { fileName, text } = req.body || {};
    if (!fileName || !String(fileName).trim() || !text || !String(text).trim()) {
        return res.status(400).json({ error: 'Povinné je „fileName" i „text".' });
    }
    try {
        const result = await rag.indexKnowledge(agent.knowledgeScope, String(fileName).trim(), String(text));
        logEvent('LexisLocal Dashboard', `Znalostní báze agenta: ${agent.name}`, 'Per-agent RAG', {
            agentId: agent.id, scope: agent.knowledgeScope, fileName: fileName, chunks: result.indexed
        });
        res.json({ success: true, agentId: agent.id, scope: agent.knowledgeScope, ...result });
    } catch (err) {
        res.status(500).json({ error: `Indexace do znalostní báze selhala: ${err.message}` });
    }
});

// POST /api/agent-knowledge/:agentId/reindex — re-embeduje bázi (po změně modelu)
router.post('/:agentId/reindex', async (req, res) => {
    const agent = resolveAgent(req, res);
    if (!agent) return;
    try {
        const result = await rag.reindexKnowledge(agent.knowledgeScope);
        logEvent('LexisLocal Dashboard', `Re-embedding báze: ${agent.name}`, 'Per-agent RAG', {
            agentId: agent.id, scope: agent.knowledgeScope, embedded: result.embedded, chunks: result.chunks
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: `Re-embedding znalostní báze selhal: ${err.message}` });
    }
});

// DELETE /api/agent-knowledge/:agentId/:fileName — odstraní dokument ze znalostní báze
router.delete('/:agentId/:fileName', async (req, res) => {
    const agent = resolveAgent(req, res);
    if (!agent) return;
    try {
        const result = await rag.deleteKnowledge(agent.knowledgeScope, decodeURIComponent(req.params.fileName));
        logEvent('LexisLocal Dashboard', `Smazání z báze agenta: ${agent.name}`, 'Per-agent RAG', {
            agentId: agent.id, fileName: req.params.fileName, removed: result.removed
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: `Mazání ze znalostní báze selhalo: ${err.message}` });
    }
});

module.exports = router;
