/**
 * routes/judikatura.js — kontrola compliance dokumentů proti judikatuře.
 * Montuje se v server.js na /api/judikatura.
 */
'use strict';

const express = require('express');
const router = express.Router();
const JudikaturaWatcher = require('../lib/judikatura');
const { logEvent } = require('../lib/audit');

// POST /api/judikatura/check - Run compliance check on document text content
router.post('/check', (req, res) => {
    const { content, documentName } = req.body;
    if (!content) {
        return res.status(400).json({ error: "Obsah dokumentu (content) je povinný." });
    }
    try {
        const result = JudikaturaWatcher.checkTemplateCompliance(content, documentName || "Aktivní dokument");

        logEvent('LexisEditor', 'Compliance Check', `Ověřeno: ${documentName || "Dokument"}`, {
            documentName: documentName || "Dokument",
            compliant: result.compliant,
            alertsCount: result.alerts.length
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Nelze provést kontrolu compliance: ${err.message}` });
    }
});

// GET /api/judikatura/benchmarks - Get active Supreme Court benchmarks list
router.get('/benchmarks', (req, res) => {
    try {
        const benchmarks = JudikaturaWatcher.getBenchmarks();
        res.json({ success: true, benchmarks });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst judikáty: ${err.message}` });
    }
});

// GET /api/judikatura/history - Retrieve compliance checks runs history logs
router.get('/history', (req, res) => {
    try {
        const history = JudikaturaWatcher.getHistory();
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst historii compliance: ${err.message}` });
    }
});

module.exports = router;
