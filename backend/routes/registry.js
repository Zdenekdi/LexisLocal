/**
 * routes/registry.js — jednoduchá lustrace subjektu (ARES + ISIR) bez simulací.
 * Montuje se v server.js na /api/registry.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { checkSubject } = require('../lib/registries');

// GET /api/registry/check - Lustrace subjektu podle IČO
router.get('/check', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný parametr." });
    }

    try {
        const result = await checkSubject(ico);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Chyba při lustraci subjektu: ${err.message}` });
    }
});

module.exports = router;
