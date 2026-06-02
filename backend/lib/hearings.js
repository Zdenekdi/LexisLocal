const path = require('path');
const fs = require('fs');

const HEARINGS_FILE = (WATCH_DIR) => path.join(WATCH_DIR, '.hearings.json');

function loadMonitoredHearings(WATCH_DIR) {
    const file = HEARINGS_FILE(WATCH_DIR);
    if (fs.existsSync(file)) {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (e) {
            console.error("⚠️ Nepodařilo se načíst .hearings.json:", e.message);
        }
    }
    return [];
}

function saveMonitoredHearings(WATCH_DIR, hearings) {
    try {
        fs.writeFileSync(HEARINGS_FILE(WATCH_DIR), JSON.stringify(hearings, null, 2), 'utf-8');
    } catch (e) {
        console.error("⚠️ Nepodařilo se uložit .hearings.json:", e.message);
    }
}

function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9_á-žÁ-Ž]/g, '_').substring(0, 100);
}

// Generate an ICS content helper
function generateIcs(id, title, dateStr, timeStr, location, context, isCancelled) {
    const cleanId = id || 'hearing_' + Date.now();
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const startDate = dateStr.replace(/-/g, '');
    
    let startLine, endLine;
    if (timeStr) {
        const timeClean = timeStr.replace(/:/g, '').substring(0, 4) + '00';
        startLine = `DTSTART;TZID=Europe/Prague:${startDate}T${timeClean}`;
        
        // Assume 1 hour
        const [h, m] = timeStr.split(':');
        const startD = new Date(`${dateStr}T${h}:${m}:00`);
        const endD = new Date(startD.getTime() + 60 * 60 * 1000);
        const endDateStr = endD.toISOString().split('T')[0].replace(/-/g, '');
        const endTimeClean = endD.toTimeString().split(' ')[0].replace(/:/g, '');
        endLine = `DTEND;TZID=Europe/Prague:${endDateStr}T${endTimeClean}`;
    } else {
        startLine = `DTSTART;VALUE=DATE:${startDate}`;
        const endD = new Date(dateStr);
        endD.setDate(endD.getDate() + 1);
        const endDateStr = endD.toISOString().split('T')[0].replace(/-/g, '');
        endLine = `DTEND;VALUE=DATE:${endDateStr}`;
    }
    
    let cleanTitle = title;
    if (isCancelled) {
        cleanTitle = `❌ ZRUŠENO: ${title}`;
    }
    
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
        `DESCRIPTION:${context ? context.replace(/\r?\n/g, ' ') : ''}`
    ];
    
    if (location) {
        lines.push(`LOCATION:${location}`);
    }
    
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');
    
    return lines.join('\r\n');
}

