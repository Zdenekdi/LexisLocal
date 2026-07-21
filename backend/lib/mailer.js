// --- mailer — odeslání e-mailu přes SMTP (nodemailer) s přílohami ---
// Používá se pro přeposlání příchozí datové zprávy klientovi i s přílohou
// (mailto přílohu neumí). Odeslání dělá server → do spisu pak zapisujeme
// „odesláno" pravdivě (server má potvrzení od SMTP, ne jen otevřené okno).
//
// Testovatelnost: sendMail přijímá volitelný _transport (mock), takže testy
// nepotřebují reálný nodemailer ani SMTP server. nodemailer se načítá líně
// (až při reálném odeslání), aby require modulu v testech nespadl, když
// balíček není nainstalovaný.

'use strict';

const fs = require('fs');
const path = require('path');

// Vrátí seznam chybějících povinných SMTP polí (prázdný = OK).
function validateSmtp(s) {
    const missing = [];
    if (!s || !s.smtp_host) missing.push('smtp_host');
    if (!s || !s.smtp_port) missing.push('smtp_port');
    if (!s || !s.smtp_user) missing.push('smtp_user');
    if (!s || !s.smtp_pass) missing.push('smtp_pass');
    return missing;
}

// Zkontroluje, že přílohy existují na disku; vrátí normalizované cesty.
function resolveAttachments(paths) {
    const list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    return list.filter(Boolean).map(p => {
        if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
            const e = new Error('Příloha nebyla nalezena: ' + p);
            e.code = 'NO_ATTACHMENT';
            throw e;
        }
        return { filename: path.basename(p), path: p };
    });
}

// Sestaví objekt zprávy pro nodemailer.
function buildMessage(opts) {
    const o = opts || {};
    const msg = {
        from: o.from,
        to: o.to,
        subject: o.subject || '',
        text: o.body || ''
    };
    const att = resolveAttachments(o.attachmentPaths);
    if (att.length) msg.attachments = att;
    return msg;
}

function createTransport(settings) {
    const nodemailer = require('nodemailer'); // líně — testy injektují _transport
    const port = parseInt(settings.smtp_port, 10) || 587;
    // secure=true pro 465 (implicit TLS), jinak STARTTLS na 587.
    const secure = settings.smtp_ssl === true || (settings.smtp_ssl !== false && port === 465);
    return nodemailer.createTransport({
        host: settings.smtp_host,
        port,
        secure,
        auth: { user: settings.smtp_user, pass: settings.smtp_pass }
    });
}

// Odešle e-mail. settings = SMTP konfigurace, message = { to, subject, body, attachmentPaths[] }.
// _transport (volitelný) umožní testům podstrčit mock místo reálného SMTP.
async function sendMail(settings, message, _transport) {
    const missing = validateSmtp(settings);
    if (missing.length) {
        const e = new Error('Chybí SMTP nastavení: ' + missing.join(', '));
        e.code = 'SMTP_CONFIG';
        throw e;
    }
    const msg = buildMessage({
        from: settings.smtp_from || settings.smtp_user,
        to: message.to,
        subject: message.subject,
        body: message.body,
        attachmentPaths: message.attachmentPaths
    });
    if (!msg.to) {
        const e = new Error('Chybí příjemce.');
        e.code = 'NO_RECIPIENT';
        throw e;
    }
    const transport = _transport || createTransport(settings);
    return await transport.sendMail(msg);
}

module.exports = { sendMail, buildMessage, validateSmtp, resolveAttachments, createTransport };
