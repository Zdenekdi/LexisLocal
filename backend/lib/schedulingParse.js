/**
 * schedulingParse.js — DETERMINISTICKÉ rozpoznání a parsování termínu schůzky
 * z českého textu (e-mailu). ŽÁDNÁ AI: čistě regex + kalendářová aritmetika,
 * aby bylo booking spolehlivý i bez modelu.
 *
 * detectSchedulingIntent(text) → bool   (obsahuje žádost o schůzku?)
 * parseMeeting(text, now)      → { date:'YYYY-MM-DD', time:'HH:MM', durationMin, location } | null
 *   • vrací výsledek JEN když najde konkrétní DATUM i ČAS (jinak null — nehádá),
 *   • `now` (Date) je referenční „dnes" pro relativní výrazy (kvůli testovatelnosti).
 */
'use strict';

const INTENT_RE = /(sch[uů]zk|sejd|sejít|setk[aá]n|potk[aá]|uvid[ íí]me\s+se|domluv|dohodn|rezerv|termín|konzultac|porad|jednán[íi]\s+s\s+klient)/i;

function detectSchedulingIntent(text) {
    return INTENT_RE.test(String(text || ''));
}

// Dny v týdnu (0 = neděle … 6 = sobota), tolerantně k pádům/diakritice.
const WEEKDAYS = [
    { d: 1, re: /pond[eě]l/i },
    { d: 2, re: /[uú]ter/i },
    { d: 3, re: /st[řr]ed/i },
    { d: 4, re: /[čc]tvrt/i },
    { d: 5, re: /p[áa]tek|p[áa]tku/i },
    { d: 6, re: /sobot/i },
    { d: 0, re: /ned[eě]l/i }
];

function _pad(n) { return String(n).padStart(2, '0'); }
function _ymd(dt) { return dt.getFullYear() + '-' + _pad(dt.getMonth() + 1) + '-' + _pad(dt.getDate()); }

// Najde datum. Priorita: explicitní DD.MM.(YYYY) > relativní (dnes/zítra/pozítří) >
// nejbližší budoucí den v týdnu. Vrací Date (lokální) nebo null.
function _parseDate(text, now) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // DD.MM.YYYY nebo DD.MM. (rok se doplní; když už letos byl, vezme příští rok)
    const md = text.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?/);
    if (md) {
        const day = parseInt(md[1], 10), mon = parseInt(md[2], 10) - 1;
        let year = md[3] ? parseInt(md[3], 10) : now.getFullYear();
        if (mon >= 0 && mon <= 11 && day >= 1 && day <= 31) {
            let dt = new Date(year, mon, day);
            if (!md[3] && dt < base) dt = new Date(year + 1, mon, day);
            return dt;
        }
    }

    if (/\bpoz[ií]tř/i.test(text)) { const d = new Date(base); d.setDate(d.getDate() + 2); return d; }
    if (/\bz[ií]tra/i.test(text)) { const d = new Date(base); d.setDate(d.getDate() + 1); return d; }
    if (/\bdnes\b/i.test(text)) return base;

    for (const w of WEEKDAYS) {
        if (w.re.test(text)) {
            let offset = (w.d - base.getDay() + 7) % 7;
            if (offset === 0) offset = 7; // „ve čtvrtek" řečené ve čtvrtek = příští čtvrtek
            const d = new Date(base); d.setDate(d.getDate() + offset);
            return d;
        }
    }
    return null;
}

// Najde čas: „14:30", „v 14", „ve 14 h", „od 9:00", „14 hodin". Vrací 'HH:MM' | null.
function _parseTime(text) {
    let m = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m) {
        const h = +m[1], mi = +m[2];
        if (h <= 23 && mi <= 59) return _pad(h) + ':' + _pad(mi);
    }
    // „v 14", „ve 14", „od 14", „14 hodin", „14h"
    m = text.match(/\b(?:v|ve|od)\s+(\d{1,2})(?:\s*(?:h|hod\w*))?\b/i) || text.match(/\b(\d{1,2})\s*(?:h|hodin\w*)\b/i);
    if (m) {
        const h = +m[1];
        if (h >= 0 && h <= 23) return _pad(h) + ':00';
    }
    return null;
}

// Délka schůzky: „na hodinu"(60), „půl hodiny"(30), „hodinu a půl"(90),
// „N minut", „N hodiny". Default null (volající dá 60).
function _parseDuration(text) {
    if (/hodin\w*\s+a\s+p[uů]l/i.test(text)) return 90;      // „hodinu a půl"
    if (/p[uů]l\s+hodin/i.test(text)) return 30;               // „půl hodiny"
    let m = text.match(/\b(\d{1,3})\s*min\w*/i);            // „N minut"
    if (m) return Math.max(15, Math.min(480, +m[1]));
    // Délka v hodinách JEN s předložkou „na" — jinak by „ve 14 hodin" (čas) bylo
    // omylem bráno jako délka. „na 2 hodiny", „na hodinu".
    m = text.match(/\bna\s+(\d{1,2})\s*hodin\w*/i);
    if (m) return Math.max(15, Math.min(480, +m[1] * 60));
    if (/\bna\s+hodinu\b/i.test(text)) return 60;
    return null;
}

// Místo: „v Brně", „u soudu", „v kanceláři", „na adrese ...". Best-effort, volitelné.
function _parseLocation(text) {
    let m = text.match(/\bna\s+adrese\s+([^,.;\n]{3,80})/i);
    if (m) return m[1].trim();
    m = text.match(/\b(?:u|na)\s+(soud[uě][^,.;\n]{0,40})/i);
    if (m) return m[0].replace(/^\s*/, '').trim();
    m = text.match(/\bv\s+(kancel[aá][řr]\w*)/i);
    if (m) return m[1].trim();
    return '';
}

function parseMeeting(text, now) {
    const t = String(text || '');
    const ref = now instanceof Date ? now : new Date(now);
    const dt = _parseDate(t, ref);
    const time = _parseTime(t);
    if (!dt || !time) return null; // FAIL-CLOSED: bez konkrétního data i času nehádáme
    return {
        date: _ymd(dt),
        time,
        durationMin: _parseDuration(t) || 60,
        location: _parseLocation(t)
    };
}

module.exports = { detectSchedulingIntent, parseMeeting, _parseDate, _parseTime, _parseDuration };
