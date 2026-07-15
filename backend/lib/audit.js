const fs = require('fs');
const path = require('path');

// Save the audit log inside the watched dir as a hidden file for resilience and cloud syncing
const { WATCH_DIR } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
const secureCrypto = require('./secure_crypto'); // audit log je compliance artefakt → šifrovaný (GCM)
const AUDIT_LOG_FILE = path.join(WATCH_DIR, '.audit_log.json');

// Klíč se řeší přes secure_crypto (stejný jako DB, mimo WATCH_DIR). Líně, aby se
// nezakládal soubor klíče při pouhém importu modulu.
let _auditKey = null;
function getKey() {
    if (!_auditKey) _auditKey = secureCrypto.resolveKey();
    return _auditKey;
}

/**
 * Load all audit logs (šifrované GCM; legacy plaintext se stále přečte a přemigruje).
 */
function loadAuditLogs() {
    try {
        if (!fs.existsSync(AUDIT_LOG_FILE)) {
            return [];
        }
        const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // Legacy: soubor je přímo pole záznamů v plaintextu.
        if (Array.isArray(parsed)) return parsed;
        // Nový formát: šifrovaný payload { v, iv, tag, data }.
        return JSON.parse(secureCrypto.decrypt(getKey(), parsed));
    } catch (e) {
        console.error("❌ Nepodařilo se načíst auditní log:", e.message);
        return [];
    }
}

/**
 * Save audit logs (vždy šifrovaně).
 */
function saveAuditLogs(logs) {
    try {
        // Keep logs capped at 1000 items to prevent huge file sizes, ordered from oldest to newest
        const cappedLogs = logs.slice(-1000);
        const payload = JSON.stringify(secureCrypto.encrypt(getKey(), JSON.stringify(cappedLogs)));
        fs.writeFileSync(AUDIT_LOG_FILE, payload, 'utf-8');
    } catch (e) {
        console.error("❌ Nepodařilo se uložit auditní log:", e.message);
    }
}

/**
 * Log a new audit event
 * @param {string} user - e.g. "LexisEditor" or "LexisLocal Dashboard"
 * @param {string} operation - e.g. "OCR", "RAG Search", "AI Agent (Rešeršník)", "Swarm Debata"
 * @param {string} target - e.g. "spis_sp_zn_12C.txt"
 * @param {object} details - e.g. { characters: 1200, durationMs: 450, model: "llama3" }
 */
function logEvent(user, operation, target, details = {}) {
    try {
        const logs = loadAuditLogs();
        const newEvent = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            timestamp: new Date().toISOString(),
            user: user || 'Systém',
            operation: operation,
            target: target || 'Všeobecné',
            details: details
        };
        logs.push(newEvent);
        saveAuditLogs(logs);
        console.log(`📜 Audit: Zaznamenán úkon [${operation}] pro [${target}]`);
    } catch (e) {
        console.error("❌ Chyba logování:", e.message);
    }
}

/**
 * Vyčistí auditní log (zapíše prázdné pole). Používá stejnou cestu jako zápis,
 * takže se nikdy nesmaže jiný soubor kvůli odlišnému výpočtu WATCH_DIR.
 */
function clearAuditLogs() {
    try {
        saveAuditLogs([]); // zapíše prázdný (šifrovaný) log
        return true;
    } catch (e) {
        console.error("❌ Nepodařilo se vyčistit auditní log:", e.message);
        return false;
    }
}

module.exports = {
    loadAuditLogs,
    logEvent,
    clearAuditLogs
};
