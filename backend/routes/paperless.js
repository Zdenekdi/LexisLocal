/**
 * routes/paperless.js — webhook pro příjem dokumentů z paperless-ngx.
 * Montuje se v server.js na /api/paperless.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { handlePaperlessWebhook } = require('../lib/paperless');

// POST /api/paperless/webhook - Zpracuje příchozí dokument z paperless-ngx
router.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const result = await handlePaperlessWebhook(payload);
        res.json({ success: true, file: result });
    } catch (err) {
        console.error("❌ Paperless Webhook Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
