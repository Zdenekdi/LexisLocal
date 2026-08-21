/**
 * routes/registries.js — rozšířená lustrace (ARES + ISIR reálné; CEE + Katastr přes
 * konfigurované placené API, jinak „není k dispozici" — žádná fingovaná data).
 * Montuje se v server.js na /api/registries.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { checkSubject, checkCee, checkKatastr } = require('../lib/registries');
const { safePathInWatchDir } = require('../lib/pathsafe');

// GET /api/registries/check - Query all registries for an ICO
router.get('/check', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný údaj." });
    }
    try {
        const result = await checkSubject(ico);

        // CEE (exekuce) a Katastr: reálný dotaz přes konfigurované API. Bez konfigurace
        // se vrací { available:false } — ŽÁDNÁ odhadovaná/fingovaná data.
        const [cee, katastr] = await Promise.all([checkCee(ico), checkKatastr(ico)]);
        result.cee = cee;
        result.katastr = katastr;

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Lustrace selhala: ${err.message}` });
    }
});

// POST /api/registries/save-report - Save structured registry audit to Desktop case directory
router.post('/save-report', async (req, res) => {
    const { ico, name, reportText, caseNumber } = req.body;
    if (!ico || !name || !reportText) {
        return res.status(400).json({ error: "Chybí povinná data pro uložení prověrky." });
    }

    // IČO smí obsahovat pouze číslice (obrana proti path traversal přes ico).
    const cleanIco = String(ico).replace(/\D/g, '').slice(0, 12);
    if (!cleanIco) {
        return res.status(400).json({ error: "Neplatné IČO." });
    }

    try {
        const cleanName = name.replace(/[^a-zA-Z0-9čšžýáíéóúůďťňĎŤŇČŠŽÝÁÍÉÓÚŮ\s-_]/g, '').replace(/\s+/g, '_');
        const fileName = `Proverka_${cleanName}_${cleanIco}.txt`;
        const filePath = safePathInWatchDir(fileName);

        await fs.promises.writeFile(filePath, reportText, 'utf-8');
        console.log(`📥 Lustrační centrum: Uložena nová prověrka do: ${filePath}`);

        res.json({ success: true, fileName, filePath });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se uložit prověrku: ${err.message}` });
    }
});

module.exports = router;
