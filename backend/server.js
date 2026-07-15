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
const { buildIcs, sanitizeFileName } = require('./lib/ics'); // jeden generátor ICS + sanitizace názvu
const { writeToSystemCalendar } = require('./lib/calendar');
const { anonymizeText } = require('./lib/anonymizer');
const { getHardwareProfile, calculateInferenceMetrics, getSystemTelemetry } = require('./lib/green_monitor');
const { generateDublinCoreXml } = require('./lib/archival');



// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

const app = express();
const PORT = process.env.PORT || 4000;
// Bezpečnost: backend obsluhuje jen lokální klienty (editor + dashboard na témž
// stroji), proto se váže na loopback. LAN přístup jde zapnout jen vědomě přes BIND_HOST.
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const LOOPBACK_ONLY = BIND_HOST === '127.0.0.1' || BIND_HOST === 'localhost' || BIND_HOST === '::1';

// CORS jen pro localhost (a požadavky bez Originu — Electron main, curl, stejný
// původ). Blokuje čtení odpovědí z cizích webů (obrana proti CSRF / DNS-rebinding
// mířícímu na 127.0.0.1). Cizí origin nedostane hlavičku Access-Control-Allow-Origin.
function isLocalOrigin(origin) {
    if (!origin) return true;
    try {
        const h = new URL(origin).hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch (e) { return false; }
}
app.use(cors({ origin: (origin, cb) => cb(null, isLocalOrigin(origin)) }));

// Host-guard: když běžíme jen na loopbacku, odmítni požadavky s cizí Host hlavičkou
// (obrana proti DNS-rebinding, kdy útočníkův web přesměruje svůj název na 127.0.0.1).
if (LOOPBACK_ONLY) {
    app.use((req, res, next) => {
        const host = String(req.headers.host || '').split(':')[0].toLowerCase();
        if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
            return res.status(403).json({ error: 'Neplatný Host.' });
        }
        next();
    });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Ochrana proti path traversal ---
// Vrátí bezpečnou absolutní cestu uvnitř WATCH_DIR pro daný název souboru.
// Zahodí adresářové komponenty (path.basename) a ověří, že výsledek nikdy
// neopustí kořenový adresář (obrana proti "../", absolutním cestám i "\0").
function safePathInWatchDir(fileName) {
    const raw = String(fileName == null ? '' : fileName);
    if (raw.indexOf('\0') !== -1) {
        throw new Error('Neplatný název souboru.');
    }
    const base = path.basename(raw);
    if (!base || base === '.' || base === '..') {
        throw new Error('Neplatný název souboru.');
    }
    const root = path.resolve(WATCH_DIR);
    const resolved = path.resolve(root, base);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
        throw new Error('Cesta mimo povolený adresář.');
    }
    return resolved;
}

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

// Helper to resolve ragFilters from request body
async function resolveRagFilters(reqBody) {
    if (!reqBody || !reqBody.ragFilters) return null;
    const { ragFilters } = reqBody;
    
    let fileNames = [];
    if (Array.isArray(ragFilters.fileNames)) {
        fileNames = [...ragFilters.fileNames];
    }
    
    if (ragFilters.caseNumber) {
        try {
            const inbox = await loadInbox();
            const caseFiles = Object.values(inbox.files || {})
                .filter(f => f.caseNumber === ragFilters.caseNumber)
                .map(f => f.relativePath || f.fileName);
            fileNames = [...new Set([...fileNames, ...caseFiles])];
        } catch (err) {
            console.warn("⚠️ RAG Filter: Nepodařilo se načíst spisy pro caseNumber:", err.message);
        }
    }
    
    const filters = {};
    if (fileNames.length > 0) {
        filters.fileNames = fileNames;
    }
    if (ragFilters.directory) {
        filters.directory = ragFilters.directory;
    }
    if (ragFilters.strict !== undefined) {
        filters.strict = ragFilters.strict;
    }
    
    return Object.keys(filters).length > 0 ? filters : null;
}

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
        // GDPR: kontext se před odesláním do modelu anonymizuje stejně jako u /api/agent.
        const safeContext = context ? anonymizeText(context) : context;

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
        
        if (safeContext) {
            messages1.push({ role: 'system', content: `Kontext dokumentu:\n${safeContext}` });
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
        
        if (safeContext) {
            messages2.push({ role: 'system', content: `Kontext dokumentu:\n${safeContext}` });
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

// POST /api/activity/log - Log active heartbeat from LexisEditor (supports /api/activity/heartbeat alias)
app.post(['/api/activity/log', '/api/activity/heartbeat'], (req, res) => {
    const { documentName, activeSeconds, actionType } = req.body;
    try {
        const entry = TimeTracker.logActivity(documentName, activeSeconds, actionType);
        
        // Trigger workflow event asynchronously
        WorkflowEngine.triggerEvent('document_saved', { documentName: documentName || "", actionType: actionType || "edit" })
            .catch(err => console.error("⚠️ Asynchronní workflow trigger selhal:", err.message));

        res.json({ success: true, entry });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit aktivitu: ${err.message}` });
    }
});

// POST /api/activity/custom - Add manual custom time-tracking entry
app.post('/api/activity/custom', (req, res) => {
    const { documentName, hours, actionType, date } = req.body;
    if (!documentName || !hours || !date) {
        return res.status(400).json({ error: "Spis, počet hodin a datum jsou povinné parametry." });
    }
    try {
        const activeSeconds = parseFloat(hours) * 3600;
        const isoDate = new Date(date).toISOString();
        const entry = TimeTracker.logActivity(documentName, activeSeconds, actionType || 'write', isoDate);
        res.json({ success: true, entry });
    } catch (err) {
        res.status(500).json({ error: `Nelze zapsat ruční úkon: ${err.message}` });
    }
});


// GET /api/activity/today - Get aggregated activities for today
app.get('/api/activity/today', (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const rawLogs = TimeTracker.getDailyActivities(todayStr);
        const aggregated = TimeTracker.aggregateActivities(rawLogs);
        res.json({ success: true, date: todayStr, rawLogsCount: rawLogs.length, aggregated });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst dnešní aktivity: ${err.message}` });
    }
});

// POST /api/activity/timesheet - Generate daily timesheet report
app.post('/api/activity/timesheet', async (req, res) => {
    const { date, model } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const selectedModel = model || "llama3";
    
    try {
        const result = await TimeTracker.generateDailyTimesheet(targetDate, selectedModel);
        
        if (result.success) {
            logEvent('LexisEditor', 'Time-tracking', `Generován timesheet pro ${targetDate}`, {
                date: targetDate,
                model: selectedModel,
                totalHours: result.timesheet.totalHours
            });
        }
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Selhalo generování timesheetu: ${err.message}` });
    }
});

// GET /api/activity/timesheets - Retrieve all generated timesheets from encrypted database
app.get('/api/activity/timesheets', (req, res) => {
    try {
        const timesheets = db.get('timesheets');
        res.json({ success: true, timesheets });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst výkazy práce: ${err.message}` });
    }
});

// GET /api/workflows/rules - Retrieve all workflow rules
app.get('/api/workflows/rules', (req, res) => {
    try {
        const rules = WorkflowEngine.getRules();
        res.json({ success: true, rules });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst pravidla workflow: ${err.message}` });
    }
});

// POST /api/workflows/rules - Create new custom workflow rule
app.post('/api/workflows/rules', (req, res) => {
    try {
        const rule = WorkflowEngine.addRule(req.body);
        res.json({ success: true, rule });
    } catch (err) {
        res.status(500).json({ error: `Nelze vytvořit pravidlo workflow: ${err.message}` });
    }
});

// DELETE /api/workflows/rules/:id - Delete custom workflow rule
app.delete('/api/workflows/rules/:id', (req, res) => {
    const { id } = req.params;
    try {
        const deleted = WorkflowEngine.deleteRule(id);
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: `Nelze smazat pravidlo workflow: ${err.message}` });
    }
});

// GET /api/workflows/alerts - Retrieve all pending calendar tasks and deadlines
app.get('/api/workflows/alerts', (req, res) => {
    try {
        const alerts = db.get('alerts');
        res.json({ success: true, alerts });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst procesní lhůty: ${err.message}` });
    }
});

// POST /api/workflows/alerts/:id/complete - Mark task/deadline as resolved
app.post('/api/workflows/alerts/:id/complete', (req, res) => {
    const { id } = req.params;
    try {
        const updated = db.update('alerts', id, { status: 'completed', completedAt: new Date().toISOString() });
        res.json({ success: true, alert: updated });
    } catch (err) {
        res.status(500).json({ error: `Nelze splnit lhůtu: ${err.message}` });
    }
});

