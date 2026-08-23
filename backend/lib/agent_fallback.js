/**
 * agent_fallback.js — POCTIVÁ záložní odpověď, když AI model (Ollama) neběží nebo
 * neodpoví včas.
 *
 * ZÁSADA (anti-fabrikace): fallback NIKDY nevyrábí falešný právní dokument ani
 * stanovisko. Dřív vracel canned „Smlouvu o dílo" apod. — to je pro právní nástroj
 * nebezpečné (vypadá to jako koncept, ale neodpovídá zadání). Místo toho vrací
 * jasné upozornění, že zadání NEBYLO zpracováno, a co s tím.
 */
'use strict';

const NAMES = {
    resersnik: '📚 Rešeršník',
    spisovatel: '📝 Spisovatel',
    kontrolor: '⚖️ Kontrolor',
    stylista: '✍️ Stylista',
    sekretarka: '⏰ Sekretářka'
};

function generateAgentFallback(agentId, prompt) {
    const name = NAMES[agentId] || ('🤖 Agent ' + agentId);
    const zadani = prompt ? String(prompt).slice(0, 200) : '';
    return `⚠️ ${name} — ZADÁNÍ NEBYLO ZPRACOVÁNO\n\n` +
        `Lokální AI model (Ollama) je nedostupný nebo neodpověděl včas, proto NEVZNIKL žádný výstup. ` +
        `Toto je pouze upozornění — nejde o právní dokument ani stanovisko a nic z něj nepřebírejte.\n\n` +
        (zadani ? `Původní zadání: „${zadani}"\n\n` : '') +
        `Co s tím:\n` +
        `• Ověřte, že běží Ollama (\`ollama serve\`) a je stažený zvolený model (\`ollama list\`).\n` +
        `• Pro rychlost zvolte menší model (např. qwen2.5:3b nebo gemma2:2b) v nastavení modelu.\n` +
        `• Poté zadání zopakujte.`;
}

// Pomocník: pozná, zda je text jen fallback (aby ho volající neukládal jako koncept).
function isFallbackText(text) {
    return typeof text === 'string' && text.indexOf('ZADÁNÍ NEBYLO ZPRACOVÁNO') !== -1;
}

module.exports = { generateAgentFallback, isFallbackText };
