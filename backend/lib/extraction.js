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

// Spočítá datum lhůty (YYYY-MM-DD). Základ = zadané datum (default dnešek) + N dní;
// padne-li poslední den na So/Ne/svátek, posune se na nejbližší NÁSLEDUJÍCÍ pracovní den.
function calculateDeadlineDate(days, baseDate) {
    if (!days) return null;
    const d = baseDate ? new Date(baseDate) : new Date();
    d.setHours(12, 0, 0, 0); // vyhne se posunu přes půlnoc/DST
    d.setDate(d.getDate() + parseInt(days, 10));
    let guard = 0;
    while (!_isWorkingDay(d) && guard < 30) { d.setDate(d.getDate() + 1); guard++; }
    return _dateKey(d);
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

module.exports = { calculateDeadlineDate, runAIExtractor };
