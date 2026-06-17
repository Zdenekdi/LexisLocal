/**
 * LexisLocal File Watcher
 * Watches local directories (e.g. downloads, case folders) for new PDF and text documents,
 * parses them, extracts deadlines, and indexes them in the local RAG database.
 */

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { checkSubject } = require('./registries');
const { indexDocument, deleteDocumentIndex } = require('./rag');
const { extractTextFromFile, isImageFile, IMAGE_EXTENSIONS } = require('./ocr');
const { logEvent } = require('./audit');
const Mutex = require('./mutex');

// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

const inboxMutex = new Mutex();

const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.HOME || process.env.USERPROFILE, 'Desktop', 'LexisSpisy');
const INBOX_PATH = path.join(WATCH_DIR, '.inbox.json');

if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
    console.log(`📁 Vytvořen sledovaný adresář: ${WATCH_DIR}`);
}

// Ensure .inbox.json exists
if (!fs.existsSync(INBOX_PATH)) {
    fs.writeFileSync(INBOX_PATH, JSON.stringify({ files: {} }, null, 2), 'utf-8');
}

console.log(`👀 Spouštím sledování složky: ${WATCH_DIR}`);

let isWatcherActive = true;

function setWatcherState(active) {
    isWatcherActive = active;
    console.log(`👀 Stav sledování spisy složky změněn na: ${isWatcherActive ? 'AKTIVNÍ' : 'POZASTAVENO'}`);
}

const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true
});

watcher.on('add', async (filePath) => {
    if (!isWatcherActive) {
        console.log(`👀 Sledování spisy je dočasně pozastaveno, přeskakuji: ${path.basename(filePath)}`);
        return;
    }
    // Skip the inbox config itself
    if (path.basename(filePath) === '.inbox.json') return;
    
    const ext = path.extname(filePath).toLowerCase();
    const supportedExts = ['.pdf', '.txt', '.html', '.docx', ...IMAGE_EXTENSIONS];
    if (supportedExts.includes(ext)) {
        console.log(`📥 Detekován nový dokument: ${path.basename(filePath)}`);
        
        // Skip if already parsed and present in .inbox.json
        const inbox = loadInbox();
        if (inbox.files[path.basename(filePath)]) {
            console.log(`ℹ️ Soubor ${path.basename(filePath)} již byl v minulosti zpracován.`);
            return;
        }
        
        try {
            await processDocument(filePath);
        } catch (err) {
            console.error(`❌ Chyba zpracování souboru ${path.basename(filePath)}:`, err.message);
        }
    }
});

