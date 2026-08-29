/**
 * routes/registries.js — rozšířená lustrace (ARES + ISIR + SIMULOVANÉ CEE/Katastr)
 * a ukládání prověrky do složky spisu.
 * Montuje se v server.js na /api/registries.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { checkSubject, findDataBox, isIsdsConfigured } = require('../lib/registries');
const { safePathInWatchDir } = require('../lib/pathsafe');

// GET /api/registries/check - Query all registries for an ICO
router.get('/check', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný údaj." });
    }
    try {
        const result = await checkSubject(ico);

        // Add Simulated Executions (CEE) and Simulated Cadastre (Katastr) for full professional coverage
        const cleanIco = ico.replace(/\s+/g, '').trim();
        const lastDigit = parseInt(cleanIco.slice(-1)) || 0;

        // CEE Simulation based on deterministic seed (ICO last digit)
        // simulated:true je strojově čitelný příznak — frontend NESMÍ tato data
        // prezentovat jako ověřená (jde o odhad, ne o reálné dotazy do CEE).
        if (lastDigit % 3 === 0) {
            result.cee = {
                simulated: true,
                activeExecutions: 2,
                totalAmount: 184500,
                disclaimer: "SIMULOVÁNO (neověřeno) z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        } else {
            result.cee = {
                simulated: true,
                activeExecutions: 0,
                totalAmount: 0,
                disclaimer: "SIMULOVÁNO (neověřeno) z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        }

        // Katastr Simulation based on seed
        result.katastr = {
            simulated: true,
            propertiesCount: lastDigit % 2 === 0 ? 1 : 0,
            hasPlomba: lastDigit % 4 === 0,
            disclaimer: "SIMULOVÁNO (neověřeno) z Katastru nemovitostí (dálkový přístup)."
        };

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Lustrace selhala: ${err.message}` });
    }
});

// GET /api/registries/databox?ico=... — vyhledání ID datové schránky (ISDS FindDataBox).
// Vyžaduje nastavené přihlašovací údaje ISDS (ISDS_LOGIN/ISDS_PASSWORD nebo v nastavení).
// Bez nich vrací available:false, configured:false (nikdy nefabrikuje ID).
router.get('/databox', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný údaj." });
    }
    try {
        const result = await findDataBox(ico);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Dotaz do ISDS selhal: ${err.message}` });
    }
});

// GET /api/registries/isds-status — zda je ISDS nakonfigurováno (bez odhalení hesla).
router.get('/isds-status', (req, res) => {
    res.json({ configured: isIsdsConfigured() });
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
