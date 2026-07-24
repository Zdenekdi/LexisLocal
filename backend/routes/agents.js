/**
 * routes/agents.js — správa AI agentů (CRUD).
 * Montuje se v server.js na /api/agents.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { loadAgents, saveAgent, deleteAgent, resetAgentToDefault } = require('../lib/agents');
const { logEvent } = require('../lib/audit');

// GET /api/agents - Seznam agentů
router.get('/', (req, res) => {
    try {
        const agents = loadAgents();
        res.json({ success: true, agents: Object.values(agents) });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst agenty: ${err.message}` });
    }
});

// POST /api/agents/:agentId - Update an agent
router.post('/:agentId', (req, res) => {
    const { agentId } = req.params;
    const { name, emoji, role, systemPrompt, preferredModel, permissions } = req.body;
    try {
        const updated = saveAgent(agentId, { name, emoji, role, systemPrompt, preferredModel, permissions });
        logEvent('LexisLocal Dashboard', `Úprava agenta (${updated.name})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, agent: updated });
    } catch (err) {
        res.status(500).json({ error: `Nelze upravit agenta: ${err.message}` });
    }
});

// POST /api/agents - Create a new custom agent
router.post('/', (req, res) => {
    const { id, name, emoji, role, systemPrompt, preferredModel, permissions } = req.body;
    if (!id || !name) {
        return res.status(400).json({ error: "ID a název agenta jsou povinné údaje." });
    }
    const cleanId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').trim();
    try {
        const agents = loadAgents();
        if (agents[cleanId]) {
            return res.status(400).json({ error: `Agent s ID "${cleanId}" již existuje.` });
        }
        const created = saveAgent(cleanId, { name, emoji, role, systemPrompt, preferredModel, permissions });
        logEvent('LexisLocal Dashboard', `Vytvoření agenta (${created.name})`, 'AI Konfigurace', { agentId: cleanId });
        res.json({ success: true, agent: created });
    } catch (err) {
        res.status(500).json({ error: `Nelze vytvořit agenta: ${err.message}` });
    }
});

// DELETE /api/agents/:agentId - Delete a custom agent
router.delete('/:agentId', (req, res) => {
    const { agentId } = req.params;
    try {
        deleteAgent(agentId);
        logEvent('LexisLocal Dashboard', `Smazání agenta (${agentId})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, message: `Agent ${agentId} byl smazán.` });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/agents/:agentId/reset - Reset system agent back to default
router.post('/:agentId/reset', (req, res) => {
    const { agentId } = req.params;
    try {
        const reseted = resetAgentToDefault(agentId);
        logEvent('LexisLocal Dashboard', `Reset agenta (${reseted.name})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, agent: reseted });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