// Load inbox data helper
function loadInbox() {
    try {
        if (fs.existsSync(INBOX_PATH)) {
            return JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error("⚠️ Nepodařilo se přečíst .inbox.json:", e.message);
    }
    return { files: {} };
}

// Save inbox data helper
async function saveInbox(inbox) {
    await inboxMutex.acquire();
    try {
        await fs.promises.writeFile(INBOX_PATH, JSON.stringify(inbox, null, 2), 'utf-8');
    } catch (e) {
        console.error("⚠️ Nepodařilo se uložit .inbox.json:", e.message);
    } finally {
        inboxMutex.release();
    }
}

// Combined Heuristic and AI extraction engine
async function processDocument(filePath) {
    const fileName = path.basename(filePath);
    console.log(`⚙️ Analyzuji dokument ${fileName}...`);
    
    let text = "";
    let wasOcr = false;
    
    // === Inteligentní extrakce textu (digitální PDF / naskenované PDF / obrázek / TXT) ===
    try {
        const result = await extractTextFromFile(filePath);
        text = result.text || '';
        wasOcr = result.ocr || false;
        
        if (wasOcr) {
            console.log(`🔍 OCR: Soubor ${fileName} byl zpracován přes OCR engine.`);
        }
    } catch (extractErr) {
        console.error(`❌ Chyba extrakce textu z ${fileName}:`, extractErr.message);
    }
    
    if (!text || !text.trim()) {
        console.warn(`⚠️ Soubor ${fileName} je prázdný nebo nelze přečíst.`);
        return;
    }
    
    // 1. Step: Run High-Quality Czech Heuristic Regex Engine (Bulletproof Fallback)
    const metadata = runRegexExtractor(text);
    
    // 2. Step: Refine metadata with Local Ollama AI if online
    try {
        const refinedMetadata = await runAIExtractor(text);
        if (refinedMetadata) {
            if (refinedMetadata.caseNumber) metadata.caseNumber = refinedMetadata.caseNumber;
            if (refinedMetadata.plaintiff) metadata.plaintiff = refinedMetadata.plaintiff;
            if (refinedMetadata.defendant) metadata.defendant = refinedMetadata.defendant;
            if (refinedMetadata.deadlineDays !== undefined) {
                metadata.deadlineDays = refinedMetadata.deadlineDays;
                metadata.deadlineDate = calculateDeadlineDate(refinedMetadata.deadlineDays);
            }
            if (refinedMetadata.summary) metadata.summary = refinedMetadata.summary;
        }
    } catch (err) {
        console.log(`ℹ️ Ollama AI extraktor je nedostupný (${err.message}). Používám přesná heuristická data.`);
    }
    
    // 2.5 Step: Run ARES & ISIR check if IČO was extracted
    let registryData = null;
    if (metadata.ico) {
        try {
            registryData = await checkSubject(metadata.ico);
            if (registryData && !registryData.error) {
                if (registryData.inInsolvency) {
                    metadata.summary = `⚠️ POZOR: Subjekt ${registryData.name} je v INSOLVENCI (${registryData.insolvencyCase})! ` + metadata.summary;
                }
                // Enrich defendant/plaintiff with verified ARES address
                if (metadata.defendant && (metadata.defendant.toLowerCase().includes("žalovaný") || metadata.defendant.length < 30)) {
                    metadata.defendant = `${registryData.name} (IČO: ${registryData.ico}, sídlo: ${registryData.seat})`;
                }
            }
        } catch (e) {
            console.warn("⚠️ Chyba při automatickém ověření registrů v watcher:", e.message);
        }
    }
    
    // 3. Save to inbox
    const inbox = loadInbox();
    inbox.files[fileName] = {
        fileName: fileName,
        filePath: filePath,
        status: "unread",
        caseNumber: metadata.caseNumber || "Neznámá sp. zn.",
        plaintiff: metadata.plaintiff || "Nezjištěn",
        defendant: metadata.defendant || "Nezjištěn",
        deadlineDays: metadata.deadlineDays || 0,
        deadlineDate: metadata.deadlineDate || null,
        summary: metadata.summary || "Nově stažený dokument připravený ke zpracování.",
        ico: metadata.ico || null,
        inInsolvency: registryData ? registryData.inInsolvency : false,
        insolvencyCase: registryData ? registryData.insolvencyCase : null,
        verifiedSeat: registryData ? registryData.seat : null,
        wasOcr: wasOcr,
        processedAt: new Date().toISOString()
    };
    await saveInbox(inbox);
    console.log(`✅ Dokument ${fileName} byl úspěšně analyzován a uložen do lokálního indexu.`);
    
    logEvent('FileWatcher', wasOcr ? 'Zpracování OCR' : 'Zpracování dokumentu', fileName, {
        caseNumber: metadata.caseNumber || 'Nezjištěna',
        deadlineDays: metadata.deadlineDays || 0,
        charactersCount: text.length
    });
    
    // Automatically trigger insolvency check in background to ensure alerts are up-to-date
    checkAllInsolvencies().catch(err => console.error("⚠️ Background ISIR verification error:", err.message));
    
    // Trigger local RAG vector indexing in background
    try {
        await indexDocument(fileName, text);
    } catch (e) {
        console.error(`❌ RAG: Selhala vektorová indexace pro soubor ${fileName}:`, e.message);
    }
}

// Regular Expression extractor for Czech legal documents
function runRegexExtractor(text) {
    const metadata = {
        caseNumber: "",
        plaintiff: "",
        defendant: "",
        deadlineDays: 0,
        deadlineDate: null,
        summary: "",
        ico: ""
    };
    
    // 1. Spisová značka: e.g. 23 C 120/2026, 15 Co 45/2025, 4 T 12/2024
    const caseReg = /(?:sp\s*zn\.?|č\s*j\.?|spisová\s*značka)\s*[:\-]?\s*(\d+\s*[A-Za-zČŠŽčšž]+\s*\d+\/\d+)/i;
    const matchCase = text.match(caseReg);
    if (matchCase) {
        metadata.caseNumber = matchCase[1].replace(/\s+/g, ' ').trim();
    } else {
        // Fallback broad regex for case numbers
        const broadCaseReg = /(\d+\s*[A-Za-zČŠŽčšž]+\s*\d+\/\d+)/;
        const matchBroad = text.match(broadCaseReg);
        if (matchBroad) {
            metadata.caseNumber = matchBroad[1].replace(/\s+/g, ' ').trim();
        }
    }
    
    // 2. Lhůta v dnech: e.g. "lhůta 15 dnů", "do 15 dnů", "ve lhůtě 8 dnů"
    const deadlineReg = /(?:lhůt[aěuouí-]+\s*(?:k\s*vyjádření\s*)?(?:činí|v\s*délce)?\s*|do\s*|ve\s*lhůtě\s*)(\d+)\s*(?:dn[ůía-z]*)/i;
    const matchDeadline = text.match(deadlineReg);
    if (matchDeadline) {
        const days = parseInt(matchDeadline[1]);
        metadata.deadlineDays = days;
        metadata.deadlineDate = calculateDeadlineDate(days);
    }
    
    // 3. Strany sporu
    const plaintiffReg = /(?:žalobc[eůa-z]+\s*:\s*|žalující\s*strana\s*:\s*)([^\n,.]+)/i;
    const matchPlaintiff = text.match(plaintiffReg);
    if (matchPlaintiff) metadata.plaintiff = matchPlaintiff[1].trim();
    
    const defendantReg = /(?:žalovan[éhomy-]+\s*:\s*|žalovaná\s*strana\s*:\s*)([^\n,.]+)/i;
    const matchDefendant = text.match(defendantReg);
    if (matchDefendant) metadata.defendant = matchDefendant[1].trim();
    
    // 4. IČO Search (Exactly 8 digits, supports spaces inside like '123 456 78')
    const icoReg = /(?:IČO|IČ)\s*[:\-]?\s*(\d(?:\s*\d){7})/i;
    const matchIco = text.match(icoReg);
    if (matchIco) {
        metadata.ico = matchIco[1].replace(/\s+/g, '').trim();
    }
    
    // Summary mock based on extracted items
    metadata.summary = `Byl detekován spis ${metadata.caseNumber || 'bez sp. zn.'}.`;
    if (metadata.deadlineDays > 0) {
        metadata.summary += ` Byla nalezena lhůta ${metadata.deadlineDays} dnů (vyprší ${metadata.deadlineDate}).`;
    }
    
    return metadata;
}

// Calculate deadline target date helper
function calculateDeadlineDate(days) {
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Ollama AI Metadata Extractor
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

// Hlídač insolvencí (ISIR Watcher) - Runs active insolvency check on all monitored IČOs
async function checkAllInsolvencies() {
    console.log("🚨 Hlídač insolvencí: Spouštím periodickou kontrolu sledovaných subjektů...");
    const inbox = loadInbox();
    if (!inbox.files) return { checkedCount: 0, newAlertsCount: 0 };
    if (!inbox.alerts) inbox.alerts = [];
    
    const files = Object.values(inbox.files);
    let checkedCount = 0;
    let newAlertsCount = 0;
    
    // Concurrently verify unique IČOs
    const uniqueIcos = [...new Set(files.map(f => f.ico).filter(Boolean))];
    
    for (const ico of uniqueIcos) {
        checkedCount++;
        try {
            const result = await checkSubject(ico);
            if (result && !result.error) {
                // If insolvency is found
                if (result.inInsolvency) {
                    // Check if an active alert already exists for this ICO
                    const alreadyAlerted = inbox.alerts.some(a => a.ico === ico && a.status === 'active');
                    
                    if (!alreadyAlerted) {
                        // Find files corresponding to this ICO to cite as context
                        const citedFiles = files.filter(f => f.ico === ico).map(f => f.fileName);
                        
                        const newAlert = {
                            id: 'alert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                            ico: ico,
                            name: result.name,
                            caseNumber: result.insolvencyCase,
                            insolvencyStatus: result.insolvencyStatus,
                            citedFiles: citedFiles,
                            detectedAt: new Date().toISOString(),
                            status: 'active'
                        };
                        
                        inbox.alerts.push(newAlert);
                        newAlertsCount++;
                        console.log(`🚨 Hlídač insolvencí: DETEKOVÁN ÚPADEK u subjektu ${result.name} (IČO: ${ico})! Spis: ${result.insolvencyCase}`);
                    }
                    
                    // Update insolvency status in all matching files in the inbox
                    for (const fileName in inbox.files) {
                        if (inbox.files[fileName].ico === ico) {
                            inbox.files[fileName].inInsolvency = true;
                            inbox.files[fileName].insolvencyCase = result.insolvencyCase;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`⚠️ Hlídač insolvencí: Selhala kontrola IČO ${ico}:`, e.message);
        }
    }
    
    if (newAlertsCount > 0) {
        await saveInbox(inbox);
    }
    
    return { checkedCount, newAlertsCount };
}

module.exports = { WATCH_DIR, loadInbox, saveInbox, processDocument, setWatcherState, checkAllInsolvencies };
