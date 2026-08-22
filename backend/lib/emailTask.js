/**
 * emailTask.js — jádro e-mailového úkolování (sdílené endpointem i IMAP pollerem).
 *
 * processEmailTask({ sender, subject, body, caseNumber }) → výsledek:
 *   { status:'bad-request' } | { status:'unauthorized' } |
 *   { status:'ok', mode, task, replied, replyError, steps, citationCheck, scheduling, fullReply }
 *
 * Bezpečnost (fail-closed):
 *   • spustí se JEN pro authorized_sender (jinak status 'unauthorized'),
 *   • schůzku rezervuje jen sekretářka s oprávněním manage_calendar (deterministicky),
 *   • auto-odpověď smí jít VÝHRADNĚ zpět na authorized_sender.
 */
'use strict';

const db = require('./database');
const { logEvent } = require('./audit');
const { loadAgents } = require('./agents');
const { CHAT_MODEL } = require('./model_config');
const ollama = require('./ai_provider');
const { generateAgentFallback } = require('./agent_fallback');
const ChiefOrchestrator = require('./orchestrator');
const scheduling = require('./schedulingParse');
const booking = require('./calendarBooking');
const mailer = require('./mailer');
const spisy = require('./spisy');

async function processEmailTask(input) {
    const { sender, subject, body, caseNumber } = input || {};
    if (!sender || !subject || !body) {
        return { status: 'bad-request', error: 'Odesílatel, předmět a obsah jsou povinné.' };
    }

    const settingsList = db.get('email_settings') || [];
    const settings = settingsList.length > 0 ? settingsList[0] : { authorized_sender: 'advokat@dias.cz' };
    const authorized = (settings.authorized_sender || '').trim().toLowerCase();
    const cleanSender = String(sender).trim().toLowerCase();

    // INVARIANT: jen autorizovaný advokát smí spustit flow.
    if (authorized && cleanSender !== authorized) {
        logEvent('E-mail', 'Úkolování ZAMÍTNUTO — neautorizovaný odesílatel', sender, { subject });
        return { status: 'unauthorized', error: `Přístup odepřen: odesílatel „${sender}" není autorizovaný e-mail advokáta.` };
    }

    const agents = loadAgents();

    // Explicitní volba jednoho agenta: [Tag] v předmětu nebo @zmínka na začátku těla.
    let explicitAgentId = null;
    const subjMatch = subject.match(/\[([^\]]+)\]/);
    const bodyMatch = body.trim().match(/^@([a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+)/);
    const tag = (subjMatch && subjMatch[1]) || (bodyMatch && bodyMatch[1]);
    if (tag) {
        const t = tag.trim().toLowerCase();
        const found = Object.values(agents).find(a => a.id.toLowerCase() === t || a.name.toLowerCase() === t);
        if (found) explicitAgentId = found.id;
    }
    const cleanBody = body.replace(/^@[a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+\s*/, '');

    let mode = 'orchestrate';
    let output = '';
    let stepsSummary = [];
    let citationCheck = null;

    if (explicitAgentId) {
        mode = 'single';
        const agent = agents[explicitAgentId];
        try {
            const r = await ollama.chat({
                model: agent.preferredModel || CHAT_MODEL,
                messages: [{ role: 'system', content: agent.systemPrompt }, { role: 'user', content: cleanBody }],
                options: { temperature: 0.3 }
            });
            output = r.message.content;
        } catch (e) {
            output = generateAgentFallback(agent.id, cleanBody);
        }
        stepsSummary = [`${agent.emoji || ''} ${agent.name}`];
    } else {
        try {
            const r = await ChiefOrchestrator.orchestrate(cleanBody, '', CHAT_MODEL, null, null);
            output = r.finalOutput || '';
            stepsSummary = (r.steps || []).map(st => `${st.agentEmoji || ''} ${st.agentName}: ${st.instruction}`);
            citationCheck = r.citationCheck || null;
        } catch (e) {
            mode = 'orchestrate-fallback';
            output = generateAgentFallback('sekretarka', cleanBody);
            stepsSummary = ['⏰ Sekretářka (fallback)'];
        }
    }

    // ROZPOZNÁNÍ A REZERVACE SCHŮZKY (deterministicky). Řeší jen sekretářka.
    let scheduleResult = null;
    let scheduleNote = '';
    const secretary = agents['sekretarka'];
    const calendarAllowed = !!(secretary && secretary.permissions && secretary.permissions.manage_calendar === true);
    if (scheduling.detectSchedulingIntent(body) && !calendarAllowed) {
        scheduleResult = { intent: true, skipped: 'no-permission' };
        scheduleNote = '\n\n📅 Rozpoznal jsem žádost o schůzku, ale správu kalendáře nemá povolenou žádný agent (sekretářka: manage_calendar). Rezervaci proveďte ručně.';
    } else if (scheduling.detectSchedulingIntent(body)) {
        const parsed = scheduling.parseMeeting(body, new Date());
        if (!parsed) {
            scheduleResult = { intent: true, parsed: false };
            scheduleNote = '\n\n📅 Rozpoznal jsem žádost o schůzku, ale nepodařilo se spolehlivě určit datum a čas. Uveďte prosím konkrétní termín (např. „ve čtvrtek ve 14:00 na hodinu").';
        } else {
            let spisId = null;
            if (caseNumber) { try { const sp = spisy.findByCase(caseNumber); if (sp) spisId = sp.id; } catch (e) {} }
            const meetTitle = 'Schůzka: ' + String(subject).replace(/\[[^\]]+\]\s*/g, '').trim();
            const r = booking.tryBook({
                title: meetTitle, date: parsed.date, time: parsed.time, durationMin: parsed.durationMin,
                location: parsed.location, spisId, source: 'email',
                description: 'Automaticky navrženo z e-mailového zadání advokáta.'
            });
            if (r.booked) {
                scheduleResult = { intent: true, parsed: true, booked: true, meeting: r.meeting };
                scheduleNote = `\n\n📅 Sekretářka rezervovala: ${parsed.date} v ${parsed.time} (${parsed.durationMin} min)${parsed.location ? ', ' + parsed.location : ''}. Termín je volný i s rezervou na dopravu.`;
            } else {
                const alts = (r.suggestions || []).map(sl => sl.start).slice(0, 5);
                scheduleResult = { intent: true, parsed: true, booked: false, reason: r.reason, suggestions: r.suggestions || [] };
                scheduleNote = `\n\n📅 Termín ${parsed.date} v ${parsed.time} NELZE rezervovat (${r.reason === 'out-of-hours' ? 'mimo pracovní hodiny' : 'koliduje s jinou událostí / dopravou'}). ` + (alts.length ? 'Volné alternativy ten den: ' + alts.join(', ') + '.' : 'Ten den nejsou volné termíny — zkuste jiný den.');
            }
        }
    }

    const dateStr = new Date().toLocaleString('cs-CZ');
    const citationNote = (citationCheck && citationCheck.unverifiedCount > 0)
        ? `\n\n⚠️ UPOZORNĚNÍ: ${citationCheck.unverifiedCount} citací nebylo možné ověřit — před použitím zkontrolujte ručně.`
        : '';
    const stepsBlock = stepsSummary.length ? `\nPrůběh zpracování:\n- ${stepsSummary.join('\n- ')}\n` : '';
    const fullReply = `Vážený pane doktore,\n\nk Vašemu zadání ze dne ${dateStr} („${subject.replace(/\[[^\]]+\]\s*/g, '')}") zasílám zpracovaný výstup.\n${stepsBlock}\nS úctou,\nVaše AI kancelář (LexisLocal)\n\n${'-'.repeat(80)}\nVÝSTUP:\n${'-'.repeat(80)}\n\n${output}${citationNote}${scheduleNote}`;

    const createdTask = db.insert('email_tasks', {
        sender: String(sender).trim(), subject: String(subject).trim(), body: String(body).trim(),
        mode, steps: stepsSummary, caseNumber: caseNumber || null, responseSent: fullReply, status: 'completed'
    });

    // AUTO-ODPOVĚĎ — výhradně na authorized_sender (fail-closed).
    let replied = false, replyError = null;
    const to = String(sender).trim();
    if (!authorized || to.toLowerCase() !== authorized) {
        replyError = 'Odpověď neodeslána: příjemce není autorizovaný e-mail advokáta (fail-closed).';
        logEvent('E-mail', 'Auto-odpověď ZAMÍTNUTA — příjemce != advokát', to, { subject });
    } else {
        const missing = mailer.validateSmtp(settings);
        if (missing.length) {
            replyError = 'SMTP není nakonfigurováno (' + missing.join(', ') + ') — výstup je uložen v úkolech.';
        } else {
            try {
                await mailer.sendMail(settings, {
                    to, subject: subject.match(/^re:/i) ? subject : ('Re: ' + subject),
                    body: fullReply, confirmedByLawyer: true
                });
                replied = true;
                logEvent('E-mail', 'Auto-odpověď advokátovi odeslána', to, { subject, mode, taskId: createdTask.id });
            } catch (e) {
                replyError = e.message;
                logEvent('E-mail', 'Auto-odpověď selhala', to, { subject, error: e.message });
            }
        }
    }

    return { status: 'ok', mode, task: createdTask, replied, replyError, steps: stepsSummary, citationCheck, scheduling: scheduleResult, fullReply };
}

module.exports = { processEmailTask };
