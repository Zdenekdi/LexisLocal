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

// Spočítá datum lhůty (YYYY-MM-DD) z počtu dní od dneška.
function calculateDeadlineDate(days) {
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
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
