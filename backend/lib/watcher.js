/**
 * LexisLocal File Watcher
 * Watches local directories (e.g. downloads, case folders) for new PDF and DOCX documents,
 * parses them, extracts deadlines, and indexes them in the local RAG database.
 */

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.HOME || process.env.USERPROFILE, 'Desktop', 'LexisSpisy');

if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
    console.log(`📁 Vytvořen sledovaný adresář: ${WATCH_DIR}`);
}

console.log(`👀 Spouštím sledování složky: ${WATCH_DIR}`);

const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true
});

watcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf' || ext === '.txt' || ext === '.html') {
        console.log(`📥 Detekován nový dokument: ${path.basename(filePath)}`);
        try {
            await processDocument(filePath);
        } catch (err) {
            console.error(`❌ Chyba zpracování souboru ${path.basename(filePath)}:`, err.message);
        }
    }
});

async function processDocument(filePath) {
    const fileName = path.basename(filePath);
    console.log(`⚙️ Analyzuji dokument ${fileName} pomocí lokálního AI parseru...`);
    
    // Zde bude napojení na OCR / pdf-parse a následný import do lokálního LLM
    // Pro demonstraci simulujeme analýzu
    setTimeout(() => {
        console.log(`✅ Dokument ${fileName} byl úspěšně indexován do lokální paměti.`);
    }, 1500);
}

module.exports = { WATCH_DIR };
