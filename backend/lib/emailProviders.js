/**
 * emailProviders.js — zjednodušené nastavení e-mailu pro advokáta.
 * Z e-mailové adresy odvodí IMAP/SMTP server, aby uživatel nemusel znát hosty a porty.
 *   • známí poskytovatelé → tabulka přednastavení,
 *   • vlastní doména → imap.<doména> / smtp.<doména> na standardních portech.
 * Čistá, deterministická funkce (bez sítě) — snadno testovatelná.
 */
'use strict';

// preset: { imap, smtp, appPassword? }
const PRESETS = {
    'seznam.cz':      { imap: 'imap.seznam.cz', smtp: 'smtp.seznam.cz' },
    'email.cz':       { imap: 'imap.seznam.cz', smtp: 'smtp.seznam.cz' },
    'post.cz':        { imap: 'imap.seznam.cz', smtp: 'smtp.seznam.cz' },
    'centrum.cz':     { imap: 'imap.centrum.cz', smtp: 'smtp.centrum.cz' },
    'volny.cz':       { imap: 'imap.volny.cz', smtp: 'smtp.volny.cz' },
    'gmail.com':      { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', appPassword: true },
    'googlemail.com': { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', appPassword: true },
    'outlook.com':    { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', appPassword: true },
    'hotmail.com':    { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', appPassword: true },
    'live.com':       { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', appPassword: true },
    'office365.com':  { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', appPassword: true },
    'icloud.com':     { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', appPassword: true },
    'me.com':         { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', appPassword: true }
};

function _domain(email) {
    const m = String(email || '').trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
    return m ? m[1] : null;
}

// Vrátí odvozené nastavení nebo null, když e-mail není platný.
function deriveImapSmtp(email) {
    const domain = _domain(email);
    if (!domain) return null;
    const preset = PRESETS[domain];
    const clean = String(email).trim();
    return {
        imap_host: preset ? preset.imap : 'imap.' + domain,
        imap_port: '993',
        imap_ssl: true,
        imap_user: clean,
        smtp_host: preset ? preset.smtp : 'smtp.' + domain,
        smtp_port: '465',
        smtp_ssl: true,
        smtp_user: clean,
        authorized_sender: clean,
        recipient_filter: clean,
        provider: preset ? domain : 'vlastní doména',
        needsAppPassword: !!(preset && preset.appPassword),
        note: (preset && preset.appPassword)
            ? 'Tento poskytovatel s dvoufázovým ověřením obvykle vyžaduje „heslo aplikace" (ne běžné heslo do e-mailu).'
            : 'Servery odvozeny z domény — pokud přihlášení selže, ověřte host/port u svého poskytovatele.'
    };
}

module.exports = { deriveImapSmtp, _domain, PRESETS };
