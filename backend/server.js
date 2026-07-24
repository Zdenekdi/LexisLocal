require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WATCH_DIR, loadInbox, saveInbox, processDocument, setWatcherState, checkAllInsolvencies } = require('./lib/watcher');
const { checkSubject } = require('./lib/registries');
const { indexDocument, deleteDocumentIndex, searchSimilar, loadIndex } = require('./lib/rag');
const { logEvent, clearAuditLogs } = require('./lib/audit');
const { loadAgents, saveAgent, deleteAgent, resetAgentToDefault } = require('./lib/agents');
const ChiefOrchestrator = require('./lib/orchestrator');
const db = require('./lib/database');
const TimeTracker = require('./lib/timetracking');
const WorkflowEngine = require('./lib/workflow');
const ConflictDetector = require('./lib/conflicts');
const JudikaturaWatcher = require('./lib/judikatura');
const ManagerialIntelligence = require('./lib/managerial');
const HearingsWatcher = require('./lib/hearings');
const { writeToSystemCalendar } = require('./lib/calendar');
const { anonymizeText } = require('./lib/anonymizer');
const { getHardwareProfile, calculateInferenceMetrics, getSystemTelemetry } = require('./lib/green_monitor');
const { generateDublinCoreXml } = require('./lib/archival');



// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollama = require('./lib/ollama_client');
const { generateAgentFallback } = require('./lib/agent_fallback');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Ochrana proti path traversal (sdílený helper) ---
const { safePathInWatchDir, sanitizeFileName } = require('./lib/pathsafe');

// Secure API Token Middleware
const API_TOKEN = process.env.API_TOKEN;
const authenticate = (req, res, next) => {
    // Allow static files in the public directory and OPTIONS preflight requests without auth
    if (req.method === 'OPTIONS' || req.path === '/' || req.path === '/index.html' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.ico')) {
        return next();
    }
    
    // Only enforce auth if API_TOKEN is set in environment
    if (API_TOKEN) {
        const authHeader = req.headers['authorization'];
        let token = req.headers['x-api-token'] || req.query.token;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
        
        if (token !== API_TOKEN) {
            console.warn(`🔒 Nepovolený přístup k API: ${req.method} ${req.path}`);
            return res.status(401).json({ error: "Přístup odepřen: Neplatný nebo chybějící API token." });
        }
    }
    next();
};

app.use(authenticate);

