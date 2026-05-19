require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { WATCH_DIR, loadInbox, saveInbox, processDocument, setWatcherState, checkAllInsolvencies } = require('./lib/watcher');
const { checkSubject } = require('./lib/registries');
const { indexDocument, deleteDocumentIndex, searchSimilar, loadIndex } = require('./lib/rag');
const { logEvent } = require('./lib/audit');
const { loadAgents, saveAgent, deleteAgent, resetAgentToDefault } = require('./lib/agents');
const ChiefOrchestrator = require('./lib/orchestrator');
const db = require('./lib/database');
const TimeTracker = require('./lib/timetracking');
const WorkflowEngine = require('./lib/workflow');
const ConflictDetector = require('./lib/conflicts');
const JudikaturaWatcher = require('./lib/judikatura');
const ManagerialIntelligence = require('./lib/managerial');

// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
        const messages = [
            { role: 'system', content: agent.systemPrompt }
        ];
        
        // Retrieve relevant historical context from RAG memory
        try {
            const matches = await searchSimilar(prompt, 3);
            const highConfidenceMatches = matches.filter(m => m.score >= 0.70);
            
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
        
        logEvent('LexisEditor', `AI Agent (${agent.name})`, 'Generování textu', {
            model: selectedModel,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: response.message.content.length,
            durationMs: Date.now() - startTime
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
        
        logEvent('LexisEditor', `AI Agent Fallback (${agent.name})`, 'Generování textu (Fallback)', {
            model: `${selectedModel} (Simulovaný)`,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: fallbackResponse.length,
            durationMs: Date.now() - startTime
        });

        res.json({
            agent: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            response: fallbackResponse,
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
        const matches = await searchSimilar(prompt, 3);
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
        const result = await ChiefOrchestrator.orchestrate(prompt, context || "", selectedModel);
        
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

// POST /api/activity/log - Log active heartbeat from LexisEditor
app.post('/api/activity/log', (req, res) => {
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

// GET /api/inbox - Retrieve unread parsed documents
app.get('/api/inbox', (req, res) => {
    try {
        const inbox = loadInbox();
        const unreadFiles = Object.values(inbox.files).filter(f => f.status === 'unread');
        res.json({
            inbox: unreadFiles
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání doručené pošty: ${err.message}` });
    }
});

// POST /api/inbox/mark-read - Mark parsed document as read
app.post('/api/inbox/mark-read', (req, res) => {
    const { fileName } = req.body;
    if (!fileName) {
        return res.status(400).json({ error: "Název souboru je povinný." });
    }
    
    try {
        const inbox = loadInbox();
        if (inbox.files[fileName]) {
            inbox.files[fileName].status = 'read';
            saveInbox(inbox);
            res.json({ success: true, message: `Soubor ${fileName} byl označen za vyřízený.` });
        } else {
            res.status(404).json({ error: "Soubor nebyl nalezen." });
        }
    } catch (err) {
        res.status(500).json({ error: `Chyba: ${err.message}` });
    }
});

// GET /api/inbox/all - Retrieve all parsed documents (both read and unread)
app.get('/api/inbox/all', (req, res) => {
    try {
        const inbox = loadInbox();
        res.json({
            inbox: Object.values(inbox.files)
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při načítání kompletní doručené pošty: ${err.message}` });
    }
});

// POST /api/inbox/delete - Delete document from index and physically from disk
app.post('/api/inbox/delete', async (req, res) => {
    const { fileName } = req.body;
    if (!fileName) {
        return res.status(400).json({ error: "Název souboru je povinný." });
    }
    
    try {
        const inbox = loadInbox();
        if (inbox.files[fileName]) {
            const fileData = inbox.files[fileName];
            
            // Delete physical file if it exists
            if (fileData.filePath && fs.existsSync(fileData.filePath)) {
                try {
                    fs.unlinkSync(fileData.filePath);
                    console.log(`🗑️ Fyzický soubor smazán: ${fileData.filePath}`);
                } catch (e) {
                    console.warn(`⚠️ Nelze smazat fyzický soubor: ${fileData.filePath}`, e.message);
                }
            }
            
            // Clear from local RAG vector index
            try {
                await deleteDocumentIndex(fileName);
            } catch (err) {
                console.error(`❌ RAG: Nelze odstranit index pro ${fileName}:`, err.message);
            }
            
            delete inbox.files[fileName];
            saveInbox(inbox);
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
    
    try {
        const filePath = path.join(WATCH_DIR, fileName);
        
        // Clean base64 prefix if present
        const base64Data = base64.replace(/^data:.*?;base64,/, "");
        
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
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
        const inbox = loadInbox();
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
            const dataBuffer = fs.readFileSync(filePath);
            const parsedPdf = await pdf(dataBuffer);
            content = parsedPdf.text;
        } else {
            content = fs.readFileSync(filePath, 'utf-8');
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
        
        fs.writeFileSync(testFilePath, sampleContent, 'utf-8');
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

// Helper function to sanitize calendar file names
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9_á-žÁ-Ž]/g, '_').substring(0, 100);
}

// POST /api/calendar/add - Generate standard .ics file inside LexisSpisy/Kalendar folder
app.post('/api/calendar/add', async (req, res) => {
    const { id, title, dueDate, context } = req.body;
    if (!title || !dueDate) {
        return res.status(400).json({ error: "Název a datum splatnosti jsou povinné parametry." });
    }
    
    try {
        const CALENDAR_DIR = path.join(WATCH_DIR, 'Kalendar');
        if (!fs.existsSync(CALENDAR_DIR)) {
            fs.mkdirSync(CALENDAR_DIR, { recursive: true });
        }
        
        const cleanId = id || 'dl_' + Date.now();
        const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const startDate = dueDate.replace(/-/g, '');
        
        const endD = new Date(dueDate);
        endD.setDate(endD.getDate() + 1);
        const endDate = endD.toISOString().split('T')[0].replace(/-/g, '');
        
        const cleanTitle = `⚠️ LHŮTA: ${title}`;
        const cleanDesc = context ? context.replace(/\r?\n/g, ' ') : `Detekovaná procesní lhůta v systému Lexis.`;
        
        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//LexisLocal//NONSGML iCalendar Generator//CS',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:${cleanId}@lexislocal`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${startDate}`,
            `DTEND;VALUE=DATE:${endDate}`,
            `SUMMARY:${cleanTitle}`,
            `DESCRIPTION:${cleanDesc}`,
            'BEGIN:VALARM',
            'TRIGGER:-P2D', // Alert 2 days before
            'ACTION:DISPLAY',
            'DESCRIPTION:Připomenutí blížící se lhůty Lexis',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
        
        const safeName = sanitizeFileName(title);
        const filePath = path.join(CALENDAR_DIR, `${safeName}.ics`);
        
        fs.writeFileSync(filePath, icsContent, 'utf-8');
        console.log(`📅 ICS Kalendářová událost vygenerována: ${filePath}`);
        
        res.json({ success: true, filePath, message: "ICS soubor byl úspěšně vygenerován na plochu." });
    } catch (err) {
        res.status(500).json({ error: `Chyba při generování ICS kalendáře: ${err.message}` });
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
        return `📝 **[Spisovatel - Lokální Fallback]**\n\nSestavil jsem pro Vás návrh právního dokumentu na základě zadání: *"${prompt}"*.\n\n**NÁVRH SMLOUVY O DÍLO (Zkrácený vzor):**\n\n**Článek I. Smluvní strany**\n1. **Objednatel:** [Doplnit jméno/název, sídlo/bydliště, IČO/RČ]\n2. **Zhotovitel:** [Doplnit jméno/název, sídlo/bydliště, IČO/RČ]\n\n**Článek II. Předmět smlouvy**\n1. Zhotovitel se zavazuje provést na svůj náklad a nebezpečí pro Objednatele dílo: *[Doplnit přesnou specifikaci díla]*, a Objednatel se zavazuje dílo převzít a zaplatit zhotoviteli dohodnutou cenu za dílo.\n\n**Článek III. Cena díla a platební podmínky**\n1. Cena za provedení díla je stanovena dohodou smluvních stran a činí celkem *[Doplnit částku]* Kč bez DPH.\n2. Splatnost faktury činí 14 dnů ode dne jejího doručení Objednateli.\n\n*Doporučení:* Upravte předmět smlouvy a doplňte identifikační údaje obou smluvních stran podle potřeby.`;
    }
    return `🤖 **[Agent ${agentId}]**\n\nZpracoval jsem Váš dotaz ohledně: "${prompt}". Služba Ollama je offline, toto je záložní odpověď.`;
}

// GET /api/rag/search - Perform semantic vector search
app.get('/api/rag/search', async (req, res) => {
    const { query, limit } = req.query;
    if (!query) {
        return res.status(400).json({ error: "Vyhledávací dotaz je povinný." });
    }
    const searchLimit = limit ? parseInt(limit) : 5;
    try {
        const matches = await searchSimilar(query, searchLimit);
        res.json({ query, matches });
    } catch (err) {
        res.status(500).json({ error: `Chyba sémantického vyhledávání: ${err.message}` });
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
        if (lastDigit % 3 === 0) {
            result.cee = {
                activeExecutions: 2,
                totalAmount: 184500,
                disclaimer: "Simulováno z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        } else {
            result.cee = {
                activeExecutions: 0,
                totalAmount: 0,
                disclaimer: "Simulováno z CEE. Pro ostrý přístup doplňte přihlašovací údaje Exekutorské komory v nastavení."
            };
        }
        
        // Katastr Simulation based on seed
        result.katastr = {
            propertiesCount: lastDigit % 2 === 0 ? 1 : 0,
            hasPlomba: lastDigit % 4 === 0,
            disclaimer: "Simulováno z Katastru nemovitostí (dálkový přístup)."
        };
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Lustrace selhala: ${err.message}` });
    }
});

// POST /api/registries/save-report - Save structured registry audit to Desktop case directory
app.post('/api/registries/save-report', (req, res) => {
    const { ico, name, reportText, caseNumber } = req.body;
    if (!ico || !name || !reportText) {
        return res.status(400).json({ error: "Chybí povinná data pro uložení prověrky." });
    }
    
    try {
        const cleanName = name.replace(/[^a-zA-Z0-9čšžýáíéóúůďťňĎŤŇČŠŽÝÁÍÉÓÚŮ\s-_]/g, '').replace(/\s+/g, '_');
        const fileName = `Proverka_${cleanName}_${ico}.txt`;
        const filePath = path.join(WATCH_DIR, fileName);
        
        fs.writeFileSync(filePath, reportText, 'utf-8');
        console.log(`📥 Lustrační centrum: Uložena nová prověrka do: ${filePath}`);
        
        res.json({ success: true, fileName, filePath });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se uložit prověrku: ${err.message}` });
    }
});

// GET /api/alerts - Retrieve active insolvency alerts
app.get('/api/alerts', (req, res) => {
    try {
        const inbox = loadInbox();
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
app.post('/api/alerts/dismiss/:alertId', (req, res) => {
    const { alertId } = req.params;
    try {
        const inbox = loadInbox();
        if (inbox.alerts) {
            inbox.alerts = inbox.alerts.map(a => {
                if (a.id === alertId) {
                    return { ...a, status: 'dismissed', dismissedAt: new Date().toISOString() };
                }
                return a;
            });
            saveInbox(inbox);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: `Nepodařilo se skrýt upozornění: ${err.message}` });
    }
});

// GET /api/rag/status - Retrieve vector database size and metrics
app.get('/api/rag/status', (req, res) => {
    try {
        const index = loadIndex();
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
        const inbox = loadInbox();
        const files = Object.values(inbox.files);
        
        let successCount = 0;
        for (const file of files) {
            if (file.filePath && fs.existsSync(file.filePath)) {
                let content = "";
                const ext = path.extname(file.filePath).toLowerCase();
                try {
                    if (ext === '.pdf') {
                        const pdfParser = require('pdf-parse');
                        const dataBuffer = fs.readFileSync(file.filePath);
                        const parsedPdf = await pdfParser(dataBuffer);
                        content = parsedPdf.text;
                    } else {
                        content = fs.readFileSync(file.filePath, 'utf-8');
                    }
                    if (content && content.trim()) {
                        await indexDocument(file.fileName, content);
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
app.post('/api/audit/clear', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    try {
        const WATCH_DIR = process.env.WATCH_DIR || path.join(require('os').homedir(), 'Desktop', 'LexisSpisy');
        const AUDIT_LOG_FILE = path.join(WATCH_DIR, '.audit_log.json');
        if (fs.existsSync(AUDIT_LOG_FILE)) {
            fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify([], null, 2), 'utf-8');
        }
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
    const { name, emoji, role, systemPrompt } = req.body;
    try {
        const updated = saveAgent(agentId, { name, emoji, role, systemPrompt });
        logEvent('LexisLocal Dashboard', `Úprava agenta (${updated.name})`, 'AI Konfigurace', { agentId });
        res.json({ success: true, agent: updated });
    } catch (err) {
        res.status(500).json({ error: `Nelze upravit agenta: ${err.message}` });
    }
});

// POST /api/agents - Create a new custom agent
app.post('/api/agents', (req, res) => {
    const { id, name, emoji, role, systemPrompt } = req.body;
    if (!id || !name) {
        return res.status(400).json({ error: "ID a název agenta jsou povinné údaje." });
    }
    const cleanId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').trim();
    try {
        const agents = loadAgents();
        if (agents[cleanId]) {
            return res.status(400).json({ error: `Agent s ID "${cleanId}" již existuje.` });
        }
        const created = saveAgent(cleanId, { name, emoji, role, systemPrompt });
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

const USE_HTTPS = process.env.USE_HTTPS === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || 'key.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || 'cert.pem';

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
