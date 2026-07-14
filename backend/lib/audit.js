const fs = require('fs');
const path = require('path');

// Save the audit log inside the watched dir as a hidden file for resilience and cloud syncing
const { WATCH_DIR } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
const AUDIT_LOG_FILE = path.join(WATCH_DIR, '.audit_log.json');

/**
 * Load all audit logs
 */
function loadAuditLogs() {
    try {
        if (!fs.existsSync(AUDIT_LOG_FILE)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf-8'));
    } catch (e) {
        console.error("❌ Nepodařilo se načíst auditní log:", e.message);
        return [];
    }
}

/**
 * Save audit logs
 */
function saveAuditLogs(logs) {
    try {
        // Keep logs capped at 1000 items to prevent huge file sizes, ordered from oldest to newest
        const cappedLogs = logs.slice(-1000);
        fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(cappedLogs, null, 2), 'utf-8');
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
        fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
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
