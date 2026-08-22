/**
 * routes/settings.js — nastavení aplikace. Zatím: výběr SPISOVNY (INGEST_DIR).
 * Montuje se v server.js na /api/settings.
 *
 * Spisovnu lze nastavit za běhu: cesta se perzistuje a watcher se přepne bez
 * restartu (nové dokumenty se hned berou z nové složky). Plné promítnutí do
 * všech částí (např. RAG sken) se dorovná po restartu — proto restartRecommended.
 */
'use strict';

const express = require('express');
const router = express.Router();
const config = require('../lib/config');
const { logEvent } = require('../lib/audit');

let watcher = null;
try { watcher = require('../lib/watcher'); } catch (e) { /* watcher volitelný */ }

// GET /api/settings/ingest-dir — aktuální spisovna, datová složka a zda je výchozí
router.get('/ingest-dir', (req, res) => {
    const persisted = config.readSettings().ingestDir || null;
    res.json({
        ingestDir: config.getIngestDir(),
        dataDir: config.DATA_DIR,
        persisted: persisted,
        isDefault: !persisted && !process.env.WATCH_DIR && !process.env.INGEST_DIR
    });
});

// POST /api/settings/ingest-dir { path } — nastaví spisovnu + přepne watcher za běhu
router.post('/ingest-dir', (req, res) => {
    try {
        const resolved = config.setIngestDir(req.body && req.body.path);
        let repointed = false;
        try {
            if (watcher && watcher.repointWatcher) { watcher.repointWatcher(resolved); repointed = true; }
        } catch (e) { /* repoint best-effort */ }
        logEvent('Nastavení', 'Změna spisovny', resolved, { repointed });
        res.json({ success: true, ingestDir: resolved, repointed, restartRecommended: !repointed });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
