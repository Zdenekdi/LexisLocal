/**
 * routes/fakturace.js — fakturace / vyúčtování.
 * Montuje se v server.js na /api/fakturace.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fakturace = require('../lib/fakturace');
const { logEvent } = require('../lib/audit');

// GET /api/fakturace — seznam faktur; filtr ?status=unpaid&spisId=
router.get('/', (req, res) => {
    try {
        res.json({ invoices: fakturace.listInvoices({ status: req.query.status, spisId: req.query.spisId }) });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načtení faktur: ${err.message}` });
    }
});

// GET /api/fakturace/outstanding — přehled neuhrazených + dlužná částka
router.get('/outstanding', (req, res) => {
    try {
        res.json(fakturace.getOutstanding());
    } catch (err) {
        res.status(500).json({ error: `Chyba při výpočtu neuhrazených: ${err.message}` });
    }
});

// POST /api/fakturace/from-spis — faktura ze spisu { spisId, rate, items, dphRate, zaloha }
router.post('/from-spis', (req, res) => {
    try {
        const body = req.body || {};
        const invoice = fakturace.createInvoiceFromSpis(body.spisId, body);
        logEvent('Fakturace', 'Vystavení faktury ze spisu', invoice.variabilniSymbol, { spisId: invoice.spisId, toPay: invoice.toPay });
        res.status(201).json({ invoice });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/fakturace — faktura z ručních položek { items, klient, dphRate, zaloha }
router.post('/', (req, res) => {
    try {
        const invoice = fakturace.createInvoice(req.body || {});
        logEvent('Fakturace', 'Vystavení faktury', invoice.variabilniSymbol, { toPay: invoice.toPay });
        res.status(201).json({ invoice });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/fakturace/:id/paid — zaznamená úhradu { amount }
router.post('/:id/paid', (req, res) => {
    try {
        const updated = fakturace.markPaid(req.params.id, req.body && req.body.amount);
        logEvent('Fakturace', 'Úhrada faktury', updated.variabilniSymbol, { status: updated.status });
        res.json({ invoice: updated });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
