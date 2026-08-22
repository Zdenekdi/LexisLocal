/**
 * calendarBooking.js — JEDNO fail-closed místo pro sběr událostí a rezervaci schůzky.
 * Sdílené mezi routes/calendar.js (ruční rezervace) a routes/email.js (rezervace z e-mailu).
 *
 * collectAllEvents() → sjednocený seznam událostí (lhůty + jednání + schůzky).
 * tryBook(req)       → { booked, meeting?, conflicts?, suggestions?, reason }.
 *                      Rezervuje JEN když je volno (s ohledem na dopravu); jinak booked:false.
 */
'use strict';

const db = require('./database');
const { WATCH_DIR } = require('./config');
const HearingsWatcher = require('./hearings');
const availability = require('./calendarAvailability');
const { logEvent } = require('./audit');

function collectAllEvents() {
    const events = [];
    (db.get('alerts') || []).forEach(a => {
        let date = null, time = null;
        if (a.deadline) { const p = String(a.deadline).split('T'); date = p[0]; if (p[1]) time = p[1].substring(0, 5); }
        events.push({ id: a.id, type: 'deadline', title: a.title, date, time, status: a.status, location: '' });
    });
    (HearingsWatcher.loadMonitoredHearings(WATCH_DIR) || []).forEach(h => {
        events.push({ id: h.id, type: 'hearing', title: h.title, date: h.dueDate, time: h.time || '', status: h.status, location: h.location || '' });
    });
    (db.get('meetings') || []).forEach(m => {
        events.push({ id: m.id, type: 'meeting', title: m.title, date: m.date, time: m.time || '', durationMin: m.durationMin || null, status: m.status || 'scheduled', location: m.location || '' });
    });
    return events;
}

// Pokus o rezervaci. Vrací booked:true + meeting, nebo booked:false + conflicts/suggestions.
// source: 'manual' | 'email' (jen pro audit).
function tryBook(input) {
    const b = input || {};
    if (!b.title || !b.date || !b.time) {
        return { booked: false, reason: 'missing-fields' };
    }
    const durationMin = Number.isFinite(b.durationMin) ? b.durationMin : 60;
    const opts = {};
    if (Number.isFinite(b.travelBufferMin)) opts.travelBufferMin = b.travelBufferMin;
    const startMin = availability._toMin(b.time);
    const events = collectAllEvents();
    const check = availability.checkSlot(events, b.date, startMin, durationMin, opts);
    if (!check.free) {
        const suggestions = availability.findFreeSlots(events, b.date, durationMin, opts).slice(0, 8);
        logEvent('Kalendář', 'Rezervace ZAMÍTNUTA — kolize/mimo hodiny', b.title, { date: b.date, time: b.time, source: b.source || 'manual', conflicts: check.conflicts.length });
        return { booked: false, reason: check.withinHours ? 'conflict' : 'out-of-hours', check, suggestions };
    }
    const meeting = db.insert('meetings', {
        title: String(b.title), date: b.date, time: b.time, durationMin,
        location: b.location || '', description: b.description || '', spisId: b.spisId || null,
        travelBufferMin: check.travelBufferMin, status: 'scheduled', source: b.source || 'manual',
        bookedAt: new Date().toISOString()
    });
    logEvent('Kalendář', 'Rezervace schůzky', b.title, { id: meeting.id, date: b.date, time: b.time, durationMin, source: b.source || 'manual', spisId: b.spisId || null });
    if (b.spisId) {
        try { require('./spisy').addEvent(b.spisId, 'schuzka', `Rezervována schůzka „${b.title}" na ${b.date} ${b.time} (${durationMin} min).`, { location: b.location || null }); } catch (e) {}
    }
    return { booked: true, meeting, check };
}

module.exports = { collectAllEvents, tryBook };
