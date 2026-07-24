/**
 * routes/watcher.js — přepínání sledování složky se spisy.
 * Montuje se v server.js na /api/watcher.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { setWatcherState } = require('../lib/watcher');

// POST /api/watcher/toggle - Toggle dynamic Desktop Spisy folder watching activity state
router.post('/toggle', (req, res) => {
    const { active } = req.query;
    const isActive = active === 'true';
    setWatcherState(isActive);
    res.json({ success: true, active: isActive });
});

module.exports = router;
