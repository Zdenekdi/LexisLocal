/**
 * routes/activity.js — time-tracking (heartbeat, ruční úkony, denní výkazy).
 * Montuje se v server.js na /api/activity.
 */
'use strict';

const express = require('express');
const router = express.Router();
const TimeTracker = require('../lib/timetracking');
const WorkflowEngine = require('../lib/workflow');
const db = require('../lib/database');
const { logEvent } = require('../lib/audit');

// POST /api/activity/log - Log active heartbeat from LexisEditor (supports /api/activity/heartbeat alias)
router.post(['/log', '/heartbeat'], (req, res) => {
    const { documentName, activeSeconds, actionType } = req.body;
    try {
        const entry = TimeTracker.logActivity(documentName, activeSeconds, actionType);

        // Trigger workflow event asynchronously
        WorkflowEngine.triggerEvent('document_saved', { documentName: documentName || "", actionType: actionType || "edit" })
            .catch(err => console.error("⚠️ Asynchronní workflow trigger selhal:", err.message));

        res.json({ success: true, entry });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit aktivitu: ${err.message}` });
    }
});

// POST /api/activity/custom - Add manual custom time-tracking entry
router.post('/custom', (req, res) => {
    const { documentName, hours, actionType, date } = req.body;
    if (!documentName || !hours || !date) {
        return res.status(400).json({ error: "Spis, počet hodin a datum jsou povinné parametry." });
    }
    try {
        const activeSeconds = parseFloat(hours) * 3600;
        const isoDate = new Date(date).toISOString();
        const entry = TimeTracker.logActivity(documentName, activeSeconds, actionType || 'write', isoDate);
        res.json({ success: true, entry });
    } catch (err) {
        res.status(500).json({ error: `Nelze zapsat ruční úkon: ${err.message}` });
    }
});

// GET /api/activity/today - Get aggregated activities for today
router.get('/today', (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const rawLogs = TimeTracker.getDailyActivities(todayStr);
        const aggregated = TimeTracker.aggregateActivities(rawLogs);
        res.json({ success: true, date: todayStr, rawLogsCount: rawLogs.length, aggregated });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst dnešní aktivity: ${err.message}` });
    }
});

// POST /api/activity/timesheet - Generate daily timesheet report
router.post('/timesheet', async (req, res) => {
    const { date, model } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const selectedModel = model || "llama3";

    try {
        const result = await TimeTracker.generateDailyTimesheet(targetDate, selectedModel);

        if (result.success) {
            logEvent('LexisEditor', 'Time-tracking', `Generován timesheet pro ${targetDate}`, {
                date: targetDate,
                model: selectedModel,
                totalHours: result.timesheet.totalHours
            });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Selhalo generování timesheetu: ${err.message}` });
    }
});

// GET /api/activity/timesheets - Retrieve all generated timesheets from encrypted database
router.get('/timesheets', (req, res) => {
    try {
        const timesheets = db.get('timesheets');
        res.json({ success: true, timesheets });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst výkazy práce: ${err.message}` });
    }
});

module.exports = router;