// POST /api/workflows/trigger - Manually trigger an event in the workflow engine
app.post('/api/workflows/trigger', async (req, res) => {
    const { triggerType, payload } = req.body;
    if (!triggerType) {
        return res.status(400).json({ error: "Typ události (triggerType) je povinný." });
    }
    try {
        const createdAlerts = await WorkflowEngine.triggerEvent(triggerType, payload || {});
        res.json({ success: true, triggeredCount: createdAlerts.length, alerts: createdAlerts });
    } catch (err) {
        res.status(500).json({ error: `Chyba při spouštění workflow: ${err.message}` });
    }
});

// --- CONFLICT OF INTEREST ENDPOINTS ---

// POST /api/conflicts/check - Perform conflict of interest check
app.post('/api/conflicts/check', async (req, res) => {
    const { clientName, counterpartyName } = req.body;
    if (!clientName || !counterpartyName) {
        return res.status(400).json({ error: "Jména klienta i protistrany jsou povinná." });
    }
    try {
        const report = await ConflictDetector.checkConflict(clientName, counterpartyName);
        
        logEvent('LexisEditor', 'Conflicts Check', `Ověřeno: ${clientName} vs ${counterpartyName}`, {
            clientName,
            counterpartyName,
            riskLevel: report.riskLevel
        });

        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: `Nelze provést prověrku střetu zájmů: ${err.message}` });
    }
});

// GET /api/conflicts/history - Get conflicts checks history log
app.get('/api/conflicts/history', (req, res) => {
    try {
        const history = ConflictDetector.getHistory();
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst historii prověrek: ${err.message}` });
    }
});

// --- JUDIKATURA & COMPLIANCE ENDPOINTS ---

// POST /api/judikatura/check - Run compliance check on document text content
app.post('/api/judikatura/check', (req, res) => {
    const { content, documentName } = req.body;
    if (!content) {
        return res.status(400).json({ error: "Obsah dokumentu (content) je povinný." });
    }
    try {
        const result = JudikaturaWatcher.checkTemplateCompliance(content, documentName || "Aktivní dokument");
        
        logEvent('LexisEditor', 'Compliance Check', `Ověřeno: ${documentName || "Dokument"}`, {
            documentName: documentName || "Dokument",
            compliant: result.compliant,
            alertsCount: result.alerts.length
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Nelze provést kontrolu compliance: ${err.message}` });
    }
});

// GET /api/judikatura/benchmarks - Get active Supreme Court benchmarks list
app.get('/api/judikatura/benchmarks', (req, res) => {
    try {
        const benchmarks = JudikaturaWatcher.getBenchmarks();
        res.json({ success: true, benchmarks });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst judikáty: ${err.message}` });
    }
});

// GET /api/judikatura/history - Retrieve compliance checks runs history logs
app.get('/api/judikatura/history', (req, res) => {
    try {
        const history = JudikaturaWatcher.getHistory();
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst historii compliance: ${err.message}` });
    }
});

// --- MANAGERIAL INTELLIGENCE ENDPOINTS ---

// GET /api/managerial/profitability - Get profitability report
app.get('/api/managerial/profitability', (req, res) => {
    try {
        const report = ManagerialIntelligence.getProfitabilityReport();
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst ziskovost: ${err.message}` });
    }
});

// POST /api/managerial/budgets - Set budget limits for document
app.post('/api/managerial/budgets', (req, res) => {
    const { documentName, budgetType, limitHours, hourlyRate } = req.body;
    if (!documentName) {
        return res.status(400).json({ error: "Název dokumentu (documentName) je povinný." });
    }
    try {
        const budget = ManagerialIntelligence.setBudget({ documentName, budgetType, limitHours, hourlyRate });
        res.json({ success: true, budget });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit rozpočet: ${err.message}` });
    }
});

// GET /api/managerial/capacity - Get allocation and lawyer capacities workload
app.get('/api/managerial/capacity', (req, res) => {
    try {
        const allocation = ManagerialIntelligence.getCapacityAllocation();
        res.json({ success: true, allocation });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst vytížení týmu: ${err.message}` });
    }
});

// GET /api/managerial/settings - Get office billing/hourly rate settings
app.get('/api/managerial/settings', (req, res) => {
    try {
        const settings = ManagerialIntelligence.getOfficeSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst nastavení sazeb: ${err.message}` });
    }
});

// POST /api/managerial/settings - Update office billing/hourly rate settings
app.post('/api/managerial/settings', (req, res) => {
    try {
        const result = ManagerialIntelligence.updateOfficeSettings(req.body);
        res.json({ success: true, settings: result });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit nastavení sazeb: ${err.message}` });
    }
});

// --- FEE SCHEDULE (CENÍK ODMĚN) ENDPOINTS ---

// GET /api/managerial/fees - Retrieve all fee items
app.get('/api/managerial/fees', (req, res) => {
    try {
        const fees = ManagerialIntelligence.getFees();
        res.json({ success: true, fees });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst ceník odměn: ${err.message}` });
    }
});

// POST /api/managerial/fees - Create or update a fee item
app.post('/api/managerial/fees', (req, res) => {
    try {
        const fee = ManagerialIntelligence.saveFee(req.body);
        res.json({ success: true, fee });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit položku ceníku: ${err.message}` });
    }
});

// DELETE /api/managerial/fees/:id - Delete a fee item
app.delete('/api/managerial/fees/:id', (req, res) => {
    const { id } = req.params;
    try {
        const deleted = ManagerialIntelligence.deleteFee(id);
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: `Nelze smazat položku ceníku: ${err.message}` });
    }
});

// GET /api/inbox - Retrieve unread parsed documents
app.get('/api/inbox', async (req, res) => {
    try {
        const inbox = await loadInbox();
        const unreadFiles = Object.values(inbox.files).filter(f => f.status === 'unread');
        res.json({
            inbox: unreadFiles
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání doručené pošty: ${err.message}` });
    }
});

// POST /api/inbox/mark-read - Mark parsed document as read
app.post('/api/inbox/mark-read', async (req, res) => {
    const { fileName } = req.body;
    if (!fileName) {
        return res.status(400).json({ error: "Název souboru je povinný." });
    }
    
    try {
        const inbox = await loadInbox();
        if (inbox.files[fileName]) {
            inbox.files[fileName].status = 'read';
            await saveInbox(inbox);
            res.json({ success: true, message: `Soubor ${fileName} byl označen za vyřízený.` });
        } else {
            res.status(404).json({ error: "Soubor nebyl nalezen." });
        }
    } catch (err) {
        res.status(500).json({ error: `Chyba: ${err.message}` });
    }
});

// GET /api/inbox/all - Retrieve all parsed documents (both read and unread)
app.get('/api/inbox/all', async (req, res) => {
    try {
        const inbox = await loadInbox();
        res.json({
            inbox: Object.values(inbox.files)
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání kompletní doručené pošty: ${err.message}` });
    }
});

// GET /api/inbox/case/:caseNum/timeline - Retrieve a timeline of activities for a specific case
app.get('/api/inbox/case/:caseNum/timeline', async (req, res) => {
    const { caseNum } = req.params;
    try {
        const timeline = [];
        
        // 1. Get files belonging to this case in the inbox
        const inboxData = (await loadInbox()) || { files: {} };
        const filesArray = Object.values(inboxData.files || {});
        const caseFiles = filesArray.filter(f => f.caseNumber === caseNum);
        
        caseFiles.forEach(file => {
            timeline.push({
                timestamp: file.timestamp || new Date().toISOString(),
                type: 'document_added',
                title: `Přidán dokument do spisu`,
                description: `${file.fileName} (${file.wasOcr ? 'Provedeno OCR' : 'Textový formát'})`,
                icon: file.wasOcr ? '🔍' : '📄'
            });
        });
        
        // 2. Get activities from TimeTracker for this case
        const activities = db.get('activities') || [];
        const caseFileNames = caseFiles.map(f => f.fileName);
        const caseActivities = activities.filter(act => 
            (act.documentName && caseFileNames.includes(act.documentName)) || 
            (act.documentName && act.documentName.includes(caseNum))
        );
        
        caseActivities.forEach(act => {
            const hours = (act.activeSeconds / 3600).toFixed(2);
            timeline.push({
                timestamp: act.timestamp,
                type: 'work_logged',
                title: `Odpracovaná práce`,
                description: `Záznam práce (${hours} hod) - úkon: ${act.actionType || 'úprava'}`,
                icon: '🕒'
            });
        });
        
        // 3. Get hearings / calendar events matching this case
        const hearings = HearingsWatcher.loadMonitoredHearings(WATCH_DIR) || [];
        const caseHearings = hearings.filter(h => {
            if (!h.spisovaZnacka) return false;
            const spznStr = `${h.spisovaZnacka.cisloSenatu} ${h.spisovaZnacka.druhVeci} ${h.spisovaZnacka.bcVec}/${h.spisovaZnacka.rocnik}`;
            return spznStr.includes(caseNum) || caseNum.includes(spznStr);
        });
        
        caseHearings.forEach(h => {
            timeline.push({
                timestamp: h.dueDate ? `${h.dueDate}T${h.time || '10:00'}:00` : new Date().toISOString(),
                type: 'hearing',
                title: `Soudní jednání`,
                description: `${h.title} (${h.location || 'soud'}) - Stav: ${h.status.toUpperCase()}`,
                icon: '⚖️'
            });
        });
        
        // 4. Get audit logs for this case (where target matches file names or caseNum)
        const auditLogs = require('./lib/audit').loadAuditLogs() || [];
        const caseAuditLogs = auditLogs.filter(log => 
            log.target === caseNum || 
            (log.target && caseFileNames.includes(log.target))
        );
        
        caseAuditLogs.forEach(log => {
            timeline.push({
                timestamp: log.timestamp,
                type: 'audit',
                title: log.operation,
                description: `${log.user}: ${log.target}`,
                icon: '📜'
            });
        });
        
        // Sort timeline descending by timestamp
        timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({ success: true, timeline });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst timeline spisu: ${err.message}` });
    }
});


