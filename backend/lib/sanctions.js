/**
 * sanctions.js — screening jmen proti OFICIÁLNÍM konsolidovaným sankčním seznamům
 * (EU / OFAC / UN). Tyto seznamy jsou VEŘEJNÉ a zdarma stažitelné; sem se načtou
 * v normalizovaném tvaru z nakonfigurovaného souboru (LEXIS_SANCTIONS_FILE), který
 * se periodicky aktualizuje importérem (mimo tento modul).
 *
 * Zásady (shodné s aml.js):
 *   • FAIL-CLOSED: když seznam není načten, vrací available:false a AML dál
 *     nastaví needsManualScreening=true — NIKDY netvrdí „čisté".
 *   • Shoda POZITIVNÍ = silný signál (SANKCE). Absence shody NEznamená „čistý".
 *   • Konzervativní párování (omezuje false positives), ale radši nahlásí k ověření.
 *
 * Normalizovaný tvar seznamu (JSON): [{ name, aliases?:[], list?:'EU'|'OFAC'|'UN', program? }]
 */
'use strict';

const fs = require('fs');

function _deaccent(s) {
    return String(s == null ? '' : s)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

let _cache = null; // { loadedAt, source, entries:[...], norm:[{n, e}] }

function _configPath() { return process.env.LEXIS_SANCTIONS_FILE || ''; }

function _normalizeEntries(raw) {
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.entries) ? raw.entries : []);
    return arr.map(e => ({
        name: String(e.name || '').trim(),
        aliases: Array.isArray(e.aliases) ? e.aliases.map(a => String(a)) : [],
        list: e.list || e.source || 'sankce',
        program: e.program || null
    })).filter(e => e.name);
}

/** Načte seznam z opts.entries (přímo) nebo ze souboru (opts.file / LEXIS_SANCTIONS_FILE). */
function loadList(opts) {
    opts = opts || {};
    try {
        let raw;
        if (opts.entries) {
            raw = opts.entries;
        } else {
            const file = opts.file || _configPath();
            if (!file || !fs.existsSync(file)) {
                _cache = null;
                return { available: false, reason: 'Sankční seznam není nakonfigurován (LEXIS_SANCTIONS_FILE).' };
            }
            raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        const entries = _normalizeEntries(raw);
        const norm = [];
        for (const e of entries) {
            norm.push({ n: _deaccent(e.name), e });
            for (const a of e.aliases) { const na = _deaccent(a); if (na) norm.push({ n: na, e }); }
        }
        _cache = { loadedAt: new Date().toISOString(), source: opts.source || opts.file || _configPath() || 'inline', entries, norm };
        return { available: true, count: entries.length, source: _cache.source };
    } catch (err) {
        _cache = null;
        return { available: false, error: err.message };
    }
}

function isAvailable() {
    if (!_cache && _configPath()) loadList();
    return !!_cache;
}

/** Screening jména. Vrací { available, matches:[{name,list,program}], source }. */
function screenName(name) {
    if (!_cache && _configPath()) loadList();
    if (!_cache) return { available: false, matches: [], reason: 'Sankční seznam nenačten.' };
    const n = _deaccent(name);
    if (!n) return { available: true, matches: [] };
    const matches = [];
    const seen = new Set();
    for (const item of _cache.norm) {
        const b = item.n;
        if (!b) continue;
        // Konzervativní: přesná shoda, nebo podřetězec při dostatečné délce (>=6),
        // ať krátká jména nedělají falešné shody.
        const hit = n === b || ((n.includes(b) || b.includes(n)) && Math.min(n.length, b.length) >= 6);
        if (hit) {
            const key = item.e.name + '|' + item.e.list;
            if (!seen.has(key)) { seen.add(key); matches.push({ name: item.e.name, list: item.e.list, program: item.e.program }); }
        }
    }
    return { available: true, matches, source: _cache.source };
}

function _reset() { _cache = null; }

module.exports = { loadList, isAvailable, screenName, _deaccent, _reset };
