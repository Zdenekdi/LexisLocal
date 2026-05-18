require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { WATCH_DIR, loadInbox, saveInbox, processDocument, setWatcherState, checkAllInsolvencies } = require('./lib/watcher');
const { checkSubject } = require('./lib/registries');
const { indexDocument, deleteDocumentIndex, searchSimilar, loadIndex } = require('./lib/rag');

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
    // Allow static files in the public directory without auth
    if (req.path === '/' || req.path === '/index.html' || req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.ico')) {
        return next();
    }
    
    // Only enforce auth if API_TOKEN is set in environment
    if (API_TOKEN) {
        const token = req.headers['x-api-token'] || req.query.token;
        if (token !== API_TOKEN) {
            console.warn(`🔒 Nepovolený přístup k API: ${req.method} ${req.path}`);
            return res.status(401).json({ error: "Přístup odepřen: Neplatný nebo chybějící API token." });
        }
    }
    next();
};

app.use(authenticate);

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
    },
    sekretarka: {
        name: "Sekretářka",
        emoji: "⏰",
        role: "Správa spisové agendy, formátování doložek, extrakce schůzek a úkolů.",
        systemPrompt: "Jsi vysoce organizovaná a profesionální advokátní sekretářka. Tvým úkolem je pomáhat advokátům strukturovat úkoly, shrnout termíny, upravovat tón e-mailové komunikace s klienty a organizovat spisové složky."
    },
    spisovatel: {
        name: "Spisovatel",
        emoji: "📝",
        role: "Tvorba a úprava právních dokumentů (žaloby, smlouvy, odvolání) na míru.",
        systemPrompt: "Jsi špičkový český advokát a mistr legislativního a kontraktuálního draftování. Tvým úkolem je na základě zadání sestavovat precizní, bezchybné a strukturované právní dokumenty (smlouvy, podání k soudu, odvolání, žaloby) a zapracovávat do nich věcné či stylistické připomínky uživatele s maximálním právním a jazykovým citem."
    }
};

// Root Status
app.get('/api/status', (req, res) => {
    res.json({
        status: "online",
        project: "LexisLocal AI Ecosystem",
        version: "1.2.0",
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
        res.json({
            success: true,
            message: `Re-indexace dokončena. Úspěšně přegenerováno ${successCount} z ${files.length} souborů.`
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při re-indexaci: ${err.message}` });
    }
});

// POST /api/watcher/toggle - Toggle dynamic Desktop Spisy folder watching activity state
app.post('/api/watcher/toggle', (req, res) => {
    const { active } = req.query;
    const isActive = active === 'true';
    setWatcherState(isActive);
    res.json({ success: true, active: isActive });
});

app.listen(PORT, () => {
    console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
});
