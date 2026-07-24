/**
 * pathsafe.js — sdílená ochrana proti path traversal.
 *
 * Vrátí bezpečnou absolutní cestu uvnitř WATCH_DIR pro daný název souboru:
 * zahodí adresářové komponenty (path.basename) a ověří, že výsledek nikdy
 * neopustí kořenový adresář (obrana proti "../", absolutním cestám i "\0").
 *
 * Dřív žila tato funkce natvrdo v server.js; vytažena sem, aby ji mohly
 * sdílet i jednotlivé routery bez duplikace.
 */
'use strict';

const path = require('path');
const { WATCH_DIR } = require('./config');

function safePathInWatchDir(fileName) {
    const raw = String(fileName == null ? '' : fileName);
    if (raw.indexOf('\0') !== -1) {
        throw new Error('Neplatný název souboru.');
    }
    const base = path.basename(raw);
    if (!base || base === '.' || base === '..') {
        throw new Error('Neplatný název souboru.');
    }
    const root = path.resolve(WATCH_DIR);
    const resolved = path.resolve(root, base);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
        throw new Error('Cesta mimo povolený adresář.');
    }
    return resolved;
}

module.exports = { safePathInWatchDir };