// POST /api/inbox/delete - Delete document from index and physically from disk
app.post('/api/inbox/delete', async (req, res) => {
    const { fileName } = req.body;
    if (!fileName) {
        return res.status(400).json({ error: "Název souboru je povinný." });
    }
    
    try {
        const inbox = await loadInbox();
        let key = fileName;
        if (!inbox.files[key]) {
            // Find key by matching relativePath or basename
            const foundKey = Object.keys(inbox.files || {}).find(k => k === fileName || path.basename(k) === fileName);
            if (foundKey) key = foundKey;
        }
        
        if (inbox.files[key]) {
            const fileData = inbox.files[key];
            
            // Delete physical file if it exists
            if (fileData.filePath && fs.existsSync(fileData.filePath)) {
                try {
                    fs.unlinkSync(fileData.filePath);
                    console.log(`🗑️ Fyzický soubor smazán: ${fileData.filePath}`);
                } catch (e) {
                    console.warn(`⚠️ Nelze smazat fyzický soubor: ${fileData.filePath}`, e.message);
                }
            }
            
            // Clear from local RAG vector index (checks relativePath or key)
            const indexKey = fileData.relativePath || key;
            try {
                await deleteDocumentIndex(indexKey);
            } catch (err) {
                console.error(`❌ RAG: Nelze odstranit index pro ${indexKey}:`, err.message);
            }
            
            delete inbox.files[key];
            await saveInbox(inbox);
            res.json({ success: true, message: `Soubor ${fileName} byl kompletně smazán z indexu i disku.` });
        } else {
            res.status(404).json({ error: "Soubor nebyl nalezen v indexu." });
        }
    } catch (err) {
        res.status(500).json({ error: `Chyba při mazání souboru: ${err.message}` });
    }
});

// POST /api/inbox/upload - Save uploaded file base64 directly to WATCH_DIR
app.post('/api/inbox/upload', async (req, res) => {
    const { fileName, base64 } = req.body;
    if (!fileName || !base64) {
        return res.status(400).json({ error: "Název souboru a base64 obsah jsou povinné." });
    }
    
    let filePath;
    try {
        filePath = safePathInWatchDir(fileName);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    try {
        // Clean base64 prefix if present
        const base64Data = base64.replace(/^data:.*?;base64,/, "");

        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(filePath, buffer);
        console.log(`📥 Nahraný soubor uložen na disk: ${filePath}`);
        
        // Trigger manual file processing immediately
        try {
            await processDocument(filePath);
        } catch (procErr) {
            console.warn(`⚠️ Watcher: Nepodařilo se vynutit okamžité zpracování souboru ${fileName}:`, procErr.message);
        }
        
        res.json({ success: true, message: `Soubor ${fileName} byl úspěšně nahrán a zařazen ke zpracování.` });
    } catch (err) {
        res.status(500).json({ error: `Chyba při nahrávání souboru: ${err.message}` });
    }
});

// GET /api/inbox/content - Retrieve parsed document text content on-demand
app.get('/api/inbox/content', async (req, res) => {
    const { fileName } = req.query;
    if (!fileName) {
        return res.status(400).json({ error: "Název souboru je povinný." });
    }
    
    try {
        const inbox = await loadInbox();
        const fileData = inbox.files[fileName];
        if (!fileData) {
            return res.status(404).json({ error: "Soubor nebyl nalezen v indexu." });
        }
        
        const filePath = fileData.filePath;
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Fyzický soubor na disku neexistuje." });
        }
        
        const ext = path.extname(filePath).toLowerCase();
        let content = "";
        
        if (ext === '.pdf') {
            const pdf = require('pdf-parse');
            const dataBuffer = await fs.promises.readFile(filePath);
            const parsedPdf = await pdf(dataBuffer);
            content = parsedPdf.text;
        } else {
            content = await fs.promises.readFile(filePath, 'utf-8');
        }
        
        res.json({
            fileName: fileName,
            content: content
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při čtení obsahu spisu: ${err.message}` });
    }
});

// POST /api/inbox/parse-test - Generate mock legal document for sanity and user testing
app.post('/api/inbox/parse-test', async (req, res) => {
    try {
        const testFilePath = path.join(WATCH_DIR, 'testovaci_soudni_spis.txt');
        const sampleContent = `OKRESNÍ SOUD V BRNĚ
Polní 994/39, 608 00 Brno

spisová značka: 23 C 120/2026-14

Žalobce: Jan Novák, nar. 1. 1. 1980, bytem Veselá 12, Brno
Žalovaný: PRIMA s.r.o., IČO: 12345678, se sídlem Nádražní 5, Brno

USNESENÍ

Soud vyzývá žalovaného, aby se ve lhůtě 15 dnů od doručení tohoto usnesení písemně vyjádřil k podané žalobě. Pokud se bez vážného důvodu nevyjádříte, má se za to, že nárok žalobce uznáváte.`;
        
        await fs.promises.writeFile(testFilePath, sampleContent, 'utf-8');
        await processDocument(testFilePath);
        
        res.json({ success: true, message: "Testovací dokument byl úspěšně vygenerován a naimportován do schránky." });
    } catch (err) {
        res.status(500).json({ error: `Chyba při generování testovacího spisu: ${err.message}` });
    }
});

// GET /api/registry/check - Check subject against ARES and ISIR public registries
app.get('/api/registry/check', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný parametr." });
    }
    
    try {
        const result = await checkSubject(ico);
        if (result.error) {
            return res.status(400).json({ error: result.error });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Chyba při lustraci subjektu: ${err.message}` });
    }
});


// POST /api/campaigns/validate-recipients - Validate a list of ICOs
app.post('/api/campaigns/validate-recipients', async (req, res) => {
    const { icos } = req.body;
    if (!icos || !Array.isArray(icos)) {
        return res.status(400).json({ error: "Parametr 'icos' musí být pole." });
    }
    
    try {
        const results = await Promise.all(icos.map(async (ico) => {
            const cleanIco = ico.replace(/\s+/g, '').replace(/[^0-9]/g, '').trim();
            if (!cleanIco || cleanIco.length !== 8) {
                return { ico, error: "Neplatný formát IČO (musí mít 8 číslic)." };
            }
            try {
                const checked = await checkSubject(cleanIco);
                if (checked.error) {
                    return { ico: cleanIco, error: checked.error };
                }
                // POZOR: toto NENÍ reálné ISDS ID — je odvozené z IČO jako placeholder.
                // isdsSimulated:true označuje, že datovou schránku je nutné před
                // odesláním ověřit v oficiálním registru (nesmí se doručovat naslepo).
                const cleanName = checked.name.toLowerCase();
                let isdsId = "";
                if (cleanName.includes("banka") || cleanName.includes("spořitelna")) {
                    isdsId = `b${cleanIco.substring(0, 6)}`;
                } else if (cleanName.includes("exekut")) {
                    isdsId = `e${cleanIco.substring(0, 6)}`;
                } else {
                    isdsId = `d${cleanIco.substring(0, 6)}`;
                }
                return {
                    ...checked,
                    isdsId,
                    isdsSimulated: true
                };
            } catch (err) {
                return { ico: cleanIco, error: err.message };
            }
        }));
        res.json({ results });
    } catch (err) {
        res.status(500).json({ error: `Chyba při hromadné lustraci: ${err.message}` });
    }
});

