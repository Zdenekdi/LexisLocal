/**
 * config.js — jeden zdroj pravdy pro cesty a konstanty sdílené celým backendem.
 *
 * Historicky se WATCH_DIR počítal na 5 místech dvěma různými způsoby:
 *   - `os.homedir()`                        (database.js, audit.js)
 *   - `process.env.HOME || process.env.USERPROFILE`  (watcher.js, rag.js, agents.js)
 * Na stroji, kde se tyto dvě hodnoty liší (nebo kde HOME není nastavené),
 * by se data rozpadla do dvou složek — DB, klíč, audit, RAG a agenti jinam
 * než spisy. Proto se WATCH_DIR nově počítá JEN TADY a všude se importuje.
 *
 * `os.homedir()` je robustnější než `HOME || USERPROFILE`: na Windows vrací
 * profil i tam, kde HOME chybí, a nikdy nevrátí `undefined`.
 */
'use strict';

const path = require('path');
const os = require('os');

const WATCH_DIR = process.env.WATCH_DIR || path.join(os.homedir(), 'Desktop', 'LexisSpisy');

module.exports = { WATCH_DIR };
