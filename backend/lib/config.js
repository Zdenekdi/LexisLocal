/**
 * config.js — jeden zdroj pravdy pro cesty a konstanty sdílené celým backendem.
 *
 * Historicky se WATCH_DIR počítal na 5 místech dvěma různými způsoby:
 *   - `os.homedir()`                        (database.js, audit.js)
 *   - `process.env.HOME || process.env.USERPROFILE`  (watcher.js, rag.js, agents.js)
 * Na stroji, kde se tyto dvě hodnoty liší (nebo kde HOME není nastavené),
 * by se data rozpadla do dvou složek — DB, klíč, audit, RAG a agenti jinam
 * než spisy. Proto se cesty nově počítají JEN TADY a všude se importují.
 *
 * `os.homedir()` je robustnější než `HOME || USERPROFILE`: na Windows vrací
 * profil i tam, kde HOME chybí, a nikdy nevrátí `undefined`.
 *
 * --- Ingest vs. Data ---------------------------------------------------------
 * INGEST_DIR = „spisovna" advokáta — složka, na kterou uživatel ukáže a v níž
 *   žijí jeho reálné spisy (číst se z ní budou dokumenty, zapisovat koncepty do
 *   podsložek spisu). Uživatel si ji volí; my mu do ní nesypeme technická data.
 * DATA_DIR   = úložiště spravované appkou (DB, RAG index, audit, konfigurace).
 *   Leží MIMO advokátovu spisovnu, aby ji naše pomocné soubory nešpinily.
 *
 * WATCH_DIR zůstává jako ALIAS na INGEST_DIR kvůli zpětné kompatibilitě —
 * historicky se pod ním počítalo úplně všechno. Migrace technických souborů
 * z INGEST_DIR do DATA_DIR je vědomý, samostatný krok (viz plán), ne side-effect.
 */
'use strict';

const path = require('path');
const os = require('os');

// Spisovna advokáta. Priorita WATCH_DIR (historické env) → INGEST_DIR → default.
const INGEST_DIR =
    process.env.WATCH_DIR ||
    process.env.INGEST_DIR ||
    path.join(os.homedir(), 'Desktop', 'LexisSpisy');

// Zpětně kompatibilní alias: dřív se WATCH_DIR používal pro spisy i pro data.
const WATCH_DIR = INGEST_DIR;

// Appkou spravované úložiště (mimo spisovnu). Platformově korektní umístění.
function _defaultDataDir() {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'LexisLocal');
    }
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'LexisLocal');
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'LexisLocal');
}
const DATA_DIR = process.env.LEXIS_DATA_DIR || _defaultDataDir();

module.exports = { WATCH_DIR, INGEST_DIR, DATA_DIR };
