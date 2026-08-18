/**
 * LexisLocal — Skartační / archivační režim (spisová služba).
 *
 * Staví na životním cyklu spisu ze `spisy.js` (aktivni → archiv → skartace).
 * Tento modul poskytuje:
 *   • skartační NÁVRH — archivované spisy, jimž uplynula retenční lhůta,
 *   • skartační PROTOKOL — doklad o tom, co bylo navrženo ke skartaci.
 *
 * BEZPEČNOST: nic se nikdy nemaže automaticky. Modul jen NAVRHUJE a dokumentuje;
 * skutečné odstranění spisové hlavičky je vědomý úkon (spisy.deleteSpis, jen ve
 * stavu „skartace"). Dokumenty v inboxu zůstávají nedotčené.
 */
'use strict';

const db = require('./database');
const spisy = require('./spisy');

function _today() {
    return new Date().toISOString().split('T')[0];
}

// Archivované spisy (stav = archiv).
function listArchiv() {
    return (spisy.listSpisy() || []).filter(s => s.stav === 'archiv');
}

/**
 * Skartační návrh k datu `today`:
 *   • expired    — archivované spisy s uplynulou retencí (retentionUntil <= dnes),
 *   • retained   — archivované spisy, u nichž retence ještě běží,
 *   • inSkartace — spisy již převedené do stavu „skartace" (čekají na vědomé smazání).
 */
function getSkartaceNavrh(today) {
    const todayStr = today || _today();
    const archiv = listArchiv();
    const expired = [];
    const retained = [];
    archiv.forEach(s => {
        if (s.retentionUntil && s.retentionUntil <= todayStr) expired.push(s);
        else retained.push(s);
    });
    const inSkartace = (spisy.listSpisy() || []).filter(s => s.stav === 'skartace');
    return {
        today: todayStr,
        expired: expired,
        retained: retained,
        inSkartace: inSkartace,
        summary: { expired: expired.length, retained: retained.length, inSkartace: inSkartace.length }
    };
}

/**
 * Sestaví skartační protokol pro zadané spisy (dle id). Pouze dokument — NEMAŽE.
 * Vrací strukturu vhodnou k tisku/exportu i uloženou do kolekce `skartace_protokoly`.
 */
function buildProtokol(spisIds, meta) {
    const ids = Array.isArray(spisIds) ? spisIds : [];
    const all = spisy.listSpisy() || [];
    const polozky = ids
        .map(id => all.find(s => s.id === id))
        .filter(Boolean)
        .map(s => ({
            id: s.id,
            spisZn: s.spisZn,
            klient: s.klient || '',
            agenda: s.agenda || '',
            archivedAt: s.archivedAt || null,
            retentionUntil: s.retentionUntil || null,
            stav: s.stav
        }));

    if (polozky.length === 0) {
        throw new Error('Skartační protokol musí obsahovat alespoň jeden existující spis.');
    }

    const protokol = db.insert('skartace_protokoly', {
        polozky: polozky,
        pocet: polozky.length,
        zpracoval: meta && meta.zpracoval ? String(meta.zpracoval) : '',
        poznamka: meta && meta.poznamka ? String(meta.poznamka) : '',
        note: 'Protokol je pouze dokladem návrhu ke skartaci. Samotné vyřazení/skartace spisů je nutné provést vědomě podle stavovských předpisů ČAK.'
    });

    // Zaznamenat úkon do deníku každého dotčeného spisu (nemaže je).
    polozky.forEach(p => spisy.addEvent(p.id, 'skartace', `Zařazen do skartačního protokolu ${protokol.id}.`));
    return protokol;
}

function listProtokoly() {
    return db.get('skartace_protokoly') || [];
}

module.exports = { listArchiv, getSkartaceNavrh, buildProtokol, listProtokoly };
