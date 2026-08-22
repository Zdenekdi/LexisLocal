/**
 * routes/registries.js — rozšířená lustrace (ARES + ISIR reálné; CEE + Katastr přes
 * konfigurované placené API, jinak „není k dispozici" — žádná fingovaná data).
 * Montuje se v server.js na /api/registries.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const { checkSubject, checkCee, checkKatastr, findDataBox, checkAresStatutory, checkVatReliability, getRegistryConfig, setRegistryConfig } = require('../lib/registries');
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

// GET /api/registries/config — vrátí URL a příznak hasKey (klíč se nikdy nevrací celý).
router.get('/config', (req, res) => {
    try { res.json({ success: true, config: getRegistryConfig() }); }
    catch (err) { res.status(500).json({ error: `Nelze načíst konfiguraci registrů: ${err.message}` }); }
});

// POST /api/registries/config — uloží URL a (volitelně) klíče CEE/Katastr.
// Body: { cee:{url,key}, katastr:{url,key} }  (prázdný key = ponech stávající)
router.post('/config', (req, res) => {
    try { res.json({ success: true, config: setRegistryConfig(req.body || {}) }); }
    catch (err) { res.status(500).json({ error: `Nelze uložit konfiguraci registrů: ${err.message}` }); }
});

// GET /api/registries/statutory?ico=... — členové statutárního orgánu z ARES VR
router.get('/statutory', async (req, res) => {
    const { ico } = req.query;
    if (!ico) return res.status(400).json({ error: 'IČO je povinný údaj.' });
    try { res.json(await checkAresStatutory(ico)); }
    catch (err) { res.status(500).json({ error: 'Dotaz na statutární orgán selhal: ' + err.message }); }
});

// GET /api/registries/databox?ico=... — vyhledání datové schránky (ISDS), fail-closed
router.get('/databox', async (req, res) => {
    const { ico } = req.query;
    if (!ico) return res.status(400).json({ error: 'IČO je povinný údaj.' });
    try { res.json(await findDataBox(ico)); }
    catch (err) { res.status(500).json({ error: 'Vyhledání datové schránky selhalo: ' + err.message }); }
});

// GET /api/registries/vat?dic=... — registr plátců DPH / nespolehlivý plátce (MFČR)
router.get('/vat', async (req, res) => {
    const dic = req.query.dic || req.query.ico;
    if (!dic) return res.status(400).json({ error: 'DIČ (nebo IČO) je povinné.' });
    try { res.json(await checkVatReliability(dic)); }
    catch (err) { res.status(500).json({ error: 'Kontrola DPH selhala: ' + err.message }); }
});

module.exports = router;