// POST /api/campaigns/send - Mock sending data messages and schedule calendar reminders
app.post('/api/campaigns/send', async (req, res) => {
    const { clientName, caseNumber, recipients } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: "Příjemci jsou povinní." });
    }
    
    try {
        const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
        if (!fs.existsSync(CALENDAR_DIR)) {
            fs.mkdirSync(CALENDAR_DIR, { recursive: true });
        }
        
        const results = [];
        
        for (const recipient of recipients) {
            const { ico, name, isdsId, text } = recipient;
            
            // 1. Log simulation in audit
            logEvent('LexisEditor', `Hromadné obesílání - Odesláno přes ISDS`, 'Datová zpráva', {
                klient: clientName,
                spis: caseNumber,
                prijemce: name,
                ico: ico,
                isdsId: isdsId,
                status: 'Odesláno (Simulace)',
                textLength: text ? text.length : 0
            });
            
            // 2. Add alert in local database for tracking (10 days from now)
            const deadlineDate = new Date();
            deadlineDate.setDate(deadlineDate.getDate() + 10);
            
            const alertTitle = `Sledování doručenky výzvy pro: ${name}`;
            const alertDetails = `Hromadná kampaň obesílání pro klienta ${clientName || 'Neznámý'} (Spis: ${caseNumber || 'Neznámý'}). Příjemce: ${name} (IČO: ${ico}, Datová schránka: ${isdsId}).`;
            
            const alert = db.insert('alerts', {
                title: alertTitle,
                triggerRule: "Hromadné obesílání",
                status: 'pending',
                deadline: deadlineDate.toISOString(),
                payloadDetails: JSON.stringify({
                    clientName,
                    caseNumber,
                    ico,
                    name,
                    isdsId
                })
            });
            
            // 3. Generate ICS calendar file in Kalendar directory (jeden generátor s escapováním)
            const cleanId = 'camp_dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const icsContent = buildIcs({
                id: cleanId,
                title: `⚠️ LHŮTA: ${alertTitle}`,
                date: deadlineDate.toISOString().split('T')[0],
                description: alertDetails,
                alarm: true
            });

            const safeName = sanitizeFileName(alertTitle);
            const filePath = path.join(CALENDAR_DIR, `${safeName}.ics`);
            await fs.promises.writeFile(filePath, icsContent, 'utf-8');
            
            results.push({
                ico,
                name,
                isdsId,
                status: 'Simulováno (neodesláno)',
                simulated: true,
                alertId: alert.id,
                calendarFile: filePath
            });
        }

        res.json({
            success: true,
            simulated: true,
            results,
            message: `SIMULACE hromadného obesílání: ${results.length} zpráv NEBYLO reálně odesláno (chybí napojení na ISDS). Vytvořeny záznamy do logu, hlídání doručenek a kalendářní lhůty.`
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při hromadném odesílání: ${err.message}` });
    }
});


// POST /api/calendar/add - Generate standard .ics file inside LexisSpisy/Kalendar folder
app.post('/api/calendar/add', async (req, res) => {
    const { id, title, dueDate, context, time, location, isHearing, courtCode, spisovaZnacka } = req.body;
    if (!title || !dueDate) {
        return res.status(400).json({ error: "Název a datum splatnosti jsou povinné parametry." });
    }
    
    try {
        const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
        if (!fs.existsSync(CALENDAR_DIR)) {
            fs.mkdirSync(CALENDAR_DIR, { recursive: true });
        }
        
        const cleanId = id || 'dl_' + Date.now();
        const prefix = isHearing ? '⚖️ JEDNÁNÍ' : '⚠️ LHŮTA';
        const cleanTitle = `${prefix}: ${title}`;
        const cleanDesc = context || 'Detekovaná událost v systému Lexis.';

        // Jeden generátor ICS s escapováním (viz lib/ics.js)
        const icsContent = buildIcs({
            id: cleanId,
            title: cleanTitle,
            date: dueDate,
            time: time,
            location: location,
            description: cleanDesc
        });

        const safeName = sanitizeFileName(title);
        const filePath = path.join(CALENDAR_DIR, `${safeName}.ics`);
        
        await fs.promises.writeFile(filePath, icsContent, 'utf-8');
        console.log(`📅 ICS Kalendářová událost vygenerována: ${filePath}`);
        
        // Write directly to local system calendar (Apple Calendar / Outlook)
        let syncStatus = 'unsupported';
        try {
            syncStatus = await writeToSystemCalendar({
                title: cleanTitle,
                date: dueDate,
                time: time,
                location: location,
                description: cleanDesc
            });
        } catch (syncErr) {
            console.error(`⚠️ Nepodařilo se zapsat do systémového kalendáře: ${syncErr.message}`);
        }
        
        // Register the hearing for background tracking if isHearing is true
        if (isHearing && courtCode && spisovaZnacka) {
            const hearings = HearingsWatcher.loadMonitoredHearings(WATCH_DIR);
            
            // Remove any existing record with the same ID or same sp.zn + date
            const filtered = hearings.filter(h => h.id !== cleanId && !(h.courtCode === courtCode && h.dueDate === dueDate && h.spisovaZnacka.cisloSenatu === spisovaZnacka.cisloSenatu && h.spisovaZnacka.druhVeci === spisovaZnacka.druhVeci && h.spisovaZnacka.bcVec === spisovaZnacka.bcVec && h.spisovaZnacka.rocnik === spisovaZnacka.rocnik));
            
            filtered.push({
                id: cleanId,
                title: title,
                dueDate: dueDate,
                time: time,
                location: location,
                courtCode: courtCode,
                courtName: location ? location.split(',')[0] : 'Soud',
                spisovaZnacka: spisovaZnacka,
                icsFilePath: filePath,
                status: 'scheduled',
                lastChecked: new Date().toISOString()
            });
            
            HearingsWatcher.saveMonitoredHearings(WATCH_DIR, filtered);
            console.log(`⚖️ Registrováno soudní jednání pro sledování změn: sp. zn. ${spisovaZnacka.cisloSenatu} ${spisovaZnacka.druhVeci} ${spisovaZnacka.bcVec}/${spisovaZnacka.rocnik}`);
        }
        
        res.json({ success: true, filePath, syncStatus, message: "ICS soubor byl úspěšně vygenerován a synchronizován do kalendáře." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: `Chyba při generování ICS kalendáře: ${err.message}` });
    }
});

// GET /api/calendar/events - Retrieve all events (deadlines & hearings) for dashboard calendar
app.get('/api/calendar/events', async (req, res) => {
    try {
        const alerts = db.get('alerts') || [];
        const hearings = HearingsWatcher.loadMonitoredHearings(WATCH_DIR) || [];
        
        const events = [];
        
        // Add alerts (procedural tasks/deadlines)
        alerts.forEach(alert => {
            let dateVal = null;
            let timeVal = null;
            if (alert.deadline) {
                const parts = alert.deadline.split('T');
                dateVal = parts[0];
                if (parts[1]) {
                    timeVal = parts[1].substring(0, 5); // HH:MM
                }
            }
            events.push({
                id: alert.id,
                type: 'deadline',
                title: alert.title,
                date: dateVal,
                time: timeVal,
                status: alert.status,
                description: alert.triggerRule || 'Procesní lhůta',
                location: ''
            });
        });
        
        // Add monitored hearings
        hearings.forEach(hearing => {
            events.push({
                id: hearing.id,
                type: 'hearing',
                title: hearing.title,
                date: hearing.dueDate,
                time: hearing.time || '',
                status: hearing.status,
                description: `Soudní jednání - sp. zn. ${hearing.spisovaZnacka ? (hearing.spisovaZnacka.cisloSenatu + ' ' + hearing.spisovaZnacka.druhVeci + ' ' + hearing.spisovaZnacka.bcVec + '/' + hearing.spisovaZnacka.rocnik) : ''}`,
                location: hearing.location || ''
            });
        });
        
        res.json({ success: true, events });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst kalendářní události: ${err.message}` });
    }
});


