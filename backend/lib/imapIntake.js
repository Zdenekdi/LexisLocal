/**
 * imapIntake.js — příjem e-mailů ze schránky asistentů přes IMAP.
 *
 * Fail-closed a idempotentní:
 *   • zpracují se JEN zprávy od authorized_sender; ostatní se přeskočí (nikdo cizí
 *     nemůže přes e-mail ovládat agenty),
 *   • dedup přes uložené UID (imap_processed) — stejná zpráva se nezpracuje dvakrát,
 *   • zprávy se NEmažou; jen se označí jako přečtené (\Seen). Mazání je zakázané.
 *
 * IMAP klient (imapflow) i parser (mailparser) se načítají LÍNĚ, takže modul jde
 * require-nout i bez nich (testy injektují vlastní `adapter`).
 */
'use strict';

const db = require('./database');
const { logEvent } = require('./audit');
const { processEmailTask } = require('./emailTask');

const PROCESSED_CAP = 500;

function _requiredImap(settings) {
    const missing = [];
    ['imap_host', 'imap_port', 'imap_user', 'imap_pass'].forEach(k => { if (!settings || !settings[k]) missing.push(k); });
    return missing;
}

function _loadProcessed() { return new Set(db.get('imap_processed') || []); }
function _saveProcessed(set) {
    let arr = [...set];
    if (arr.length > PROCESSED_CAP) arr = arr.slice(arr.length - PROCESSED_CAP);
    db.set('imap_processed', arr);
}

// Vyzvedne a zpracuje nové zprávy. `adapter` (test seam) implementuje:
//   listUnseen(): Promise<[{ uid, from, subject, text }]>   // from = e-mailová adresa
//   markSeen(uid): Promise<void>
//   close?(): Promise<void>
async function pollOnce(settings, adapter) {
    settings = settings || {};
    const missing = _requiredImap(settings);
    if (missing.length) return { ok: false, reason: 'imap-config', missing };

    const authorized = (settings.authorized_sender || '').trim().toLowerCase();
    const own = adapter ? null : await _imapflowAdapter(settings);
    const mbox = adapter || own;

    const processed = _loadProcessed();
    let processedCount = 0, skipped = 0, errors = 0, total = 0;
    try {
        const messages = await mbox.listUnseen();
        total = messages.length;
        for (const m of messages) {
            const key = String(m.uid);
            if (processed.has(key)) { skipped++; continue; }               // dedup
            const from = String(m.from || '').trim().toLowerCase();
            if (authorized && from !== authorized) {                        // fail-closed filtr
                logEvent('E-mail', 'IMAP: přeskočen neautorizovaný odesílatel', m.from || '(neznámý)', { subject: m.subject || '' });
                processed.add(key);
                try { await mbox.markSeen(m.uid); } catch (e) {}
                skipped++;
                continue;
            }
            try {
                await processEmailTask({ sender: m.from, subject: m.subject || '(bez předmětu)', body: m.text || '' });
                processedCount++;
            } catch (e) {
                errors++;
                logEvent('E-mail', 'IMAP: zpracování zprávy selhalo', m.from || '', { subject: m.subject || '', error: e.message });
            }
            processed.add(key);
            try { await mbox.markSeen(m.uid); } catch (e) {}
        }
    } finally {
        _saveProcessed(processed);
        if (own && own.close) { try { await own.close(); } catch (e) {} }
    }
    logEvent('E-mail', 'IMAP: vyzvednutí schránky', settings.imap_user || '', { total, processed: processedCount, skipped, errors });
    return { ok: true, total, processed: processedCount, skipped, errors };
}

// Reálný IMAP adaptér přes imapflow + mailparser (líně načtené).
async function _imapflowAdapter(settings) {
    const { ImapFlow } = require('imapflow');
    const { simpleParser } = require('mailparser');
    const client = new ImapFlow({
        host: settings.imap_host,
        port: parseInt(settings.imap_port, 10) || 993,
        secure: settings.imap_ssl !== false,
        auth: { user: settings.imap_user, pass: settings.imap_pass },
        logger: false
    });
    await client.connect();
    await client.mailboxOpen('INBOX');
    return {
        async listUnseen() {
            const out = [];
            for await (const msg of client.fetch({ seen: false }, { uid: true, source: true })) {
                try {
                    const parsed = await simpleParser(msg.source);
                    const from = parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].address : '';
                    out.push({ uid: msg.uid, from, subject: parsed.subject || '', text: parsed.text || '' });
                } catch (e) { /* nečitelnou zprávu přeskočíme */ }
            }
            return out;
        },
        async markSeen(uid) { try { await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true }); } catch (e) {} },
        async close() { try { await client.logout(); } catch (e) {} }
    };
}

// Spustí pravidelný poller na pozadí. NEspouští pod testy (drží event loop) a timer
// .unref(), ať nikdy neblokuje ukončení. Vrací handle nebo null.
function startPolling(getSettings, intervalMs) {
    if (typeof process.env.JEST_WORKER_ID !== 'undefined') return null;
    const ms = Math.max(60 * 1000, intervalMs || 5 * 60 * 1000);
    const timer = setInterval(async () => {
        try {
            const s = typeof getSettings === 'function' ? getSettings() : getSettings;
            if (!s || s.imap_enabled !== true) return;
            if (_requiredImap(s).length) return;
            await pollOnce(s);
        } catch (e) {
            console.error('⚠️ IMAP poller chyba:', e.message);
        }
    }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
}

// Ověří IMAP připojení (login + otevření INBOX) bez zpracování. _connector (test seam) volitelný.
async function testConnection(settings, _connector) {
    const missing = _requiredImap(settings);
    if (missing.length) return { ok: false, error: 'Chybí IMAP nastavení: ' + missing.join(', '), missing };
    try {
        if (_connector) { await _connector(settings); return { ok: true }; }
        const { ImapFlow } = require('imapflow');
        const client = new ImapFlow({
            host: settings.imap_host, port: parseInt(settings.imap_port, 10) || 993,
            secure: settings.imap_ssl !== false, auth: { user: settings.imap_user, pass: settings.imap_pass }, logger: false
        });
        await client.connect();
        await client.mailboxOpen('INBOX');
        await client.logout();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = { pollOnce, startPolling, testConnection, _requiredImap, _imapflowAdapter };
