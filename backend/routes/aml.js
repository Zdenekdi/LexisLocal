/**
 * routes/aml.js — AML identifikace a kontrola klienta (zák. 253/2008 Sb.).
 * Montuje se v server.js na /api/aml.
 */
'use strict';

const express = require('express');
const router = express.Router();
const aml = require('../lib/aml');
const { logEvent } = require('../lib/audit');

// POST /api/aml/identify — identifikace + kontrola klienta
router.post('/identify', async (req, res) => {
    try {
        const record = await aml.identify(req.body || {});
        logEvent('AML', 'Identifikace klienta', record.jmeno, { risk: record.risk, spisId: record.spisId });
        res.status(201).json({ check: record });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// GET /api/aml/checks — historie AML prověrek; filtr ?spisId=&risk=
router.get('/checks', (req, res) => {
    try {
        res.json({ checks: aml.listChecks({ spisId: req.query.spisId, risk: req.query.risk }) });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení AML prověrek: ${err.message}` });
    }
});

// GET /api/aml/checks/:id — detail prověrky
router.get('/checks/:id', (req, res) => {
    const check = aml.getCheck(req.params.id);
    if (!check) return res.status(404).json({ error: 'AML prověrka nenalezena.' });
    res.json({ check });
});

// GET /api/aml/watchlist — lokální PEP/sankční seznam kanceláře
router.get('/watchlist', (req, res) => {
    try {
        res.json({ watchlist: aml.listWatch() });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení seznamu: ${err.message}` });
    }
});

// POST /api/aml/watchlist — přidání záznamu { name, type, note }
router.post('/watchlist', (req, res) => {
    try {
        const entry = aml.addWatch(req.body || {});
        logEvent('AML', 'Přidání do PEP/sankčního seznamu', entry.name, { type: entry.type });
        res.status(201).json({ entry });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