async function checkAllHearings(WATCH_DIR) {
    console.log("🚨 Hlídač soudních jednání: Spouštím kontrolu...");
    const hearings = loadMonitoredHearings(WATCH_DIR);
    if (hearings.length === 0) return { checked: 0, updated: 0 };
    
    let checked = 0;
    let updated = 0;
    
    for (const h of hearings) {
        if (h.status === 'cancelled' || h.status === 'past') continue;
        
        checked++;
        try {
            const hearingDate = new Date(h.dueDate);
            const today = new Date();
            today.setHours(0,0,0,0);
            
            // Difference in days
            const diffTime = hearingDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < -1) {
                // Hearing is in the past, stop monitoring
                h.status = 'past';
                continue;
            }
            
            if (diffDays > 30) {
                // Not in window yet
                continue;
            }
            
            // Query InfoJednání
            const queryParams = {
                druhOrganizace: h.courtCode.startsWith('OS') ? null : h.courtCode,
                okresniSoud: h.courtCode.startsWith('OS') ? h.courtCode : null,
                cisloSenatu: h.spisovaZnacka.cisloSenatu,
                druhVeci: h.spisovaZnacka.druhVeci,
                bcVec: h.spisovaZnacka.bcVec,
                rocnik: h.spisovaZnacka.rocnik,
                agenda: null,
                typHledani: "SPZN"
            };
            
            const response = await fetch('https://infojednani.gov.cz/api/v1/jednani/vyhledej', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(queryParams)
            });
            
            if (!response.ok) {
                console.error(`⚠️ Chyba InfoJednání API pro ${h.title}: ${response.status}`);
                continue;
            }
            
            const resData = await response.json();
            const udalosti = resData.udalosti || [];
            
            // Try to find the event on the same day/time
            let matchingEvent = null;
            
            // Convert DD.MM.YYYY to YYYY-MM-DD helper
            const toIsoDate = (dStr) => {
                const p = dStr.replace(/\s+/g, '').split('.');
                return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : dStr;
            };
            
            for (const ev of udalosti) {
                const evIso = toIsoDate(ev.datum);
                if (evIso === h.dueDate) {
                    matchingEvent = ev;
                    break;
                }
            }
            
            let shouldUpdateIcs = false;
            let isCancelled = false;
            let statusText = h.status;
            
            if (matchingEvent) {
                const isEvCancelled = matchingEvent.jednaciZruseno === 'Ano' || matchingEvent.jednaciZruseno === true;
                const newLocation = (resData.organizace || h.courtName) + ', síň ' + (matchingEvent.jednaciSin || '');
                
                if (isEvCancelled) {
                    isCancelled = true;
                    statusText = 'cancelled';
                    shouldUpdateIcs = true;
                    console.log(`⚖️ Hlídač jednání: DETEKOVÁNO ZRUŠENÍ JEDNÁNÍ u ${h.title}`);
                } else if (h.time !== matchingEvent.cas || h.location !== newLocation) {
                    h.time = matchingEvent.cas;
                    h.location = newLocation;
                    statusText = 'updated';
                    shouldUpdateIcs = true;
                    console.log(`⚖️ Hlídač jednání: DETEKOVÁNA ZMĚNA JEDNÁNÍ u ${h.title}`);
                }
            } else {
                // If there are events, but none on our day/time, it was rescheduled!
                if (udalosti.length > 0) {
                    const newEv = udalosti[0];
                    const newIso = toIsoDate(newEv.datum);
                    const isEvCancelled = newEv.jednaciZruseno === 'Ano' || newEv.jednaciZruseno === true;
                    
                    console.log(`⚖️ Hlídač jednání: DETEKOVÁNO PŘESUNUTÍ JEDNÁNÍ u ${h.title} na ${newIso} v ${newEv.cas}`);
                    
                    h.dueDate = newIso;
                    h.time = newEv.cas;
                    h.location = (resData.organizace || h.courtName) + ', síň ' + (newEv.jednaciSin || '');
                    statusText = 'updated';
                    isCancelled = isEvCancelled;
                    shouldUpdateIcs = true;
                } else {
                    // Empty list of events, and we are within 30 days => hearing is cancelled!
                    isCancelled = true;
                    statusText = 'cancelled';
                    shouldUpdateIcs = true;
                    console.log(`⚖️ Hlídač jednání: DETEKOVÁNO ZRUŠENÍ JEDNÁNÍ (odstraněno z kalendáře portálu) u ${h.title}`);
                }
            }
            
            if (shouldUpdateIcs) {
                h.status = statusText;
                
                const titleForIcs = isCancelled 
                    ? `❌ ZRUŠENO: ${h.title}` 
                    : (statusText === 'updated' ? `⚠️ PŘESUNUTO: ${h.title}` : h.title);
                
                const cleanDesc = `Soudní jednání u ${h.courtName}.\nSpisová značka: ${h.spisovaZnacka.cisloSenatu} ${h.spisovaZnacka.druhVeci} ${h.spisovaZnacka.bcVec}/${h.spisovaZnacka.rocnik}\nStav hlídače: ${statusText.toUpperCase()}`;
                
                const icsContent = generateIcs(h.id, titleForIcs, h.dueDate, h.time, h.location, cleanDesc, isCancelled);
                
                if (fs.existsSync(h.icsFilePath)) {
                    fs.writeFileSync(h.icsFilePath, icsContent, 'utf-8');
                } else {
                    const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
                    if (!fs.existsSync(CALENDAR_DIR)) fs.mkdirSync(CALENDAR_DIR, { recursive: true });
                    const safeName = sanitizeFileName(titleForIcs);
                    const newPath = path.join(CALENDAR_DIR, `${safeName}.ics`);
                    fs.writeFileSync(newPath, icsContent, 'utf-8');
                    h.icsFilePath = newPath;
                }
                
                updated++;
            }
            
        } catch (err) {
            console.error(`❌ Hlídač jednání: Chyba při kontrole ${h.title}:`, err.message);
        }
    }
    
    if (updated > 0) {
        saveMonitoredHearings(WATCH_DIR, hearings);
    }
    
    return { checked, updated };
}

module.exports = {
    loadMonitoredHearings,
    saveMonitoredHearings,
    checkAllHearings,
    generateIcs
};