// ─── Modulární routery (postupné rozbití monolitu) ───────────────────────────
// Domény se vytahují ze server.js do samostatných souborů v routes/.
app.use('/api/agents', require('./routes/agents'));
app.use('/api/document', require('./routes/document'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/conflicts', require('./routes/conflicts'));
app.use('/api/judikatura', require('./routes/judikatura'));
app.use('/api/managerial', require('./routes/managerial'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/rag', require('./routes/rag'));
app.use('/api/watcher', require('./routes/watcher'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/models', require('./routes/models'));
app.use('/api/system', require('./routes/system'));
app.use('/api/registry', require('./routes/registry'));
app.use('/api/registries', require('./routes/registries'));
app.use('/api/paperless', require('./routes/paperless'));
app.use('/api/email', require('./routes/email'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/inbox', require('./routes/inbox'));

// Root Status
app.get('/api/status', (req, res) => {
    const agents = loadAgents();
    res.json({
        status: "online",
        project: "LexisLocal AI Ecosystem",
        version: "1.2.0",
        watcherDir: WATCH_DIR,
        activeAgents: Object.keys(agents)
    });
});

// Dynamic Model Listing Endpoint
// /api/models/* → routes/models.js

// Helper to resolve ragFilters from request body (sdílený s routes/rag.js)
const { resolveRagFilters } = require('./lib/rag_request');

// AI Agent Swarm Orchestration Endpoint with Custom Model Selector
app.post('/api/agent/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const { prompt, context, model } = req.body;
    const startTime = Date.now();
    
    const agents = loadAgents();
    const agent = agents[agentId];
    if (!agent) {
        return res.status(404).json({ error: "Agent nebyl nalezen." });
    }
    
    // Choose model (default to llama3 if not specified)
    const selectedModel = model || "llama3";
    console.log(`🤖 Volám agenta [${agent.name}] s modelem [${selectedModel}]`);
    
    try {
        let systemPromptText = agent.systemPrompt;
        let resolvedFilters = null;
        try {
            resolvedFilters = await resolveRagFilters(req.body);
        } catch (fErr) {
            console.warn("⚠️ RAG: Selhalo rozlišení filtrů:", fErr.message);
        }

        const strictMode = resolvedFilters && (resolvedFilters.strict === true || resolvedFilters.strict === 'true');
        if (strictMode) {
            systemPromptText += "\n\n⚠️ ARCHITEKTURA PROTI HALUCINACÍM (STRICT RAG):\n" +
                "Jsi v režimu přísné shody s dokumentací. Odpovídej výhradně na základě poskytnutého schváleného kontextu ze spisů a kontextu dokumentu.\n" +
                "Pokud dodaný kontext neobsahuje odpověď na položenou otázku nebo zadání, nesmíš použít své obecné znalosti ani si nic domýšlet. " +
                "V takovém případě musí tvůj výstup začínat přesnou větou: 'Nedostatek podkladů ze spisů pro bezpečné vypracování.' a stručně uvést, co chybí.\n";
        }

        const messages = [
            { role: 'system', content: systemPromptText }
        ];
        
        // Retrieve relevant historical context from RAG memory
        let ragSources = [];
        try {
            if (resolvedFilters) {
                console.log(`🧠 RAG: Aktivní filtry pro vyhledávání: ${JSON.stringify(resolvedFilters)}`);
            }
            const matches = await searchSimilar(prompt, 3, resolvedFilters);
            const highConfidenceMatches = matches.filter(m => m.score >= 0.70);
            ragSources = highConfidenceMatches.map(m => ({
                fileName: m.fileName,
                score: m.score,
                textHash: crypto.createHash('sha256').update(m.text).digest('hex').substring(0, 8)
            }));
            
            if (highConfidenceMatches.length > 0) {
                const ragContextText = highConfidenceMatches
                    .map(m => `[Zdrojový spis: ${m.fileName}, Shoda: ${Math.round(m.score * 100)}%]:\n${m.text}`)
                    .join('\n\n---\n\n');
                
                messages.push({
                    role: 'system',
                    content: `Historický kontext a zjištěné precedenty z klientských spisů v archivu:\n${ragContextText}\n\nVýše uvedené historické pasáže a informace využij k přesnější argumentaci a přizpůsobení stylu, pokud je to vhodné.`
                });
                console.log(`🧠 RAG: Obohatil jsem systémovou zprávu agenta [${agent.name}] o ${highConfidenceMatches.length} sémantických pasáží.`);
            }
        } catch (ragErr) {
            console.warn("⚠️ RAG: Selhalo automatické sémantické vyhledávání pro agenta:", ragErr.message);
        }
        
        if (context) {
            const anonymizedContext = anonymizeText(context);
            messages.push({ role: 'system', content: `Kontext dokumentu / spisové podklady:\n${anonymizedContext}` });
        }
        
        messages.push({ role: 'user', content: prompt });
        
        const response = await ollama.chat({
            model: selectedModel,
            messages: messages,
            options: {
                temperature: 0.3
            }
        });
        
        const durationMs = Date.now() - startTime;
        logEvent('LexisEditor', `AI Agent (${agent.name})`, 'Generování textu', {
            model: selectedModel,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: response.message.content.length,
            durationMs: durationMs
        });

        // 🌿 Green AI and 🔍 AI Act Transparency logs
        const greenMetrics = calculateInferenceMetrics(durationMs);
        db.insert('green_logs', {
            agentId,
            model: selectedModel,
            timestamp: new Date().toISOString(),
            ...greenMetrics
        });

        const systemPromptHash = crypto.createHash('sha256').update(systemPromptText).digest('hex');
        const transparencyRecord = db.insert('transparency_logs', {
            agentId,
            agentName: agent.name,
            model: selectedModel,
            prompt: prompt,
            systemPrompt: systemPromptText,
            systemPromptHash: systemPromptHash,
            ragSources: ragSources,
            timestamp: new Date().toISOString(),
            humanApproved: false,
            greenMetrics: {
                energyWh: greenMetrics.energyWh,
                co2Grams: greenMetrics.co2Grams
            }
        });

        res.json({
            agent: agent.name,
            model: selectedModel,
            response: response.message.content,
            transparencyId: transparencyRecord.id,
            greenMetrics,
            timestamp: new Date().toISOString()
        });
        
     } catch (err) {
        console.warn(`⚠️ Selhalo spojení s Ollama (${err.message}). Používám robustní lokální simulovaný fallback.`);
        const fallbackResponse = generateAgentFallback(agentId, prompt);
        const durationMs = Date.now() - startTime;
        
        logEvent('LexisEditor', `AI Agent Fallback (${agent.name})`, 'Generování textu (Fallback)', {
            model: `${selectedModel} (Simulovaný)`,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: fallbackResponse.length,
            durationMs: durationMs
        });

        const greenMetrics = calculateInferenceMetrics(durationMs);
        db.insert('green_logs', {
            agentId,
            model: `${selectedModel} (Simulovaný)`,
            timestamp: new Date().toISOString(),
            ...greenMetrics
        });

        const systemPromptHash = crypto.createHash('sha256').update(systemPromptText).digest('hex');
        const transparencyRecord = db.insert('transparency_logs', {
            agentId,
            agentName: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            prompt: prompt,
            systemPrompt: systemPromptText,
            systemPromptHash: systemPromptHash,
            ragSources: [],
            timestamp: new Date().toISOString(),
            humanApproved: false,
            greenMetrics: {
                energyWh: greenMetrics.energyWh,
                co2Grams: greenMetrics.co2Grams
            }
        });

        res.json({
            agent: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            response: fallbackResponse,
            transparencyId: transparencyRecord.id,
            greenMetrics,
            timestamp: new Date().toISOString()
        });
     }
});

// AI Swarm Debate - Coordinate two agents interacting over the same task
app.post('/api/agent-swarm/debate', async (req, res) => {
    const { prompt, agentId1, agentId2, context, model } = req.body;
    const startTime = Date.now();
    
    const agents = loadAgents();
    const agent1 = agents[agentId1];
    const agent2 = agents[agentId2];
    
    if (!agent1 || !agent2) {
        return res.status(404).json({ error: "Jeden nebo oba vybraní agenti nebyli nalezeni." });
    }
    
    const selectedModel = model || "llama3";
    console.log(`🤖 Spouštím Swarm Debatu: Tvůrce [${agent1.name}] & Oponent [${agent2.name}] s modelem [${selectedModel}]`);
    
    // Retrieve RAG context
    let ragContext = "";
    try {
        const resolvedFilters = await resolveRagFilters(req.body);
        if (resolvedFilters) {
            console.log(`🧠 Swarm RAG: Aktivní filtry pro debatu: ${JSON.stringify(resolvedFilters.fileNames)}`);
        }
        const matches = await searchSimilar(prompt, 3, resolvedFilters);
        const highConfidenceMatches = matches.filter(m => m.score >= 0.70);
        
        if (highConfidenceMatches.length > 0) {
            ragContext = highConfidenceMatches
                .map(m => `[Zdrojový spis: ${m.fileName}, Shoda: ${Math.round(m.score * 100)}%]:\n${m.text}`)
                .join('\n\n---\n\n');
            console.log(`🧠 Swarm RAG: Získáno ${highConfidenceMatches.length} sémantických precedensů pro debatu.`);
        }
    } catch (ragErr) {
        console.warn("⚠️ Swarm RAG: Selhalo vyhledávání kontextu:", ragErr.message);
    }

    try {
        // --- STEP 1: INVOKE AGENT 1 (CREATOR) ---
        const messages1 = [
            { role: 'system', content: agent1.systemPrompt }
        ];
        
        if (ragContext) {
            messages1.push({
                role: 'system',
                content: `Historický kontext a precedenty z klientských spisů:\n${ragContext}`
            });
        }
        
        if (context) {
            messages1.push({ role: 'system', content: `Kontext dokumentu:\n${context}` });
        }
        
        messages1.push({ role: 'user', content: prompt });
        
        const response1 = await ollama.chat({
            model: selectedModel,
            messages: messages1,
            options: { temperature: 0.3 }
        });
        
        const answer1 = response1.message.content;
        
        // --- STEP 2: INVOKE AGENT 2 (OPPONENT / CRITIQUE) ---
        const messages2 = [
            { role: 'system', content: agent2.systemPrompt }
        ];
        
        if (ragContext) {
            messages2.push({
                role: 'system',
                content: `Historický kontext a precedenty z klientských spisů:\n${ragContext}`
            });
        }
        
        if (context) {
            messages2.push({ role: 'system', content: `Kontext dokumentu:\n${context}` });
        }
        
        messages2.push({
            role: 'system',
            content: `Tvůj AI kolega [${agent1.name}] vypracoval pro uživatele tento prvotní návrh:\n\n${answer1}\n\nJako přísný a konstruktivní oponent zhodnoť tento návrh. Identifikuj slabá místa, právní kličky, potenciální rizika nebo stylistické nedostatky. Následně vypracuj revidované znění nebo finální doporučení pro advokáta.`
        });
        
        messages2.push({ role: 'user', content: prompt });
        
        const response2 = await ollama.chat({
            model: selectedModel,
            messages: messages2,
            options: { temperature: 0.2 }
        });
        
        const answer2 = response2.message.content;
        
        logEvent('LexisEditor', 'Swarm Debata', `Duel: ${agent1.name} vs. ${agent2.name}`, {
            model: selectedModel,
            agent1: agent1.name,
            agent2: agent2.name,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            response1Length: answer1.length,
            response2Length: answer2.length,
            durationMs: Date.now() - startTime
        });

        res.json({
            success: true,
            model: selectedModel,
            agent1: { id: agentId1, name: agent1.name, response: answer1 },
            agent2: { id: agentId2, name: agent2.name, response: answer2 },
            timestamp: new Date().toISOString()
        });
        
    } catch (err) {
        console.warn(`⚠️ Selhalo spojení s Ollama ve Swarmu (${err.message}). Používám lokalizovaný robustní simulovaný oponentní výstup.`);
        
        const answer1 = generateAgentFallback(agentId1, prompt);
        const answer2 = `[Oponentní posudek od agenta ${agent2.name} na návrh od ${agent1.name}]:\n\nAnalyzoval jsem předchozí vypracování. Návrh je strukturovaný správně, avšak doporučuji doplnit výslovnou doložku o volbě práva a smluvní pokutě ve výši 0.05 % denně za prodlení, aby byly zájmy našeho klienta chráněny neprůstřelně.\n\nZde je revidovaný odstavec:\n"V případě prodlení kupujícího s úhradou kupní ceny se sjednává smluvní pokuta ve výši 0.05 % z dlužné částky za každý den prodlení."`;
        
        logEvent('LexisEditor', 'Swarm Debata Fallback', `Duel Fallback: ${agent1.name} vs. ${agent2.name}`, {
            model: `${selectedModel} (Simulovaný Swarm)`,
            agent1: agent1.name,
            agent2: agent2.name,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            response1Length: answer1.length,
            response2Length: answer2.length,
            durationMs: Date.now() - startTime
        });

        res.json({
            success: true,
            model: `${selectedModel} (Simulovaný Swarm)`,
            agent1: { id: agentId1, name: agent1.name, response: answer1 },
            agent2: { id: agentId2, name: agent2.name, response: answer2 },
            timestamp: new Date().toISOString()
        });
    }
});

// POST /api/agent-swarm/orchestrate - Hierarchy Swarm Orchestration with Chief Orchestrator
app.post('/api/agent-swarm/orchestrate', async (req, res) => {
    const { prompt, context, model } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: "Zadání (prompt) je povinné." });
    }

    const selectedModel = model || "llama3";
    console.log(`🧠 Express Server: Spouštím Chief Orchestrator pro: "${prompt.substring(0, 50)}..."`);

    try {
        const resolvedFilters = await resolveRagFilters(req.body);
        if (resolvedFilters) {
            console.log(`🧠 Orchestrator: Aktivní filtry pro RAG: ${JSON.stringify(resolvedFilters.fileNames)}`);
        }
        const result = await ChiefOrchestrator.orchestrate(prompt, context || "", selectedModel, null, resolvedFilters);
        
        logEvent('LexisEditor', 'Chief Orchestrator', `Orchestrace: ${prompt.substring(0, 40)}`, {
            model: selectedModel,
            durationMs: result.durationMs,
            stepsCount: result.steps.length,
            success: true
        });

        res.json(result);
    } catch (err) {
        console.error("❌ Orchestrace selhala:", err.message);
        res.status(500).json({ error: `Orchestrace selhala: ${err.message}` });
    }
});

// /api/activity/* → routes/activity.js
// /api/conflicts/* → routes/conflicts.js
// /api/judikatura/* → routes/judikatura.js
// /api/managerial/* → routes/managerial.js

// /api/inbox/* → routes/inbox.js
// GET /api/registry/check - Check subject against ARES and ISIR public registries
// /api/registry/* → routes/registry.js

// /api/campaigns/* → routes/campaigns.js

// /api/calendar/* → routes/calendar.js

// Resilient Fallback Engine
// generateAgentFallback → lib/agent_fallback.js (sdíleno s routes/email.js)

// /api/rag/* → routes/rag.js

// /api/system/* → routes/system.js


// POST /api/document/archive - Generate Dublin Core XML metadata descriptor for PDF/A
// /api/document/* → routes/document.js

// GET /api/registries/check - Query all registries for an ICO
// /api/registries/* → routes/registries.js

// GET /api/alerts - Retrieve active insolvency alerts
// /api/alerts/* → routes/alerts.js
// /api/rag/status a /api/rag/reindex-all → routes/rag.js
// /api/audit/logs a /api/audit/clear → routes/audit.js
// /api/watcher/* → routes/watcher.js
// /api/agents/* → routes/agents.js

// /api/email/* → routes/email.js

// --- PAPERLESS-NGX INTEGRATION WEBHOOK ---
// /api/paperless/* → routes/paperless.js

// Spouštět kontrolu změn soudních jednání na pozadí (každou hodinu)
setInterval(() => {
    HearingsWatcher.checkAllHearings(WATCH_DIR).catch(err => {
        console.error("⚠️ Background monitored hearings check error:", err.message);
    });
}, 60 * 60 * 1000);

const USE_HTTPS = process.env.USE_HTTPS === 'true';

const SSL_KEY_PATH = process.env.SSL_KEY_PATH || 'key.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || 'cert.pem';

if (require.main === module) {
    if (USE_HTTPS && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        try {
            const https = require('https');
            const sslOptions = {
                key: fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH)
            };
            https.createServer(sslOptions, app).listen(PORT, () => {
                console.log(`🚀🔒 LexisLocal AI ZABEZPEČENÝ backend (HTTPS) běží na https://localhost:${PORT}`);
            });
        } catch (httpsErr) {
            console.error("❌ Nepodařilo se spustit HTTPS server, padám zpět na HTTP:", httpsErr.message);
            app.listen(PORT, () => {
                console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
            });
        }
    } else {
        if (USE_HTTPS) {
            console.warn(`⚠️ V konfiguraci je vyžadováno HTTPS, ale chybí soubory certifikátu (${SSL_KEY_PATH} / ${SSL_CERT_PATH}). Spouštím na HTTP.`);
        }
        app.listen(PORT, () => {
            console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
        });
    }
}

module.exports = app;