// POST /api/calendar/sync - Manually trigger check of all monitored hearings
app.post('/api/calendar/sync', async (req, res) => {
    try {
        const result = await HearingsWatcher.checkAllHearings(WATCH_DIR);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: `Chyba při synchronizaci jednání: ${err.message}` });
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
    } else if (agentId === 'sekretarka') {
        return `⏰ **[Sekretářka - Lokální Fallback]**\n\nZorganizovala jsem Váš úkol a připravila podklady:\n\n**Seznam extrahovaných úkolů:**\n- 📅 **Lhůta k vyjádření:** Zkontrolovat a do 15 dnů odeslat datovou zprávu protistraně.\n- 📧 **Klientovi:** Odeslat potvrzující e-mail o převzetí zastoupení a obdržení spisu.\n- 🗂️ **Spis:** Založit fyzickou složku spisu a zařadit do archivu pod sp. zn.\n\n*Doporučení:* Nezapomeňte jedním kliknutím vygenerovat .ics soubor a importovat termín do Vašeho systémového kalendáře!`;
        } else if (agentId === 'spisovatel') {
        return `📝 **[Spisovatel - Lokální Fallback]**\n\nSestavil jsem pro Vás kompletní návrh Smlouvy o dílo podle standardů portálu POHODA a občanského zákoníku č. 89/2012 Sb. na základě zadání: *"${prompt}"*.\n\n**SMLOUVA O DÍLO**\nuzavřená podle ustanovení § 2586 a násl. zákona č. 89/2012 Sb., občanský zákoník, ve znění pozdějších předpisů.\n\n**Smluvní strany**\n\n1. **Objednatel:**\n   Název/Jméno: [Doplnit...]\n   Sídlo/Bydliště: [Doplnit...]\n   IČO: [Doplnit...]\n   DIČ: [Doplnit...]\n   Zapsaná v obchodním rejstříku: [Doplnit...] vedeném u [Doplnit...] soudu, oddíl [Doplnit...], vložka [Doplnit...]\n   Zastoupená: [Doplnit...]\n   Bankovní spojení: [Doplnit...]\n   Číslo účtu: [Doplnit...]\n   (dále jen „Objednatel“)\n\na\n\n2. **Zhotovitel:**\n   Název/Jméno: [Doplnit...]\n   Sídlo/Bydliště: [Doplnit...]\n   IČO: [Doplnit...]\n   DIČ: [Doplnit...]\n   Zapsaná v obchodním rejstříku: [Doplnit...] vedeném u [Doplnit...] soudu, oddíl [Doplnit...], vložka [Doplnit...]\n   Zastoupená: [Doplnit...]\n   Bankovní spojení: [Doplnit...]\n   Číslo účtu: [Doplnit...]\n   (dále jen „Zhotovitel“)\n\n**Článek I. Předmět smlouvy**\n1. Zhotovitel se zavazuje provést na svůj náklad a nebezpečí pro Objednatele dílo: [Doplnit specifikaci díla, např. vymalování kanceláří v sídle Objednatele], a Objednatel se zavazuje dílo převzít a zaplatit zhotovateli dohodnutou cenu za dílo.\n\n**Článek II. Doba a místo plnění**\n1. Zhotovitel se zavazuje zahájit práce na díle dne: [Doplnit...] a dílo řádně dokončit a předat Objednateli nejpozději do: [Doplnit...].\n2. Místem plnění díla je: [Doplnit...].\n\n**Článek III. Cena díla a platební podmínky**\n1. Cena za řádně provedené dílo je stanovena dohodou smluvních stran a činí celkem: [Doplnit částku, např. 50 000] Kč bez DPH. DPH bude účtována v zákonné výši.\n2. Podkladem pro zaplacení ceny díla je faktura vystavená Zhotovitelem po protokolárním předání a převzetí díla bez vad a nedodělků.\n3. Splatnost faktury činí 14 dnů ode dne jejího doručení Objednateli.\n\n**Článek IV. Provádění díla a práva a povinnosti stran**\n1. Zhotovitel je povinen provádět dílo s odbornou péčí, v souladu s platnými právními předpisy, technickými normami a pokyny Objednatele.\n2. Objednatel je povinen poskytnout Zhotovateli součinnost nezbytnou pro provádění díla, zejména mu předat pracoviště ve stavu způsobilém k zahájení prací.\n\n**Článek V. Předání a převzetí díla**\n1. Zhotovitel splní svou povinnost provést dílo jeho řádným dokončením a předáním Objednateli.\n2. O předání a převzetí díla sepíší smluvní strany písemný předávací protokol podepsaný oprávněnými zástupci obou stran.\n\n**Článek VI. Odpovědnost za vady a záruka**\n1. Zhotovitel odpovídá za to, že dílo má v době předání a po dobu záruční doby vlastnosti stanovené touto smlouvou a obecně závaznými předpisy.\n2. Zhotovitel poskytuje na dílo záruku v délce: [Doplnit, např. 24] měsíců ode dne podpisu předávacího protokolu.\n3. Objednatel je povinen reklamovat vady písemně bez zbytečného odkladu po jejich zjištění. Zhotovitel se zavazuje reklamované vady odstranit bezplatně nejpozději do [Doplnit...] dnů od doručení reklamace.\n\n**Článek VII. Smluvní pokuty a sankce**\n1. V případě prodlení Zhotovitele s dokončením a předáním díla je Objednatel oprávněn požadovat smluvní pokutu ve výši 0,1 % z ceny díla za každý den prodlení.\n2. V případě prodlení Objednatele s úhradou faktury je Zhotovitel oprávněn požadovat úrok z prodlení v zákonné výši.\n\n**Článek VIII. Závěrečná ustanovení**\n1. Jakékoliv změny či doplňky této smlouvy lze provádět pouze formou písemných, vzestupně číslovaných dodatků podepsaných oběma smluvními stranami.\n2. Tato smlouva se vyhotovuje ve dvou stejnopisech, z nichž každá strana obdrží po jednom vyhotovení.\n3. Smlouva nabývá platnosti a účinnosti dnem jejího podpisu oběma smluvními stranami.\n\nV [Doplnit...] dne [Doplnit...]              V [Doplnit...] dne [Doplnit...]\n\n\n_______________________                      _______________________\nObjednatel                                   Zhotovitel`;
    }
    return `🤖 **[Agent ${agentId}]**\n\nZpracoval jsem Váš dotaz ohledně: "${prompt}". Služba Ollama je offline, toto je záložní odpověď.`;
}

// GET /api/rag/search - Perform semantic vector search
app.get('/api/rag/search', async (req, res) => {
    const { query, limit, caseNumber, fileNames } = req.query;
    if (!query) {
        return res.status(400).json({ error: "Vyhledávací dotaz je povinný." });
    }
    const searchLimit = limit ? parseInt(limit) : 5;
    try {
        let resolvedFilters = null;
        let filterPayload = { ragFilters: {} };
        if (fileNames) {
            filterPayload.ragFilters.fileNames = fileNames.split(',').map(f => f.trim());
        }
        if (caseNumber) {
            filterPayload.ragFilters.caseNumber = caseNumber.trim();
        }
        
        if (fileNames || caseNumber) {
            resolvedFilters = await resolveRagFilters(filterPayload);
        }

        const matches = await searchSimilar(query, searchLimit, resolvedFilters);
        res.json({ query, matches });
    } catch (err) {
        res.status(500).json({ error: `Chyba sémantického vyhledávání: ${err.message}` });
    }
});

