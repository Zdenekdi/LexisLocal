/**
 * routes/campaigns.js — hromadné obesílání: validace příjemců (lustrace + odvození
 * SIMULOVANÉHO ISDS ID) a simulované odeslání s hlídáním doručenek a lhůt.
 * Montuje se v server.js na /api/campaigns.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { WATCH_DIR } = require('../lib/config');
const { checkSubject } = require('../lib/registries');
const { logEvent } = require('../lib/audit');
const db = require('../lib/database');
const { sanitizeFileName } = require('../lib/pathsafe');

// POST /api/campaigns/validate-recipients - Validate a list of ICOs
router.post('/validate-recipients', async (req, res) => {
    const { icos } = req.body;
    if (!icos || !Array.isArray(icos)) {
        return res.status(400).json({ error: "Parametr 'icos' musí být pole." });
    }

    try {
        const results = await Promise.all(icos.map(async (ico) => {
            const cleanIco = ico.replace(/\s+/g, '').replace(/[^0-9]/g, '').trim();
            if (!cleanIco || cleanIco.length !== 8) {
                return { ico, error: "Neplatný formát IČO (musí mít 8 číslic)." };
            }
            try {
                const checked = await checkSubject(cleanIco);
                if (checked.error) {
                    return { ico: cleanIco, error: checked.error };
                }
                // POZOR: toto NENÍ reálné ISDS ID — je odvozené z IČO jako placeholder.
                // isdsSimulated:true označuje, že datovou schránku je nutné před
                // odesláním ověřit v oficiálním registru (nesmí se doručovat naslepo).
                const cleanName = checked.name.toLowerCase();
                let isdsId = "";
                if (cleanName.includes("banka") || cleanName.includes("spořitelna")) {
                    isdsId = `b${cleanIco.substring(0, 6)}`;
                } else if (cleanName.includes("exekut")) {
                    isdsId = `e${cleanIco.substring(0, 6)}`;
                } else {
                    isdsId = `d${cleanIco.substring(0, 6)}`;
                }
                return {
                    ...checked,
                    isdsId,
                    isdsSimulated: true
                };
            } catch (err) {
                return { ico: cleanIco, error: err.message };
            }
        }));
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: `Chyba při hromadné lustraci: ${err.message}` });
    }
});

// POST /api/campaigns/send - Mock sending data messages and schedule calendar reminders
router.post('/send', async (req, res) => {
    const { clientName, caseNumber, recipients } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: "Příjemci jsou povinní." });
    }

    try {
        const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
        if (!fs.existsSync(CALENDAR_DIR)) {
            fs.mkdirSync(CALENDAR_DIR, { recursive: true });
        }

        const results = [];

        for (const recipient of recipients) {
            const { ico, name, isdsId, text } = recipient;

            // 1. Log simulation in audit
            logEvent('LexisEditor', `Hromadné obesílání - Odesláno přes ISDS`, 'Datová zpráva', {
                klient: clientName,
                spis: caseNumber,
                prijemce: name,
                ico: ico,
                isdsId: isdsId,
                status: 'Odesláno (Simulace)',
                textLength: text ? text.length : 0
            });

            // 2. Add alert in local database for tracking (10 days from now)
            const deadlineDate = new Date();
            deadlineDate.setDate(deadlineDate.getDate() + 10);

            const alertTitle = `Sledování doručenky výzvy pro: ${name}`;
            const alertDetails = `Hromadná kampaň obesílání pro klienta ${clientName || 'Neznámý'} (Spis: ${caseNumber || 'Neznámý'}). Příjemce: ${name} (IČO: ${ico}, Datová schránka: ${isdsId}).`;

            const alert = db.insert('alerts', {
                title: alertTitle,
                triggerRule: "Hromadné obesílání",
                status: 'pending',
                deadline: deadlineDate.toISOString(),
                payloadDetails: JSON.stringify({
                    clientName,
                    caseNumber,
                    ico,
                    name,
                    isdsId
                })
            });

            // 3. Generate ICS calendar file in Kalendar directory
            const cleanId = 'camp_dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const startDate = deadlineDate.toISOString().split('T')[0].replace(/-/g, '');

            const endD = new Date(deadlineDate);
            endD.setDate(endD.getDate() + 1);
            const endDate = endD.toISOString().split('T')[0].replace(/-/g, '');

            const cleanTitle = `⚠️ LHŮTA: ${alertTitle}`;

            const icsContent = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//LexisLocal//NONSGML iCalendar Generator//CS',
                'CALSCALE:GREGORIAN',
                'BEGIN:VEVENT',
                `UID:${cleanId}@lexislocal`,
                `DTSTAMP:${dtstamp}`,
                `DTSTART;VALUE=DATE:${startDate}`,
                `DTEND;VALUE=DATE:${endDate}`,
                `SUMMARY:${cleanTitle}`,
                `DESCRIPTION:${alertDetails}`,
                'BEGIN:VALARM',
                'TRIGGER:-P1D', // Alert 1 day before
                'ACTION:DISPLAY',
                'DESCRIPTION:Připomenutí blížící se lhůty Lexis',
                'END:VALARM',
                'END:VEVENT',
                'END:VCALENDAR'
            ].join('\r\n');

            const safeName = sanitizeFileName(alertTitle);
            const filePath = path.join(CALENDAR_DIR, `${safeName}.ics`);
            await fs.promises.writeFile(filePath, icsContent, 'utf-8');

            results.push({
                ico,
                name,
                isdsId,
                status: 'Simulováno (neodesláno)',
                simulated: true,
                alertId: alert.id,
                calendarFile: filePath
            });
        }

        res.json({
            success: true,
            simulated: true,
            results,
            message: `SIMULACE hromadného obesílání: ${results.length} zpráv NEBYLO reálně odesláno (chybí napojení na ISDS). Vytvořeny záznamy do logu, hlídání doručenek a kalendářní lhůty.`
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při hromadném odesílání: ${err.message}` });
    }
});

module.exports = router;
