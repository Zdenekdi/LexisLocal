/**
 * LexisLocal Backend Server & AI Orchestrator
 * Connects the desktop interface / Office add-ins to the local LLM (Ollama)
 * and coordinates the Special Agent Swarm with customizable model selections.
 */

const express = require('express');
const cors = require('cors');
const { WATCH_DIR } = require('./lib/watcher');

// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Special Agent Swarm Definition
const AGENTS = {
    resersnik: {
        name: "Rešeršník",
        emoji: "📚",
        role: "Vyhledávání v zákonech a judikatuře. Formulace právních argumentů.",
        systemPrompt: "Jsi zkušený český advokátní koncipient zaměřený na rešerše. Tvým úkolem je na základě zadaných právních předpisů a judikátů vypracovat objektivní právní rozbor."
    },
    stylista: {
        name: "Stylista",
        emoji: "✍️",
        role: "Klonování stylu advokáta. Přepisování textu do elegantní advokátní češtiny.",
        systemPrompt: "Jsi expert na stylistiku a právní psaní. Tvým úkolem je upravit text tak, aby působil nanejvýš profesionálně, autoritativně, přesvědčivě a přirozeně."
    },
    kontrolor: {
        name: "Kontrolor",
        emoji: "⚖️",
        role: "Detekce rizik, protimluvů a slabých míst v argumentaci.",
        systemPrompt: "Jsi oponentní právní zástupce. Tvým úkolem je kriticky zhodnotit předložený text, najít v něm logické chyby, slabá místa a navrhnout protiargumenty."
    }
};

// Root Status
app.get('/api/status', (req, res) => {
    res.json({
        status: "online",
        project: "LexisLocal AI Ecosystem",
        version: "1.1.0",
        watcherDir: WATCH_DIR,
        activeAgents: Object.keys(AGENTS)
    });
});

// Dynamic Model Listing Endpoint
app.get('/api/models', async (req, res) => {
    try {
        console.log("🔍 Dotazuji lokální Ollama na stažené modely...");
        const response = await ollama.list();
        res.json({
            models: response.models || []
        });
    } catch (err) {
        console.warn("⚠️ Nelze se spojit s Ollama službou na pozadí. Vracím výchozí simulovaný seznam modelů.");
        res.json({
            models: [
                { name: "llama3:latest", size: 4700000000 },
                { name: "mistral:latest", size: 4100000000 },
                { name: "lia:latest", size: 3800000000 }
            ],
            warning: "Ollama server není spuštěn. Zobrazen simulovaný přehled."
        });
    }
});

// Model Downloader Endpoint
app.post('/api/models/pull', async (req, res) => {
    const { model } = req.body;
    if (!model) {
        return res.status(400).json({ error: "Název modelu je povinný." });
    }
    
    console.log(`📥 Spouštím stahování modelu Ollama: ${model}`);
    try {
        await ollama.pull({ model });
        res.json({ success: true, message: `Model ${model} byl úspěšně stažen.` });
    } catch (err) {
        res.status(500).json({ error: `Chyba při stahování modelu ${model}: ${err.message}` });
    }
});

// AI Agent Swarm Orchestration Endpoint with Custom Model Selector
app.post('/api/agent/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const { prompt, context, model } = req.body;
    
    const agent = AGENTS[agentId];
    if (!agent) {
        return res.status(404).json({ error: "Agent nebyl nalezen." });
    }
    
    // Choose model (default to llama3 if not specified)
    const selectedModel = model || "llama3";
    console.log(`🤖 Volám agenta [${agent.name}] s modelem [${selectedModel}]`);
    
    try {
        const messages = [
            { role: 'system', content: agent.systemPrompt }
        ];
        
        if (context) {
            messages.push({ role: 'system', content: `Kontext dokumentu / spisové podklady:\n${context}` });
        }
        
        messages.push({ role: 'user', content: prompt });
        
        const response = await ollama.chat({
            model: selectedModel,
            messages: messages,
            options: {
                temperature: 0.3
            }
        });
        
        res.json({
            agent: agent.name,
            model: selectedModel,
            response: response.message.content,
            timestamp: new Date().toISOString()
        });
        
    } catch (err) {
        console.warn(`⚠️ Selhalo spojení s Ollama (${err.message}). Používám robustní lokální simulovaný fallback.`);
        const fallbackResponse = generateAgentFallback(agentId, prompt);
        
        res.json({
            agent: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            response: fallbackResponse,
            timestamp: new Date().toISOString()
        });
    }
});

// Resilient Fallback Engine
function generateAgentFallback(agentId, prompt) {
    if (agentId === 'resersnik') {
        return `📚 **[Rešeršník - Lokální Fallback]**\n\nAnalyzoval jsem právní problematiku: *"${prompt}"*.\n\n**Právní rozbor dle českého právního řádu (Zákon č. 89/2012 Sb., občanský zákoník):**\n- **Presumpce dobré víry (§ 7 OZ):** Má se za to, že ten, kdo jednal určitým způsobem, jednal v dobré víře. Protistrana by musela prokázat Váš zlý úmysl.\n- **Neplatnost právního jednání (§ 580 OZ):** Právní jednání odporující zákonu je neplatné pouze tehdy, pokud to vyžaduje smysl a účel zákona.\n\n*Doporučení:* V reakci na soudní výzvu výslovně zdůrazněte splnění všech zákonných náležitostí a presumpci dobré víry.`;
    } else if (agentId === 'stylista') {
        return `✍️ **[Stylista - Lokální Fallback]**\n\nUpravil jsem právní text do vytříbené advokátní češtiny:\n\n*„S ohledem na shora uvedené skutečnosti a s poukazem na ustálenou judikaturu Nejvyššího soudu ČR tímto uctivě vyzýváme druhou smluvní stranu ke splnění jejího smluvního závazku, a to ve lhůtě do 15 dnů od doručení této výzvy, pod následkem zahájení soudního řízení.“*`;
    } else if (agentId === 'kontrolor') {
        return `⚖️ **[Kontrolor - Lokální Fallback]**\n\nProvedl jsem právní audit a detekoval následující rizika:\n\n1. ⚠️ **Formulace lhůty:** Spojení *„bez zbytečného odkladu“* je v tomto typu kontraktu vysoce rizikové a neurčité. Doporučuji nahradit fixní lhůtou (např. *„do 3 pracovních dnů“*).\n2. ⚠️ **Smluvní pokuta:** Chybí explicitní limitace celkové výše smluvní pokuty, což by soud mohl vyhodnotit jako jednání v rozporu s dobrými mravy.`;
    }
    return `🤖 **[Agent ${agentId}]**\n\nZpracoval jsem Váš dotaz ohledně: "${prompt}". Služba Ollama je offline, toto je záložní odpověď.`;
}

app.listen(PORT, () => {
    console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
});