// GET /api/system/green-metrics - Aggregate energy and CO2 statistics
app.get('/api/system/green-metrics', (req, res) => {
    try {
        const greenLogs = db.get('green_logs') || [];
        const profile = getHardwareProfile();
        
        let totalEnergyWh = 0;
        let totalCo2Grams = 0;
        let totalCloudWh = 0;
        let totalCloudCo2Grams = 0;
        let totalCarbonSavedGrams = 0;
        
        greenLogs.forEach(log => {
            totalEnergyWh += log.energyWh || 0;
            totalCo2Grams += log.co2Grams || 0;
            totalCloudWh += log.cloudEquivalentWh || 0;
            totalCloudCo2Grams += log.cloudCo2Grams || 0;
            totalCarbonSavedGrams += log.carbonSavedGrams || 0;
        });
        
        const co2SavingPercent = totalCloudCo2Grams > 0 
            ? parseFloat(((totalCarbonSavedGrams / totalCloudCo2Grams) * 100).toFixed(1))
            : 0;
            
        res.json({
            hardware: profile.hardwareName,
            tdpWatts: profile.estimatedTdp,
            totalRuns: greenLogs.length,
            totalEnergyWh: parseFloat(totalEnergyWh.toFixed(5)),
            totalCo2Grams: parseFloat(totalCo2Grams.toFixed(5)),
            cloudEquivalentWh: parseFloat(totalCloudWh.toFixed(2)),
            cloudCo2Grams: parseFloat(totalCloudCo2Grams.toFixed(2)),
            carbonSavedGrams: parseFloat(totalCarbonSavedGrams.toFixed(5)),
            co2SavingPercent,
            recentRuns: greenLogs.slice(-10)
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání zelených statistik: ${err.message}` });
    }
});

// GET /api/system/export - Secure de-crypted data export for GDPR portability (Article 20)
app.get('/api/system/export', async (req, res) => {
    try {
        const inbox = await loadInbox();
        const exportData = {
            metadata: {
                system: "LexisLocal",
                version: require('../package.json').version || "1.0.0",
                exportedAt: new Date().toISOString(),
                totalInboxFiles: Object.keys(inbox.files || {}).length
            },
            database: {
                activities: db.get('activities') || [],
                timesheets: db.get('timesheets') || [],
                workflows: db.get('workflows') || [],
                conflicts: db.get('conflicts') || [],
                alerts: db.get('alerts') || [],
                email_settings: db.get('email_settings') || [],
                email_tasks: db.get('email_tasks') || [],
                green_logs: db.get('green_logs') || [],
                transparency_logs: db.get('transparency_logs') || []
            },
            inbox: inbox.files || {}
        };
        
        res.setHeader('Content-disposition', `attachment; filename=lexis_export_${new Date().toISOString().slice(0, 10)}.json`);
        res.setHeader('Content-type', 'application/json');
        res.write(JSON.stringify(exportData, null, 2));
        res.end();
    } catch (err) {
        res.status(500).json({ error: `Chyba při exportu dat: ${err.message}` });
    }
});

// GET /api/audit/transparency/verify - Verify cryptographic blockchain integrity of ledger
app.get('/api/audit/transparency/verify', (req, res) => {
    try {
        const result = db.verifyLedger();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Chyba při ověřování ledgeru: ${err.message}` });
    }
});

// GET /api/audit/transparency - Retrieve AI Act Transparency Ledger
app.get('/api/audit/transparency', (req, res) => {
    try {
        const logs = db.get('transparency_logs') || [];
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání transparentního ledgeru: ${err.message}` });
    }
});

// POST /api/audit/transparency/:id/approve - Human-in-the-loop review approval
app.post('/api/audit/transparency/:id/approve', (req, res) => {
    const { id } = req.params;
    try {
        const updated = db.update('transparency_logs', id, {
            humanApproved: true,
            approvedAt: new Date().toISOString()
        });
        
        if (updated) {
            res.json({ success: true, message: `Rozhodnutí AI ID ${id} bylo schváleno lidským dohledem.`, record: updated });
        } else {
            res.status(404).json({ error: `Záznam s ID ${id} nebyl nalezen.` });
        }
    } catch (err) {
        res.status(500).json({ error: `Chyba při schvalování záznamu: ${err.message}` });
    }
});

// POST /api/system/rotate-key - Rotate database encryption key
app.post('/api/system/rotate-key', (req, res) => {
    try {
        const success = db.rotateEncryptionKey();
        if (success) {
            res.json({ success: true, message: "Lokální šifrovací klíč byl úspěšně rotován a databáze byla přešifrována." });
        } else {
            res.status(500).json({ error: "Rotace klíče selhala. Podrobnosti v serverovém logu." });
        }
    } catch (err) {
        res.status(500).json({ error: `Chyba při rotaci klíče: ${err.message}` });
    }
});

// GET /api/system/models/sovereign - Get and prioritize local European/Czech models
app.get('/api/system/models/sovereign', async (req, res) => {
    try {
        // Query local Ollama installation for available models
        const localModelsResponse = await ollama.list();
        const availableTags = (localModelsResponse.models || []).map(m => m.name);
        
        // Preferred European & open-source sovereign models ordered by preference
        const preferredSovereignModels = [
            'mistral:latest',
            'mistral',
            'mixtral',
            'gemma2:2b',
            'gemma2',
            'llama3-czech',
            'llama3'
        ];
        
        const matched = preferredSovereignModels.filter(pref => 
            availableTags.some(tag => tag.toLowerCase().startsWith(pref.toLowerCase()) || pref.toLowerCase().startsWith(tag.toLowerCase()))
        );
        
        res.json({
            sovereignPreferred: preferredSovereignModels,
            availableLocal: availableTags,
            matchedSovereign: matched,
            recommendedActive: matched[0] || 'llama3'
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při zjišťování suverénních modelů: ${err.message}` });
    }
});

// GET /api/system/telemetry - Retrieve system performance & VRAM telemetry
app.get('/api/system/telemetry', (req, res) => {
    try {
        const stats = getSystemTelemetry();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání systémové telemetrie: ${err.message}` });
    }
});

// POST /api/document/archive - Generate Dublin Core XML metadata descriptor for PDF/A
app.post('/api/document/archive', (req, res) => {
    const { title, creator, subject, description, type, language, rights } = req.body;
    try {
        const xml = generateDublinCoreXml({
            title,
            creator,
            subject,
            description,
            type,
            language,
            rights
        });
        
        res.setHeader('Content-type', 'application/xml');
        res.write(xml);
        res.end();
    } catch (err) {
        res.status(500).json({ error: `Chyba při generování metadat pro archivaci: ${err.message}` });
    }
});

// POST /api/document/anonymize - Anonymize text containing GDPR sensitive terms
app.post('/api/document/anonymize', (req, res) => {
    const { text } = req.body;
    if (text === undefined) {
        return res.status(400).json({ error: "Text k anonymizaci je povinný." });
    }
    try {
        const anonymized = anonymizeText(text);
        res.json({ anonymized });
    } catch (err) {
        res.status(500).json({ error: `Chyba při anonymizaci: ${err.message}` });
    }
});

// GET /api/registries/check - Query all registries for an ICO
app.get('/api/registries/check', async (req, res) => {
    const { ico } = req.query;
    if (!ico) {
        return res.status(400).json({ error: "IČO je povinný údaj." });
    }
    try {
        const result = await checkSubject(ico);
        
        // Add Simulated Executions (CEE) and Simulated Cadastre (Katastr) for full professional coverage
        const cleanIco = ico.replace(/\s+/g, '').trim();
        const lastDigit = parseInt(cleanIco.slice(-1)) || 0;
        
        // CEE Simulation based on deterministic seed (ICO last digit)
        // simulated:true je strojově čitelný příznak — frontend NESMÍ tato data
        // prezentovat jako ověřená (jde o odhad, ne o reálné dotazy do CEE).
        if (lastDigit % 3 === 0) {
            result.cee = {
                simulated: true,
                activeExecutions: 2,
                totalAmount: 184500,
                disclaimer: "SIMULOVÁNO (neověřeno) z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        } else {
            result.cee = {
                simulated: true,
                activeExecutions: 0,
                totalAmount: 0,
                disclaimer: "SIMULOVÁNO (neověřeno) z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        }

        // Katastr Simulation based on seed
        result.katastr = {
            simulated: true,
            propertiesCount: lastDigit % 2 === 0 ? 1 : 0,
            hasPlomba: lastDigit % 4 === 0,
            disclaimer: "SIMULOVÁNO (neověřeno) z Katastru nemovitostí (dálkový přístup)."
        };
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Lustrace selhala: ${err.message}` });
    }
});

// POST /api/registries/save-report - Save structured registry audit to Desktop case directory
app.post('/api/registries/save-report', async (req, res) => {
    const { ico, name, reportText, caseNumber } = req.body;
    if (!ico || !name || !reportText) {
        return res.status(400).json({ error: "Chybí povinná data pro uložení prověrky." });
    }
    
    // IČO smí obsahovat pouze číslice (obrana proti path traversal přes ico).
    const cleanIco = String(ico).replace(/\D/g, '').slice(0, 12);
    if (!cleanIco) {
        return res.status(400).json({ error: "Neplatné IČO." });
    }

    try {
        const cleanName = name.replace(/[^a-zA-Z0-9čšžýáíéóúůďťňĎŤŇČŠŽÝÁÍÉÓÚŮ\s-_]/g, '').replace(/\s+/g, '_');
        const fileName = `Proverka_${cleanName}_${cleanIco}.txt`;
        const filePath = safePathInWatchDir(fileName);

        await fs.promises.writeFile(filePath, reportText, 'utf-8');
        console.log(`📥 Lustrační centrum: Uložena nová prověrka do: ${filePath}`);
        
        res.json({ success: true, fileName, filePath });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se uložit prověrku: ${err.message}` });
    }
});

// GET /api/alerts - Retrieve active insolvency alerts
app.get('/api/alerts', async (req, res) => {
    try {
        const inbox = await loadInbox();
        const activeAlerts = (inbox.alerts || []).filter(a => a.status === 'active');
        res.json({ alerts: activeAlerts });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se získat upozornění: ${err.message}` });
    }
});

