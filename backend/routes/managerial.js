/**
 * routes/managerial.js — manažerská data: ziskovost, rozpočty, kapacity,
 * nastavení sazeb a ceník odměn.
 * Montuje se v server.js na /api/managerial.
 */
'use strict';

const express = require('express');
const router = express.Router();
const ManagerialIntelligence = require('../lib/managerial');

// GET /api/managerial/profitability - Get profitability report
router.get('/profitability', (req, res) => {
    try {
        const report = ManagerialIntelligence.getProfitabilityReport();
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst ziskovost: ${err.message}` });
    }
});

// POST /api/managerial/budgets - Set budget limits for document
router.post('/budgets', (req, res) => {
    const { documentName, budgetType, limitHours, hourlyRate } = req.body;
    if (!documentName) {
        return res.status(400).json({ error: "Název dokumentu (documentName) je povinný." });
    }
    try {
        const budget = ManagerialIntelligence.setBudget({ documentName, budgetType, limitHours, hourlyRate });
        res.json({ success: true, budget });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit rozpočet: ${err.message}` });
    }
});

// GET /api/managerial/capacity - Get allocation and lawyer capacities workload
router.get('/capacity', (req, res) => {
    try {
        const allocation = ManagerialIntelligence.getCapacityAllocation();
        res.json({ success: true, allocation });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst vytížení týmu: ${err.message}` });
    }
});

// GET /api/managerial/settings - Get office billing/hourly rate settings
router.get('/settings', (req, res) => {
    try {
        const settings = ManagerialIntelligence.getOfficeSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst nastavení sazeb: ${err.message}` });
    }
});

// POST /api/managerial/settings - Update office billing/hourly rate settings
router.post('/settings', (req, res) => {
    try {
        const result = ManagerialIntelligence.updateOfficeSettings(req.body);
        res.json({ success: true, settings: result });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit nastavení sazeb: ${err.message}` });
    }
});

// GET /api/managerial/fees - Retrieve all fee items
router.get('/fees', (req, res) => {
    try {
        const fees = ManagerialIntelligence.getFees();
        res.json({ success: true, fees });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst ceník odměn: ${err.message}` });
    }
});

// POST /api/managerial/fees - Create or update a fee item
router.post('/fees', (req, res) => {
    try {
        const fee = ManagerialIntelligence.saveFee(req.body);
        res.json({ success: true, fee });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit položku ceníku: ${err.message}` });
    }
});

// DELETE /api/managerial/fees/:id - Delete a fee item
router.delete('/fees/:id', (req, res) => {
    const { id } = req.params;
    try {
        const deleted = ManagerialIntelligence.deleteFee(id);
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: `Nelze smazat položku ceníku: ${err.message}` });
    }
});

module.exports = router;
