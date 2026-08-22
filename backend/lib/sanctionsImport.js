/**
 * sanctionsImport.js — importér OFICIÁLNÍCH sankčních seznamů (EU / OFAC / UN) do
 * normalizovaného tvaru, který čte lib/sanctions.js: [{ name, aliases[], list, program }].
 *
 * Seznamy jsou veřejné a zdarma. Tento modul je parsuje z jejich stažených formátů
 * (OFAC SDN CSV, EU konsolidovaný XML, UN konsolidovaný XML). Parsování je tolerantní
 * (regex/heuristika) a izolované — přesné mapování se dolaďuje proti reálným souborům.
 * Stahování (fetchAndBuild) běží tam, kde je síť (stroj advokáta); parsery jsou čisté
 * a testovatelné bez sítě.
 */
'use strict';

const fs = require('fs');

function _splitCsvLine(line) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
            if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
            else cur += ch;
        } else {
            if (ch === ',') { out.push(cur); cur = ''; }
            else if (ch === '"') q = true;
            else cur += ch;
        }
    }
    out.push(cur);
    return out;
}

// OFAC SDN.CSV: ent_num, SDN_Name, SDN_Type, Program, ...
function parseOfacCsv(csv) {
    const lines = String(csv || '').split(/\r?\n/).filter(l => l.trim());
    const entries = [];
    for (const line of lines) {
        const f = _splitCsvLine(line);
        const name = String(f[1] || '').trim();
        if (!name || name === '-0-') continue;
        const program = String(f[3] || '').replace(/-0-/g, '').trim() || null;
        entries.push({ name, aliases: [], list: 'OFAC', program });
    }
    return entries;
}

// EU konsolidovaný XML: entity se jmény v atributu wholeName; program v programme.
function parseEuXml(xml) {
    const s = String(xml || '');
    const entries = [];
    const blocks = s.split(/<sanctionEntity/i).slice(1);
    const src = blocks.length ? blocks.map(b => '<sanctionEntity' + b) : [];
    for (const b of src) {
        const names = [...b.matchAll(/wholeName="([^"]+)"/gi)].map(m => m[1].trim()).filter(Boolean);
        if (!names.length) continue;
        const prog = (b.match(/programme="([^"]+)"/i) || [])[1] || null;
        entries.push({ name: names[0], aliases: [...new Set(names.slice(1))], list: 'EU', program: prog });
    }
    return entries;
}

// UN konsolidovaný XML: <INDIVIDUAL>/<ENTITY> s FIRST_NAME..FOURTH_NAME + ALIAS_NAME.
function parseUnXml(xml) {
    const s = String(xml || '');
    const entries = [];
    const grab = (block) => ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
        .map(t => { const m = block.match(new RegExp('<' + t + '>([^<]+)</' + t + '>', 'i')); return m ? m[1].trim() : ''; })
        .filter(Boolean).join(' ').trim();
    for (const tag of ['INDIVIDUAL', 'ENTITY']) {
        const blocks = s.split(new RegExp('<' + tag + '>', 'i')).slice(1).map(b => b.split(new RegExp('</' + tag + '>', 'i'))[0]);
        for (const b of blocks) {
            const name = grab(b);
            if (!name) continue;
            const aliases = [...b.matchAll(/<ALIAS_NAME>([^<]+)<\/ALIAS_NAME>/gi)].map(m => m[1].trim()).filter(Boolean);
            entries.push({ name, aliases: [...new Set(aliases)], list: 'UN', program: null });
        }
    }
    return entries;
}

function _dedup(entries) {
    const seen = new Map();
    for (const e of entries) {
        const k = String(e.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!k) continue;
        if (!seen.has(k)) seen.set(k, { name: e.name, aliases: [...(e.aliases || [])], list: e.list, program: e.program || null });
        else {
            const ex = seen.get(k);
            ex.aliases = [...new Set([...(ex.aliases || []), ...(e.aliases || [])])];
        }
    }
    return [...seen.values()];
}

function buildNormalized(sources) {
    sources = sources || {};
    let all = [];
    if (sources.ofacCsv) all = all.concat(parseOfacCsv(sources.ofacCsv));
    if (sources.euXml) all = all.concat(parseEuXml(sources.euXml));
    if (sources.unXml) all = all.concat(parseUnXml(sources.unXml));
    return _dedup(all);
}

function writeList(entries, filePath) {
    fs.writeFileSync(filePath, JSON.stringify(entries || [], null, 2), 'utf8');
    return { written: (entries || []).length, filePath };
}

// Stáhne a sestaví (tam, kde je síť). fetchImpl injektovatelný pro testy.
async function fetchAndBuild(opts) {
    opts = opts || {};
    const f = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
    const get = async (url) => {
        if (!url) return null;
        try { const r = await f(url); if (!r || !r.ok) return null; return await r.text(); }
        catch (e) { return null; }
    };
    const [ofacCsv, euXml, unXml] = await Promise.all([get(opts.ofacUrl), get(opts.euUrl), get(opts.unUrl)]);
    return buildNormalized({ ofacCsv, euXml, unXml });
}

module.exports = { parseOfacCsv, parseEuXml, parseUnXml, buildNormalized, writeList, fetchAndBuild, _splitCsvLine };
