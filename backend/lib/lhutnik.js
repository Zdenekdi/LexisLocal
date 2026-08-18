/**
 * LexisLocal — Centrální LHŮTNÍK.
 *
 * Jeden přehled VŠECH lhůt napříč spisy/inboxem. Detekci lhůt (dny i jednotky)
 * dělá pipeline (watcher/paperless → extraction.js); tenhle modul je jen sbírá
 * z `inbox_files`, sjednocuje, počítá urgenci a umožňuje advokátovi POTVRDIT
 * nebo ODLOŽIT nejisté (needsReview) lhůty — nic se nefinalizuje bez potvrzení.
 *
 * Nedestruktivní vůči detekci: potvrzení/odložení jen doplní příznaky na
 * konkrétní položku `detectedDeadlines[]` daného souboru.
 */
'use strict';

const db = require('./database');
const spisy = require('./spisy');

function _today() {
    return new Date().toISOString().split('T')[0];
}
// Počet dní od dneška do data (YYYY-MM-DD); záporné = po termínu.
function _daysLeft(dateStr, todayStr) {
    if (!dateStr) return null;
    const a = new Date((todayStr || _today()) + 'T00:00:00');
    const b = new Date(dateStr + 'T00:00:00');
    if (isNaN(b.getTime())) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function _urgency(daysLeft, needsReview) {
    if (daysLeft === null) return 'unknown';
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= 3) return 'urgent';
    if (daysLeft <= 14) return 'soon';
    return 'ok';
}

// Poskládá plochý seznam lhůt ze všech dokumentů v inboxu.
function _collect(todayStr) {
    const files = db.get('inbox_files') || [];
    const spisIndex = {};
    (spisy.listSpisy() || []).forEach(s => { spisIndex[spisy._caseKey(s.spisZn)] = s; });

    const out = [];
    files.forEach(f => {
        const spis = spisIndex[spisy._caseKey(f.caseNumber)] || null;
        const base = {
            fileId: f.id,
            fileName: f.fileName || f.id,
            caseNumber: f.caseNumber || null,
            spisId: spis ? spis.id : null,
            klient: spis ? spis.klient : null
        };
        // Primární (denní) lhůta — potvrzená pipeline, needsReview=false.
        if (f.deadlineDate) {
            const dl = _daysLeft(f.deadlineDate, todayStr);
            out.push({
                ...base, index: -1, date: f.deadlineDate, unit: 'day', amount: f.deadlineDays || null,
                source: 'primary', needsReview: false, dismissed: false, confirmed: true,
                daysLeft: dl, urgency: _urgency(dl, false), context: f.summary || ''
            });
        }
        // Jednotkové/nejisté lhůty — s příznaky needsReview/confirmed/dismissed.
        (f.detectedDeadlines || []).forEach((d, i) => {
            if (d.dismissed) return; // odložené se v přehledu nezobrazují
            const dl = _daysLeft(d.deadlineDate, todayStr);
            const needsReview = d.needsReview !== false && d.confirmed !== true;
            out.push({
                ...base, index: i, date: d.deadlineDate || null, unit: d.unit, amount: d.amount,
                source: d.source || 'detected', needsReview: needsReview, dismissed: false,
                confirmed: d.confirmed === true, daysLeft: dl, urgency: _urgency(dl, needsReview),
                context: d.context || ''
            });
        });
    });
    // Seřadit: nejdřív podle data (bez data na konec), po termínu nahoru.
    out.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
    });
    return out;
}

/**
 * Vrátí přehled lhůt + souhrn. Volitelně filtr: { spisId, onlyReview, includeOverdue }.
 */
function getLhutnik(opts) {
    opts = opts || {};
    const todayStr = opts.today || _today();
    let items = _collect(todayStr);
    if (opts.spisId) items = items.filter(i => i.spisId === opts.spisId);
    if (opts.onlyReview) items = items.filter(i => i.needsReview);

    const summary = {
        total: items.length,
        overdue: items.filter(i => i.urgency === 'overdue').length,
        urgent: items.filter(i => i.urgency === 'urgent').length,
        soon: items.filter(i => i.urgency === 'soon').length,
        needsReview: items.filter(i => i.needsReview).length
    };
    return { today: todayStr, items, summary };
}

// Pomocná: uprav položku detectedDeadlines daného souboru a persistuj inbox_files.
function _mutateDetected(fileId, index, mutate) {
    const files = db.get('inbox_files') || [];
    const idx = files.findIndex(f => f.id === fileId);
    if (idx === -1) throw new Error('Dokument nenalezen.');
    const file = files[idx];
    const list = Array.isArray(file.detectedDeadlines) ? file.detectedDeadlines : [];
    if (index < 0 || index >= list.length) throw new Error('Lhůta nenalezena.');
    mutate(list[index], file);
    files[idx] = { ...file, detectedDeadlines: list };
    db.set('inbox_files', files);
    return { file: files[idx], deadline: list[index] };
}

// Potvrdí nejistou (needsReview) lhůtu → přejde mezi finální. Zaloguje úkon do spisu.
function confirmDeadline(fileId, index) {
    const { file, deadline } = _mutateDetected(fileId, index, (d) => {
        d.needsReview = false;
        d.confirmed = true;
        d.confirmedAt = new Date().toISOString();
    });
    const spis = spisy.findByCase(file.caseNumber);
    if (spis) spisy.addEvent(spis.id, 'lhuta', `Potvrzena lhůta ${deadline.amount} ${deadline.unit} → ${deadline.deadlineDate}.`);
    return deadline;
}

// Odloží/zamítne nejistou lhůtu (skryje z přehledu). Také zaloguje úkon.
function dismissDeadline(fileId, index) {
    const { file, deadline } = _mutateDetected(fileId, index, (d) => {
        d.dismissed = true;
        d.dismissedAt = new Date().toISOString();
    });
    const spis = spisy.findByCase(file.caseNumber);
    if (spis) spisy.addEvent(spis.id, 'lhuta', `Odložena/zamítnuta detekovaná lhůta (${deadline.amount} ${deadline.unit}).`);
    return deadline;
}

module.exports = { getLhutnik, confirmDeadline, dismissDeadline, _daysLeft, _urgency };
