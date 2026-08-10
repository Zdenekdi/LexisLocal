/**
 * extraction.js — sdílený AI-extraktor metadat + výpočet lhůty.
 *
 * Dřív byly `runAIExtractor` a `calculateDeadlineDate` zkopírované byte-po-bytu
 * ve watcher.js i paperless.js (dva pipeline zpracování dokumentu). Jakákoli
 * úprava promptu/logiky se musela dělat dvakrát a hrozil rozjezd. Nově je to
 * jeden zdroj, který oba importují.
 */
'use strict';

// Robustní import Ollama (CommonJS i ESM default export).
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

// --- Pracovní dny / svátky (§ 57 odst. 2 o.s.ř.) ---
function _dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}
const _holidayCache = {};
function _czechHolidays(year) {
    if (_holidayCache[year]) return _holidayCache[year];
    const fixed = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
    const set = new Set(fixed.map(md => `${year}-${md}`));
    const easter = _easterSunday(year);
    const gf = new Date(easter.getTime()); gf.setDate(gf.getDate() - 2); set.add(_dateKey(gf)); // Velký pátek
    const em = new Date(easter.getTime()); em.setDate(em.getDate() + 1); set.add(_dateKey(em)); // Velikonoční pondělí
    _holidayCache[year] = set;
    return set;
}
function _isWorkingDay(d) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return false;
    return !_czechHolidays(d.getFullYear()).has(_dateKey(d));
}

// Přičte měsíce s ošetřením konce měsíce (§ 57 odst. 2 o.s.ř.): stejné číslo dne,
// jinak poslední den cílového měsíce (31. 1. + 1 měsíc → 28./29. 2.). Rok = 12 měsíců.
function _addMonthsClamped(base, months) {
    const total = base.getMonth() + (parseInt(months, 10) || 0);
    const y = base.getFullYear() + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(base.getDate(), last), 12, 0, 0, 0);
}

// Obecný výpočet data lhůty podle jednotky (YYYY-MM-DD). § 57 o.s.ř.:
//   • dny/týdny: základ + N (resp. 7·N) dní,
//   • měsíce/roky (odst. 2): stejné číslo dne s ošetřením konce měsíce.
// V každém případě: padne-li konec na So/Ne/svátek, posun na následující pracovní den.
// unit ∈ {'day','week','month','year'} (default 'day'). Vrací null pro amount ≤ 0.
function calculateDeadlineByUnit(amount, unit, baseDate) {
    const n = parseInt(amount, 10);
    if (!n || n <= 0) return null;
    const base = baseDate ? new Date(baseDate) : new Date();
    base.setHours(12, 0, 0, 0); // vyhne se posunu přes půlnoc/DST
    let d;
    switch (unit) {
        case 'week':  d = new Date(base); d.setDate(d.getDate() + n * 7); break;
        case 'month': d = _addMonthsClamped(base, n); break;
        case 'year':  d = _addMonthsClamped(base, n * 12); break;
        case 'day':
        default:      d = new Date(base); d.setDate(d.getDate() + n); break;
    }
    d.setHours(12, 0, 0, 0);
    let guard = 0;
    while (!_isWorkingDay(d) && guard < 30) { d.setDate(d.getDate() + 1); guard++; }
    return _dateKey(d);
}

// Spočítá datum lhůty zadané POČTEM DNÍ (YYYY-MM-DD). Deleguje na obecný výpočet;
// chování zachováno pro zpětnou kompatibilitu (watcher.js, paperless.js).
function calculateDeadlineDate(days, baseDate) {
    if (!days) return null;
    return calculateDeadlineByUnit(days, 'day', baseDate);
}

