/**
 * spisFolders.js — fyzická spisová struktura na disku + BEZPEČNÉ směrování zápisu.
 *
 * Spis je v LexisLocalu logická entita (spisy.js) párovaná přes sp. zn. Když AI
 * agent vytvoří koncept podání, musí ho uložit do složky SPRÁVNÉHO spisu. Záměna
 * klientů = únik dat. Modul dává každému spisu fyzickou složku, jednoznačně
 * identifikovanou strojovou vizitkou (.lexisspis.json), a řídí zápis PODLE ní —
 * ne podle názvu složky ani fuzzy shody sp. zn.
 *
 * Zásady:
 *   • Identita spisu = spisId z vizitky (ne název složky). Přejmenování složky
 *     advokátem identitu nerozbije.
 *   • FAIL-CLOSED: když si systém není JISTÝ cílovou složkou (chybí vizitka nebo
 *     je jich pro jeden spisId víc = nejednoznačné), zápis NEjde do klientské
 *     složky — skončí v `_Nezařazeno` a čeká na ruční zařazení. Nikdy nehádá.
 *   • Nedestruktivní: nepřepisuje existující soubory (kolize → časové razítko).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { INGEST_DIR } = require('./config');

const MARKER = '.lexisspis.json';

const SUBFOLDERS = [
    '01_Doručené',
    '02_Podání',
    '03_Koncepty',
    '04_Smlouvy',
    '05_Korespondence',
    '06_Interní',
    '07_Fakturace'
];
const DRAFT_SUBFOLDER = '03_Koncepty';
const NEZARAZENO = '_Nezařazeno';

function _slug(s) {
    return String(s == null ? '' : s)
        .replace(/[\/\\:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ /g, '_')
        .replace(/^[._]+|[._]+$/g, '')
        .slice(0, 60);
}

function _year(spis) {
    const src = (spis && (spis.createdAt || spis.zalozenoAt)) || null;
    const d = src ? new Date(src) : new Date();
    const y = d.getFullYear();
    return Number.isFinite(y) ? y : new Date().getFullYear();
}

function _ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
    return p;
}

function _listSpisFolders() {
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(INGEST_DIR, { withFileTypes: true });
    } catch (e) {
        return out;
    }
    for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (ent.name.startsWith('.') || ent.name === NEZARAZENO) continue;
        const folderPath = path.join(INGEST_DIR, ent.name);
        const marker = readMarker(folderPath);
        if (marker && marker.spisId) out.push({ folderPath, marker });
    }
    return out;
}

function _nextFolderId(year) {
    let max = 0;
    for (const { marker } of _listSpisFolders()) {
        const fid = String(marker.folderId || '');
        const m = fid.match(/^(\d{4})-(\d{4})$/);
        if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
    }
    return `${year}-${String(max + 1).padStart(4, '0')}`;
}

function readMarker(folderPath) {
    try {
        const raw = fs.readFileSync(path.join(folderPath, MARKER), 'utf8');
        const obj = JSON.parse(raw);
        return (obj && typeof obj === 'object' && obj.spisId) ? obj : null;
    } catch (e) {
        return null;
    }
}

function writeMarker(folderPath, marker) {
    _ensureDir(folderPath);
    fs.writeFileSync(path.join(folderPath, MARKER), JSON.stringify(marker, null, 2), { encoding: 'utf8' });
    return marker;
}

function findFolderBySpisId(spisId) {
    if (!spisId) return null;
    const hits = _listSpisFolders().filter(x => x.marker.spisId === spisId);
    if (hits.length === 0) return null;
    if (hits.length > 1) return { ambiguous: true, paths: hits.map(h => h.folderPath) };
    return { folderPath: hits[0].folderPath, marker: hits[0].marker };
}

function ensureSpisFolder(spis) {
    if (!spis || !spis.id) throw new Error('ensureSpisFolder: chybí spis.id.');

    const found = findFolderBySpisId(spis.id);
    if (found && found.folderPath) {
        SUBFOLDERS.forEach(sf => _ensureDir(path.join(found.folderPath, sf)));
        return { folderPath: found.folderPath, folderId: found.marker.folderId, created: false };
    }
    if (found && found.ambiguous) {
        throw new Error(`ensureSpisFolder: nejednoznačná identita spisu ${spis.id} (${found.paths.length} složek).`);
    }

    const folderId = _nextFolderId(_year(spis));
    const parts = [folderId];
    const klient = _slug(spis.klient);
    const proti = _slug(spis.protistrana);
    if (klient) parts.push(klient);
    if (proti) parts.push('vs_' + proti);
    let folderName = parts.join('_') || folderId;

    let folderPath = path.join(INGEST_DIR, folderName);
    if (fs.existsSync(folderPath)) {
        folderName = folderName + '_' + String(spis.id).slice(-6);
        folderPath = path.join(INGEST_DIR, folderName);
    }

    _ensureDir(folderPath);
    SUBFOLDERS.forEach(sf => _ensureDir(path.join(folderPath, sf)));
    writeMarker(folderPath, {
        spisId: spis.id,
        folderId: folderId,
        spisZn: spis.spisZn || '',
        klient: spis.klient || '',
        klientIco: spis.klientIco || '',
        protistrana: spis.protistrana || '',
        createdAt: new Date().toISOString(),
        schema: 'lexisspis/1'
    });
    return { folderPath, folderId, created: true };
}

function nezarazenoDir() {
    return _ensureDir(path.join(INGEST_DIR, NEZARAZENO));
}

function resolveDraftTarget(spisId) {
    const found = findFolderBySpisId(spisId);
    if (!found) return { ok: false, reason: 'no-folder' };
    if (found.ambiguous) return { ok: false, reason: 'ambiguous', paths: found.paths };
    const dir = _ensureDir(path.join(found.folderPath, DRAFT_SUBFOLDER));
    return { ok: true, dir, folderPath: found.folderPath, folderId: found.marker.folderId };
}

function _safeName(name) {
    let ext = '';
    const em = String(name || '').match(/\.(docx|pdf|txt|html?)$/i);
    if (em) ext = em[0].toLowerCase();
    const base = _slug(String(name || 'koncept').replace(/\.(docx|pdf|txt|html?)$/i, ''));
    return (base || 'koncept') + ext;
}

function _uniquePath(dir, fileName) {
    let p = path.join(dir, fileName);
    if (!fs.existsSync(p)) return p;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    p = path.join(dir, `${base}_${stamp}${ext}`);
    let i = 2;
    while (fs.existsSync(p)) {
        p = path.join(dir, `${base}_${stamp}_${i}${ext}`);
        i++;
    }
    return p;
}

function saveDraftToSpis(o) {
    o = o || {};
    const fileName = _safeName(o.fileName || 'koncept.docx');
    const content = o.content == null ? '' : o.content;

    const target = resolveDraftTarget(o.spisId);
    let dir, filed, folderId, reason;
    if (target.ok) {
        dir = target.dir; filed = true; folderId = target.folderId;
    } else {
        dir = nezarazenoDir(); filed = false; reason = target.reason;
    }

    const savedPath = _uniquePath(dir, fileName);
    fs.writeFileSync(savedPath, content);

    try {
        const spisy = require('./spisy');
        if (o.spisId) {
            spisy.addEvent(
                o.spisId,
                filed ? 'koncept' : 'nezarazeno',
                filed
                    ? `Uložen koncept „${fileName}" do ${folderId}/${DRAFT_SUBFOLDER}.`
                    : `Koncept „${fileName}" uložen do _Nezařazeno (${reason}) — čeká na ruční zařazení.`,
                { savedPath, filed, reason: reason || null }
            );
        }
    } catch (e) { /* deník je best-effort */ }
    try {
        require('./audit').logEvent(
            'AI Koncept',
            filed ? 'Uložení konceptu do spisu' : 'Uložení konceptu — NEZAŘAZENO (fail-closed)',
            fileName,
            { spisId: o.spisId || null, savedPath, filed, reason: reason || null }
        );
    } catch (e) { /* audit je best-effort */ }

    return { savedPath, filed, folderId: folderId || null, reason: reason || null };
}

module.exports = {
    MARKER,
    SUBFOLDERS,
    DRAFT_SUBFOLDER,
    NEZARAZENO,
    readMarker,
    writeMarker,
    findFolderBySpisId,
    ensureSpisFolder,
    resolveDraftTarget,
    nezarazenoDir,
    saveDraftToSpis,
    _slug,
    _nextFolderId
};
