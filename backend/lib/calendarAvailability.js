/**
 * calendarAvailability.js — DETERMINISTICKÝ engine dostupnosti kalendáře.
 *
 * Žádná AI: rozhodnutí „vejde se schůzka?" dělá čistá funkce, ne model
 * (model je nedůvěryhodný na počítání času). Sekretářka může NAVRHNOUT termín,
 * ale o tom, zda je volno, rozhoduje tento engine.
 *
 * Klíčové vlastnosti:
 *   • bere v úvahu DOPRAVU/rezervu (travelBufferMin) před i po schůzce,
 *   • blokují jen ČASOVANÉ události; celodenní (bez času) neblokují sloty,
 *   • pracovní hodiny omezují návrhy volných termínů,
 *   • FAIL-CLOSED: neplatný vstup → považuje se za nedostupné (nenavrhne).
 */
'use strict';

// Výchozí předpoklady (lze přepsat v opts).
const DEFAULTS = {
    workStartMin: 8 * 60,   // 08:00
    workEndMin: 18 * 60,    // 18:00
    travelBufferMin: 30,    // rezerva na dopravu před i po
    stepMin: 15,            // granularita hledání volných slotů
    defaultDurationMin: 60, // schůzka bez délky
    hearingDurationMin: 120,// soudní jednání bez délky
    deadlineDurationMin: 30 // časovaná lhůta bez délky
};

function _toMin(hhmm) {
    if (typeof hhmm !== 'string') return null;
    const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
}
function _fmt(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Z událostí (tvar z /api/calendar/events) sestaví BUSY okna pro daný den.
// Vrací seřazený seznam { startMin, endMin, title, type }. Bez času / jiný den → ignor.
function collectBusy(events, date, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const busy = [];
    (events || []).forEach(ev => {
        if (!ev || ev.date !== date) return;
        const startMin = _toMin(ev.time);
        if (startMin == null) return; // celodenní / bez času neblokuje konkrétní slot
        let dur = o.defaultDurationMin;
        if (ev.durationMin && Number.isFinite(ev.durationMin)) dur = ev.durationMin;
        else if (ev.type === 'hearing') dur = o.hearingDurationMin;
        else if (ev.type === 'deadline') dur = o.deadlineDurationMin;
        busy.push({ startMin, endMin: startMin + dur, title: ev.title || '', type: ev.type || 'event' });
    });
    busy.sort((a, b) => a.startMin - b.startMin);
    return busy;
}

// Vejde se [startMin, startMin+durationMin] s rezervou bufferMin před i po,
// aniž by koliduje s BUSY okny? Vrací { free, conflicts: [...] }.
function checkSlot(events, date, startMin, durationMin, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (startMin == null || !Number.isFinite(durationMin) || durationMin <= 0) {
        return { free: false, reason: 'invalid-input', conflicts: [] };
    }
    const buffer = Number.isFinite(o.travelBufferMin) ? o.travelBufferMin : DEFAULTS.travelBufferMin;
    const endMin = startMin + durationMin;
    // Kandidát rozšířený o dopravu na obě strany.
    const candStart = startMin - buffer;
    const candEnd = endMin + buffer;
    const busy = collectBusy(events, date, o);
    const conflicts = busy.filter(b => candStart < b.endMin && b.startMin < candEnd)
        .map(b => ({ title: b.title, type: b.type, from: _fmt(b.startMin), to: _fmt(b.endMin) }));
    // Musí se vejít i do pracovních hodin (samotná schůzka, ne buffer).
    const withinHours = startMin >= o.workStartMin && endMin <= o.workEndMin;
    return {
        free: conflicts.length === 0 && withinHours,
        withinHours,
        start: _fmt(startMin),
        end: _fmt(endMin),
        travelBufferMin: buffer,
        conflicts
    };
}

// Najde volné termíny (začátky) pro schůzku dané délky v daném dni.
// Vrací [{ start, end }] seřazené; respektuje pracovní hodiny, dopravu, krok.
function findFreeSlots(events, date, durationMin, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (!Number.isFinite(durationMin) || durationMin <= 0) return [];
    const slots = [];
    const last = o.workEndMin - durationMin;
    for (let s = o.workStartMin; s <= last; s += o.stepMin) {
        const r = checkSlot(events, date, s, durationMin, o);
        if (r.free) slots.push({ start: r.start, end: r.end });
    }
    return slots;
}

module.exports = { collectBusy, checkSlot, findFreeSlots, _toMin, _fmt, DEFAULTS };