// Deterministická detekce lhůt v textu (dny/týdny/měsíce/roky, číslicí i slovní
// číslovkou), zrcadlí editorový lexis-calendar.detectDeadlines. Vrací
// [{ amount, unit, context }]. Měsíce/týdny/roky bere jen v lhůtovém kontextu
// (ochrana proti false-positive typu „smlouva na 2 roky").
const _CZ_NUM = {
    'jeden':1,'jednoho':1,'jedne':1,'jednu':1,'jedna':1,'dva':2,'dvou':2,'dve':2,'dvema':2,
    'tri':3,'trech':3,'trem':3,'ctyri':4,'ctyr':4,'ctyrech':4,'pet':5,'peti':5,'sest':6,'sesti':6,
    'sedm':7,'sedmi':7,'osm':8,'osmi':8,'devet':9,'deviti':9,'deset':10,'desiti':10,
    'patnact':15,'patnacti':15,'dvacet':20,'dvaceti':20,'tricet':30,'triceti':30
};
function _deaccent(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function _parseNum(tok) {
    if (tok == null) return null;
    const s = String(tok).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const k = _deaccent(s);
    return Object.prototype.hasOwnProperty.call(_CZ_NUM, k) ? _CZ_NUM[k] : null;
}
function detectDeadlines(text) {
    if (!text) return [];
    const NUM = '(\\d+|jed(?:en|noho|n[eé]|nu|na)|dv(?:a|ou|[eě]|[eě]ma)|t[rř][ií]|t[rř]ech|t[rř]em|[cč]ty[rř](?:i|ech)?|p[eě]t|p[eě]ti|[sš]est|[sš]esti|sedm|sedmi|osm|osmi|dev[eě]t|dev[ií]ti|deset|des[ií]ti|patn[aá]ct|patn[aá]cti|dvacet|dvaceti|t[rř]icet|t[rř]iceti)';
    const END = '(?![a-zá-žA-ZÁ-Ž])';
    const pat = {
        day:   new RegExp(NUM + '\\s+(?:pracovn[ií]ch\\s+)?(?:den|dnech|dn[uůíey])' + END, 'gi'),
        week:  new RegExp(NUM + '\\s+(?:t[yý]dnech|t[yý]den|t[yý]dn[uůyeí])' + END, 'gi'),
        month: new RegExp(NUM + '\\s+m[eě]s[ií]c[uůeieí]*' + END, 'gi'),
        year:  new RegExp(NUM + '\\s+(?:let|roky|rok[uůy]?|roce)' + END, 'gi')
    };
    const ctxRe = /(lh[uů]t|nejpozd|ve lh[uů]t|do\s+\d|do\s+[a-zá-ž]+\s+(?:m[eě]s|t[yý]d|dn|rok|let)|podat|vyj[aá]d[rř]|odvol|dovol|n[aá]mitk|[zž]alob|st[ií][zž]nost|kasa[cč]n|term[ií]n)/i;
    const out = [];
    String(text).split(/[\n\r]+/).forEach(function (line) {
        if (line.trim().length < 8) return;
        const hasCtx = ctxRe.test(line);
        const ctx = line.trim().replace(/\s+/g, ' ');
        ['day', 'week', 'month', 'year'].forEach(function (unit) {
            if (unit !== 'day' && !hasCtx) return;
            const re = pat[unit]; re.lastIndex = 0; let m;
            while ((m = re.exec(line)) !== null) {
                const amount = _parseNum(m[1]);
                if (!amount || amount <= 0) continue;
                if (!out.some(function (d) { return d.amount === amount && d.unit === unit && d.context === ctx; })) {
                    out.push({ amount: amount, unit: unit, context: ctx });
                }
            }
        });
    });
    return out;
}

// Ollama AI extraktor strukturovaných metadat z českého právního textu.
async function runAIExtractor(text) {
    // Build a highly optimized, single-shot structured JSON prompt
    const prompt = `Zanalyzuj následující český právní text a vytáhni z něj klíčová strukturovaná metadata.
Reaguj VÝHRADNĚ validním JSON objektem s těmito poli:
{
  "caseNumber": "spisová značka ve formátu např. '23 C 120/2026'",
  "plaintiff": "jméno žalobce",
  "defendant": "jméno žalovaného",
  "deadlineDays": 15, // lhůta k vyjádření v dnech jako číslo, pokud je uvedena
  "summary": "krátké shrnutí obsahu jednou větou"
}

Text k analýze:
${text.substring(0, 3000)}`;

    const response = await ollama.chat({
        model: "llama3",
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.1 }
    });

    const content = response.message.content;

    // Parse the JSON blocks safely
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    return null;
}

module.exports = { calculateDeadlineDate, calculateDeadlineByUnit, detectDeadlines, runAIExtractor };
