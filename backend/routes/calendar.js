/**
 * routes/calendar.js — generování .ics událostí, přehled událostí a
 * synchronizace sledovaných soudních jednání.
 * Montuje se v server.js na /api/calendar.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { WATCH_DIR } = require('../lib/config');
const { sanitizeFileName } = require('../lib/pathsafe');
const { writeToSystemCalendar } = require('../lib/calendar');
const HearingsWatcher = require('../lib/hearings');
const db = require('../lib/database');

// POST /api/calendar/add - Generate standard .ics file inside LexisSpisy/Kalendar folder
router.post('/add', async (req, res) => {
    const { id, title, dueDate, context, time, location, isHearing, courtCode, spisovaZnacka } = req.body;
    if (!title || !dueDate) {
        return res.status(400).json({ error: "Název a datum splatnosti jsou povinné parametry." });
    }

    try {
        const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
        if (!fs.existsSync(CALENDAR_DIR)) {
            fs.mkdirSync(CALENDAR_DIR, { recursive: true });
        }

        const cleanId = id || 'dl_' + Date.now();
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const startDate = dueDate.replace(/-/g, '');

        let startLine, endLine;
        if (time) {
            const timeClean = time.replace(/:/g, '').substring(0, 4) + '00';
            startLine = `DTSTART;TZID=Europe/Prague:${startDate}T${timeClean}`;

            // Assume 1 hour
            const [h, m] = time.split(':');
            const startD = new Date(`${dueDate}T${h}:${m}:00`);
            const endD = new Date(startD.getTime() + 60 * 60 * 1000);
            const endDateStr = endD.toISOString().split('T')[0].replace(/-/g, '');
            const endTimeClean = endD.toTimeString().split(' ')[0].replace(/:/g, '');
            endLine = `DTEND;TZID=Europe/Prague:${endDateStr}T${endTimeClean}`;
        } else {
            startLine = `DTSTART;VALUE=DATE:${startDate}`;
            const endD = new Date(dueDate);
            endD.setDate(endD.getDate() + 1);
            const endDateStr = endD.toISOString().split('T')[0].replace(/-/g, '');
            endLine = `DTEND;VALUE=DATE:${endDateStr}`;
        }

        const prefix = isHearing ? '⚖️ JEDNÁNÍ' : '⚠️ LHŮTA';
        const cleanTitle = `${prefix}: ${title}`;
        const cleanDesc = context ? context.replace(/\r?\n/g, ' ') : `Detekovaná událost v systému Lexis.`;

        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//LexisLocal//NONSGML iCalendar Generator//CS',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${cleanId}@lexislocal`,
            `DTSTAMP:${dtstamp}`,
            startLine,
            endLine,
            `SUMMARY:${cleanTitle}`,
            `DESCRIPTION:${cleanDesc}`
        ];

        if (location) {
            lines.push(`LOCATION:${location}`);
        }

        lines.push('END:VEVENT');
        lines.push('END:VCALENDAR');

        const icsContent = lines.join('\r\n');

        const safeName = sanitizeFileName(title);
        const filePath = path.join(CALENDAR_DIR, `${safeName}.ics`);

        await fs.promises.writeFile(filePath, icsContent, 'utf-8');
        console.log(`📅 ICS Kalendářová událost vygenerována: ${filePath}`);

        // Write directly to local system calendar (Apple Calendar / Outlook)
        let syncStatus = 'unsupported';
        try {
            syncStatus = await writeToSystemCalendar({
                title: cleanTitle,
                date: dueDate,
                time: time,
                location: location,
                description: cleanDesc
            });
        } catch (syncErr) {
            console.error(`⚠️ Nepodařilo se zapsat do systémového kalendáře: ${syncErr.message}`);
        }

        // Register the hearing for background tracking if isHearing is true
        if (isHearing && courtCode && spisovaZnacka) {
            const hearings = HearingsWatcher.loadMonitoredHearings(WATCH_DIR);

            // Remove any existing record with the same ID or same sp.zn + date
            const filtered = hearings.filter(h => h.id !== cleanId && !(h.courtCode === courtCode && h.dueDate === dueDate && h.spisovaZnacka.cisloSenatu === spisovaZnacka.cisloSenatu && h.spisovaZnacka.druhVeci === spisovaZnacka.druhVeci && h.spisovaZnacka.bcVec === spisovaZnacka.bcVec && h.spisovaZnacka.rocnik === spisovaZnacka.rocnik));

            filtered.push({
                id: cleanId,
                title: title,
                dueDate: dueDate,
                time: time,
                location: location,
                courtCode: courtCode,
                courtName: location ? location.split(',')[0] : 'Soud',
                spisovaZnacka: spisovaZnacka,
                icsFilePath: filePath,
                status: 'scheduled',
                lastChecked: new Date().toISOString()
            });

            HearingsWatcher.saveMonitoredHearings(WATCH_DIR, filtered);
            console.log(`⚖️ Registrováno soudní jednání pro sledování změn: sp. zn. ${spisovaZnacka.cisloSenatu} ${spisovaZnacka.druhVeci} ${spisovaZnacka.bcVec}/${spisovaZnacka.rocnik}`);
        }

        res.json({ success: true, filePath, syncStatus, message: "ICS soubor byl úspěšně vygenerován a synchronizován do kalendáře." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `Chyba při generování ICS kalendáře: ${err.message}` });
    }
});

// GET /api/calendar/events - Retrieve all events (deadlines & hearings) for dashboard calendar
router.get('/events', async (req, res) => {
    try {
        const alerts = db.get('alerts') || [];
        const hearings = HearingsWatcher.loadMonitoredHearings(WATCH_DIR) || [];

        const events = [];

        // Add alerts (procedural tasks/deadlines)
        alerts.forEach(alert => {
            let dateVal = null;
            let timeVal = null;
            if (alert.deadline) {
                const parts = alert.deadline.split('T');
                dateVal = parts[0];
                if (parts[1]) {
                    timeVal = parts[1].substring(0, 5); // HH:MM
                }
            }
            events.push({
                id: alert.id,
                type: 'deadline',
                title: alert.title,
                date: dateVal,
                time: timeVal,
                status: alert.status,
                description: alert.triggerRule || 'Procesní lhůta',
                location: ''
            });
        });

        // Add monitored hearings
        hearings.forEach(hearing => {
            events.push({
                id: hearing.id,
                type: 'hearing',
                title: hearing.title,
                date: hearing.dueDate,
                time: hearing.time || '',
                status: hearing.status,
                description: `Soudní jednání - sp. zn. ${hearing.spisovaZnacka ? (hearing.spisovaZnacka.cisloSenatu + ' ' + hearing.spisovaZnacka.druhVeci + ' ' + hearing.spisovaZnacka.bcVec + '/' + hearing.spisovaZnacka.rocnik) : ''}`,
                location: hearing.location || ''
            });
        });

        res.json({ success: true, events });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst kalendářní události: ${err.message}` });
    }
});

// POST /api/calendar/sync - Manually trigger check of all monitored hearings
router.post('/sync', async (req, res) => {
    try {
        const result = await HearingsWatcher.checkAllHearings(WATCH_DIR);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: `Chyba při synchronizaci jednání: ${err.message}` });
    }
});

module.exports = router;
