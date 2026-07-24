/**
 * routes/conflicts.js — prověrka střetu zájmů (conflict of interest).
 * Montuje se v server.js na /api/conflicts.
 */
'use strict';

const express = require('express');
const router = express.Router();
const ConflictDetector = require('../lib/conflicts');
const { logEvent } = require('../lib/audit');

// POST /api/conflicts/check - Perform conflict of interest check
router.post('/check', async (req, res) => {
    const { clientName, counterpartyName } = req.body;
    if (!clientName || !counterpartyName) {
        return res.status(400).json({ error: "Jména klienta i protistrany jsou povinná." });
    }
    try {
        const report = await ConflictDetector.checkConflict(clientName, counterpartyName);

        logEvent('LexisEditor', 'Conflicts Check', `Ověřeno: ${clientName} vs ${counterpartyName}`, {
            clientName,
            counterpartyName,
            riskLevel: report.riskLevel
        });

        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: `Nelze provést prověrku střetu zájmů: ${err.message}` });
    }
});

// GET /api/conflicts/history - Get conflicts checks history log
router.get('/history', (req, res) => {
    try {
        const history = ConflictDetector.getHistory();
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst historii prověrek: ${err.message}` });
    }
});

module.exports = router;
