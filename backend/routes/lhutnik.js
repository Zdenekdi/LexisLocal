/**
 * routes/lhutnik.js — centrální přehled lhůt napříč spisy.
 * Montuje se v server.js na /api/lhutnik.
 */
'use strict';

const express = require('express');
const router = express.Router();
const lhutnik = require('../lib/lhutnik');
const { logEvent } = require('../lib/audit');

// GET /api/lhutnik — přehled + souhrn. Filtry: ?spisId=, ?onlyReview=1
router.get('/', (req, res) => {
    try {
        const result = lhutnik.getLhutnik({
            spisId: req.query.spisId || null,
            onlyReview: req.query.onlyReview === '1' || req.query.onlyReview === 'true'
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Chyba při sestavení lhůtníku: ${err.message}` });
    }
});

// POST /api/lhutnik/confirm — potvrdí nejistou lhůtu { fileId, index }
router.post('/confirm', (req, res) => {
    try {
        const { fileId, index } = req.body || {};
        const dl = lhutnik.confirmDeadline(fileId, parseInt(index, 10));
        logEvent('Lhůtník', 'Potvrzení lhůty', fileId, { index });
        res.json({ success: true, deadline: dl });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/lhutnik/dismiss — odloží/zamítne nejistou lhůtu { fileId, index }
router.post('/dismiss', (req, res) => {
    try {
        const { fileId, index } = req.body || {};
        const dl = lhutnik.dismissDeadline(fileId, parseInt(index, 10));
        logEvent('Lhůtník', 'Odložení lhůty', fileId, { index });
        res.json({ success: true, deadline: dl });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