// POST /api/alerts/check - Manually trigger background insolvency verification for all IČOs
app.post('/api/alerts/check', async (req, res) => {
    try {
        const stats = await checkAllInsolvencies();
        res.json({ success: true, ...stats });
    } catch (err) {
        res.status(500).json({ error: `Hromadná prověrka insolvencí selhala: ${err.message}` });
    }
});

// POST /api/alerts/dismiss/:alertId - Dismiss/mute an active alert
app.post('/api/alerts/dismiss/:alertId', async (req, res) => {
    const { alertId } = req.params;
    try {
        const inbox = await loadInbox();
        if (inbox.alerts) {
            inbox.alerts = inbox.alerts.map(a => {
                if (a.id === alertId) {
                    return { ...a, status: 'dismissed', dismissedAt: new Date().toISOString() };
                }
                return a;
            });
            await saveInbox(inbox);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se skrýt upozornění: ${err.message}` });
    }
});

// GET /api/rag/status - Retrieve vector database size and metrics
app.get('/api/rag/status', async (req, res) => {
    try {
        const index = await loadIndex();
        const uniqueFiles = new Set(index.chunks.map(c => c.fileName));
        res.json({
            chunksCount: index.chunks.length,
            filesCount: uniqueFiles.size,
            embeddingModel: 'nomic-embed-text'
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při čtení stavu RAG: ${err.message}` });
    }
});

// POST /api/rag/reindex-all - Reindex all documents from inbox on-demand
app.post('/api/rag/reindex-all', async (req, res) => {
    console.log("⚡ RAG: Spouštím kompletní re-indexaci všech souborů...");
    try {
        const inbox = await loadInbox();
        const files = Object.values(inbox.files);
        
        let successCount = 0;
        for (const file of files) {
            if (file.filePath && fs.existsSync(file.filePath)) {
                let content = "";
                const ext = path.extname(file.filePath).toLowerCase();
                try {
                    if (ext === '.pdf') {
                        const pdfParser = require('pdf-parse');
                        const dataBuffer = await fs.promises.readFile(file.filePath);
                        const parsedPdf = await pdfParser(dataBuffer);
                        content = parsedPdf.text;
                    } else {
                        content = await fs.promises.readFile(file.filePath, 'utf-8');
                    }
                    if (content && content.trim()) {
                        await indexDocument(file.relativePath || file.fileName, content);
                        successCount++;
                    }
                } catch (parseErr) {
                    console.warn(`⚠️ RAG: Přeskakuji soubor ${file.fileName} kvůli chybě:`, parseErr.message);
                }
            }
        }
        logEvent('LexisLocal Dashboard', 'Re-indexace spisy', 'Všechny spisy', {
            successCount
        });

        res.json({
            success: true,
            message: `Re-indexace dokončena. Úspěšně přegenerováno ${successCount} z ${files.length} souborů.`
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při re-indexaci: ${err.message}` });
    }
});

// GET /api/audit/logs - Retrieve audit trail log events
app.get('/api/audit/logs', (req, res) => {
    const { loadAuditLogs } = require('./lib/audit');
    try {
        const logs = loadAuditLogs();
        res.json({ success: true, logs: logs.reverse() }); // return newest first
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst auditní logy: ${err.message}` });
    }
});

// POST /api/audit/clear - Clear all audit trail log events
app.post('/api/audit/clear', async (req, res) => {
    try {
        // Delegace do audit modulu — používá stejnou cestu jako zápis logu,
        // takže se nemůže smazat jiný soubor kvůli odlišnému výpočtu WATCH_DIR.
        clearAuditLogs();
        logEvent('LexisLocal Dashboard', 'Pročištění logů', 'Audit Trail', { cleared: true });
        res.json({ success: true, message: "Auditní logy byly vyčištěny." });
    } catch (err) {
        res.status(500).json({ error: `Nelze vyčistit logy: ${err.message}` });
    }
});

// POST /api/watcher/toggle - Toggle dynamic Desktop Spisy folder watching activity state
app.post('/api/watcher/toggle', (req, res) => {
    const { active } = req.query;
    const isActive = active === 'true';
    setWatcherState(isActive);
    res.json({ success: true, active: isActive });
});

// GET /api/agents - List all active agents
app.get('/api/agents', (req, res) => {
    try {
        const agents = loadAgents();
        res.json({ success: true, agents: Object.values(agents) });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst agenty: ${err.message}` });
    }
});

// POST /api/agents/:agentId - Update an agent
app.post('/api/agents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const { name, emoji, role, systemPrompt, preferredModel, permissions } = req.body;
    try {
        const updated = saveAgent(agentId, { name, emoji, role, systemPrompt, preferredModel, permissions });
        logEvent('LexisLocal Dashboard', `Úprava agenta (${updated.name})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, agent: updated });
    } catch (err) {
        res.status(500).json({ error: `Nelze upravit agenta: ${err.message}` });
    }
});

// POST /api/agents - Create a new custom agent
app.post('/api/agents', (req, res) => {
    const { id, name, emoji, role, systemPrompt, preferredModel, permissions } = req.body;
    if (!id || !name) {
        return res.status(400).json({ error: "ID a název agenta jsou povinné údaje." });
    }
    const cleanId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').trim();
    try {
        const agents = loadAgents();
        if (agents[cleanId]) {
            return res.status(400).json({ error: `Agent s ID "${cleanId}" již existuje.` });
        }
        const created = saveAgent(cleanId, { name, emoji, role, systemPrompt, preferredModel, permissions });
        logEvent('LexisLocal Dashboard', `Vytvoření agenta (${created.name})`, 'AI Konfigurace', { agentId: cleanId });
        res.json({ success: true, agent: created });
    } catch (err) {
        res.status(500).json({ error: `Nelze vytvořit agenta: ${err.message}` });
    }
});

// DELETE /api/agents/:agentId - Delete a custom agent
app.delete('/api/agents/:agentId', (req, res) => {
    const { agentId } = req.params;
    try {
        deleteAgent(agentId);
        logEvent('LexisLocal Dashboard', `Smazání agenta (${agentId})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, message: `Agent ${agentId} byl smazán.` });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// POST /api/agents/:agentId/reset - Reset system agent back to default
app.post('/api/agents/:agentId/reset', (req, res) => {
    const { agentId } = req.params;
    try {
        const reseted = resetAgentToDefault(agentId);
        logEvent('LexisLocal Dashboard', `Reset agenta (${reseted.name})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, agent: reseted });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ─── E-mailové úkoly a AI Asistenti ──────────────────────────────────────────────

// GET /api/email/settings - Načíst nastavení IMAP/SMTP a autorizovaného odesílatele
app.get('/api/email/settings', (req, res) => {
    try {
        const settingsList = db.get('email_settings') || [];
        const currentSettings = settingsList.length > 0 ? settingsList[0] : {
            authorized_sender: 'advokat@dias.cz',
            recipient_filter: 'dias+asistenti@advokatnikancelar.cz',
            imap_host: 'imap.advokatnikancelar.cz',
            imap_port: '993',
            imap_user: 'dias@advokatnikancelar.cz',
            imap_ssl: true,
            smtp_host: 'smtp.advokatnikancelar.cz',
            smtp_port: '465',
            smtp_user: 'dias@advokatnikancelar.cz',
            smtp_ssl: true
        };
        res.json({ success: true, settings: currentSettings });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst nastavení e-mailu: ${err.message}` });
    }
});

// POST /api/email/settings - Uložit nastavení
app.post('/api/email/settings', (req, res) => {
    try {
        const newSettings = req.body;
        const settingsList = db.get('email_settings') || [];
        if (settingsList.length > 0) {
            db.update('email_settings', settingsList[0].id, newSettings);
        } else {
            db.insert('email_settings', newSettings);
        }
        logEvent('LexisLocal Dashboard', 'Uložení nastavení e-mailu', 'AI Konfigurace');
        res.json({ success: true, message: "Nastavení e-mailu bylo uloženo." });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit nastavení e-mailu: ${err.message}` });
    }
});

