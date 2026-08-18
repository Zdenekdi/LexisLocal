/**
 * routes/spisy.js — spisová služba: spis jako entita.
 * Montuje se v server.js na /api/spisy.
 */
'use strict';

const express = require('express');
const router = express.Router();
const spisy = require('../lib/spisy');
const { logEvent } = require('../lib/audit');

// GET /api/spisy — seznam všech spisů
router.get('/', (req, res) => {
    try {
        res.json({ spisy: spisy.listSpisy() });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení spisů: ${err.message}` });
    }
});

// POST /api/spisy — založení nového spisu
router.post('/', (req, res) => {
    try {
        const spis = spisy.createSpis(req.body || {});
        logEvent('Spisová služba', 'Založení spisu', spis.spisZn || spis.nazev, { id: spis.id });
        res.status(201).json({ spis });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/spisy/sync — odvodí/synchronizuje spisy z inboxu (idempotentní)
router.post('/sync', (req, res) => {
    try {
        const result = spisy.syncFromInbox();
        logEvent('Spisová služba', 'Synchronizace z inboxu', 'inbox_files', result);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: `Chyba synchronizace spisů: ${err.message}` });
    }
});

// GET /api/spisy/unfiled — dokumenty bez rozpoznané sp. zn. (k ručnímu zařazení)
router.get('/unfiled', (req, res) => {
    try {
        res.json({ files: spisy.listUnfiled() });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení nezařazených: ${err.message}` });
    }
});

// GET /api/spisy/:id — kompletní detail spisu se vším navázaným obsahem
router.get('/:id', (req, res) => {
    const detail = spisy.getSpisDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Spis nenalezen.' });
    res.json(detail);
});

// PATCH /api/spisy/:id — úprava údajů spisu
router.patch('/:id', (req, res) => {
    try {
        const updated = spisy.updateSpis(req.params.id, req.body || {});
        if (!updated) return res.status(404).json({ error: 'Spis nenalezen.' });
        res.json({ spis: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/spisy/:id/stav — změna stavu (aktivni | archiv | skartace)
router.post('/:id/stav', (req, res) => {
    try {
        const updated = spisy.setStav(req.params.id, (req.body && req.body.stav));
        if (!updated) return res.status(404).json({ error: 'Spis nenalezen.' });
        logEvent('Spisová služba', 'Změna stavu spisu', updated.spisZn || updated.nazev, { stav: updated.stav });
        res.json({ spis: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/spisy/:id/event — přidání úkonu do spisového deníku
router.post('/:id/event', (req, res) => {
    try {
        const spis = spisy.getSpis(req.params.id);
        if (!spis) return res.status(404).json({ error: 'Spis nenalezen.' });
        const ev = spisy.addEvent(req.params.id, (req.body && req.body.type), (req.body && req.body.note), (req.body && req.body.meta));
        res.status(201).json({ event: ev });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/spisy/:id/assign-file — ruční zařazení dokumentu do spisu { fileId }
router.post('/:id/assign-file', (req, res) => {
    try {
        const file = spisy.assignFileToSpis((req.body && req.body.fileId), req.params.id);
        logEvent('Spisová služba', 'Zařazení dokumentu do spisu', file.fileName || file.id, { spisId: req.params.id });
        res.json({ success: true, file });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE /api/spisy/:id — odstranění spisové hlavičky (jen ve stavu skartace)
router.delete('/:id', (req, res) => {
    try {
        const removed = spisy.deleteSpis(req.params.id);
        if (!removed) return res.status(404).json({ error: 'Spis nenalezen.' });
        logEvent('Spisová služba', 'Odstranění spisu (skartace)', removed.spisZn || removed.nazev, { id: removed.id });
        res.json({ success: true, removed });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
