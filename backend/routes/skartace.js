/**
 * routes/skartace.js — skartační/archivační režim spisové služby.
 * Montuje se v server.js na /api/skartace.
 */
'use strict';

const express = require('express');
const router = express.Router();
const skartace = require('../lib/skartace');
const { logEvent } = require('../lib/audit');

// GET /api/skartace/navrh — spisy s uplynulou retencí + čekající na skartaci
router.get('/navrh', (req, res) => {
    try {
        res.json(skartace.getSkartaceNavrh());
    } catch (err) {
        res.status(500).json({ error: `Chyba skartačního návrhu: ${err.message}` });
    }
});

// GET /api/skartace/protokoly — historie skartačních protokolů
router.get('/protokoly', (req, res) => {
    try {
        res.json({ protokoly: skartace.listProtokoly() });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení protokolů: ${err.message}` });
    }
});

// POST /api/skartace/protokol — vytvoří skartační protokol { spisIds, zpracoval, poznamka }
router.post('/protokol', (req, res) => {
    try {
        const { spisIds, zpracoval, poznamka } = req.body || {};
        const protokol = skartace.buildProtokol(spisIds, { zpracoval, poznamka });
        logEvent('Skartace', 'Vytvoření skartačního protokolu', protokol.id, { pocet: protokol.pocet });
        res.status(201).json({ protokol });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