// GET /api/email/tasks - Seznam všech doručených/zpracovaných úkolů
app.get('/api/email/tasks', (req, res) => {
    try {
        const tasks = db.get('email_tasks') || [];
        const sorted = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, tasks: sorted });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst e-mailové úkoly: ${err.message}` });
    }
});

// DELETE /api/email/tasks/:id - Smazat úkol z historie
app.delete('/api/email/tasks/:id', (req, res) => {
    const { id } = req.params;
    try {
        db.delete('email_tasks', id);
        logEvent('LexisLocal Dashboard', 'Smazání e-mailového úkolu', 'E-mailové úkoly', { id });
        res.json({ success: true, message: "E-mailový úkol byl smazán." });
    } catch (err) {
        res.status(500).json({ error: `Nelze smazat úkol: ${err.message}` });
    }
});

// POST /api/email/simulate - Simulace příchozího e-mailu od advokáta
app.post('/api/email/simulate', async (req, res) => {
    const { sender, subject, body } = req.body;
    
    if (!sender || !subject || !body) {
        return res.status(400).json({ error: "Odesílatel, předmět a obsah e-mailu jsou povinné." });
    }
    
    try {
        // 1. Ověření autorizovaného odesílatele
        const settingsList = db.get('email_settings') || [];
        const settings = settingsList.length > 0 ? settingsList[0] : {
            authorized_sender: 'advokat@dias.cz'
        };
        
        if (settings && settings.authorized_sender) {
            const cleanSender = sender.trim().toLowerCase();
            const cleanAuthorized = settings.authorized_sender.trim().toLowerCase();
            if (cleanSender !== cleanAuthorized) {
                return res.status(403).json({ 
                    error: `❌ Přístup odepřen: Odesílatel "${sender}" není autorizovaným e-mailem advokáta (${settings.authorized_sender}).` 
                });
            }
        }
        
        // 2. Výběr příslušného asistenta
        const agents = loadAgents();
        let selectedAgentId = null;
        
        // A. Detekce podle předmětu v hranatých závorkách (např. [Spisovatel] nebo [Kontrolor])
        const subjectMatch = subject.match(/\[([^\]]+)\]/);
        if (subjectMatch) {
            const agentNameOrId = subjectMatch[1].trim().toLowerCase();
            const foundAgent = Object.values(agents).find(a => 
                a.id.toLowerCase() === agentNameOrId || 
                a.name.toLowerCase() === agentNameOrId
            );
            if (foundAgent) {
                selectedAgentId = foundAgent.id;
            }
        }
        
        // B. Detekce podle tagu na začátku těla zprávy (např. @kontrolor nebo @spisovatel)
        if (!selectedAgentId) {
            const bodyMention = body.trim().match(/^@([a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+)/);
            if (bodyMention) {
                const agentNameOrId = bodyMention[1].trim().toLowerCase();
                const foundAgent = Object.values(agents).find(a => 
                    a.id.toLowerCase() === agentNameOrId || 
                    a.name.toLowerCase() === agentNameOrId
                );
                if (foundAgent) {
                    selectedAgentId = foundAgent.id;
                }
            }
        }
        
        // C. Detekce podle klíčových slov v obsahu
        if (!selectedAgentId) {
            const normalizedText = (subject + ' ' + body).toLowerCase();
            
            if (/oponent|kontrola|revize|posouzen|audit|chyb|rizik/i.test(normalizedText)) {
                selectedAgentId = 'kontrolor';
            } else if (/smlouv|dopis|sepsat|žalob|podán|draft|vytvoř/i.test(normalizedText)) {
                selectedAgentId = 'spisovatel';
            } else if (/rešerš|judikat|vyhled|analýz|paragraf|zákon/i.test(normalizedText)) {
                selectedAgentId = 'resersnik';
            } else if (/styl|přeps|úprav|formul/i.test(normalizedText)) {
                selectedAgentId = 'stylista';
            } else {
                selectedAgentId = 'sekretarka'; // Výchozí
            }
        }
        
        // Získat objekt asistenta (pokud neexistuje, fallback na sekretářku)
        const agent = agents[selectedAgentId] || agents['sekretarka'];
        const selectedModel = agent.preferredModel || "llama3";
        
        console.log(`📧 E-mail doručen. Zpracovává asistent: [${agent.name}] přes model [${selectedModel}]`);
        
        // 3. Generování odpovědi od asistenta
        let replyText = "";
        const cleanBody = body.replace(/^@[a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+\s*/, ''); // Odstranit případný tag z těla
        
        try {
            // GDPR: tělo e-mailu se před odesláním do modelu anonymizuje.
            const response = await ollama.chat({
                model: selectedModel,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: anonymizeText(cleanBody) }
                ],
                options: {
                    temperature: 0.3
                }
            });
            replyText = response.message.content;
        } catch (ollamaErr) {
            console.warn(`⚠️ E-mail: Selhalo spojení s Ollama (${ollamaErr.message}). Používám robustní fallback.`);
            replyText = generateAgentFallback(agent.id, cleanBody);
        }
        
        // Formátování kompletní e-mailové odpovědi advokátovi
        const dateStr = new Date().toLocaleDateString('cs-CZ', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const fullReply = `Vážený pane doktore,

k Vašemu e-mailovému zadání ze dne ${dateStr} ohledně předmětu "${subject.replace(/\[[^\]]+\]\s*/g, '')}" Vám zasílám požadovaný výstup.

S úctou,
Vaše AI asistentka (${agent.name} ${agent.emoji})

--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
VÝSTUP ASISTENTA:
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

${replyText}`;

        // 4. Uložení do databáze
        const taskItem = {
            sender: sender.trim(),
            subject: subject.trim(),
            body: body.trim(),
            assignedAgentId: agent.id,
            assignedAgentName: agent.name,
            assignedAgentEmoji: agent.emoji,
            responseSent: fullReply,
            status: 'completed'
        };
        
        const createdTask = db.insert('email_tasks', taskItem);
        
        // Logování do historie dashboardu
        logEvent('LexisLocal Dashboard', `E-mailový úkol pro asistenta: ${agent.name}`, 'E-mailové úkoly', { 
            id: createdTask.id,
            agentId: agent.id,
            subject: subject 
        });
        
        res.json({ 
            success: true, 
            task: createdTask, 
            message: "E-mail byl úspěšně zpracován asistentem a odpověď odeslána zpět." 
        });
        
    } catch (err) {
        console.error("Chyba zpracování e-mailového úkolu:", err);
        res.status(500).json({ error: `Chyba při zpracování úkolu: ${err.message}` });
    }
});

// --- PAPERLESS-NGX INTEGRATION WEBHOOK ---
const { handlePaperlessWebhook } = require('./lib/paperless');

app.post('/api/paperless/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const result = await handlePaperlessWebhook(payload);
        res.json({ success: true, file: result });
    } catch (err) {
        console.error("❌ Paperless Webhook Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

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
    // Bezpečnostní posture při startu (ať je jasné, co je a není zapnuté).
    console.log(`🔐 Vazba: ${BIND_HOST}${LOOPBACK_ONLY ? ' (jen loopback — nedostupné z LAN)' : ' (POZOR: dostupné z LAN)'}`);
    if (!API_TOKEN) {
        console.warn('⚠️  API_TOKEN není nastaven — per-request autentizace je vypnutá. '
            + 'Backend je sice vázán jen na loopback, ale pro plnou ochranu nastav API_TOKEN '
            + '(env) a stejný token vlož do nastavení editoru i dashboardu (hlavička X-API-Token).');
    } else {
        console.log('🔐 API_TOKEN je nastaven — per-request autentizace je zapnutá.');
    }
    if (USE_HTTPS && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        try {
            const https = require('https');
            const sslOptions = {
                key: fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH)
            };
            https.createServer(sslOptions, app).listen(PORT, BIND_HOST, () => {
                console.log(`🚀🔒 LexisLocal AI ZABEZPEČENÝ backend (HTTPS) běží na https://${BIND_HOST}:${PORT}`);
            });
        } catch (httpsErr) {
            console.error("❌ Nepodařilo se spustit HTTPS server, padám zpět na HTTP:", httpsErr.message);
            app.listen(PORT, BIND_HOST, () => {
                console.log(`🚀 LexisLocal AI backend běží na http://${BIND_HOST}:${PORT}`);
            });
        }
    } else {
        if (USE_HTTPS) {
            console.warn(`⚠️ V konfiguraci je vyžadováno HTTPS, ale chybí soubory certifikátu (${SSL_KEY_PATH} / ${SSL_CERT_PATH}). Spouštím na HTTP.`);
        }
        app.listen(PORT, BIND_HOST, () => {
            console.log(`🚀 LexisLocal AI backend běží na http://${BIND_HOST}:${PORT}`);
        });
    }
}

module.exports = app;
