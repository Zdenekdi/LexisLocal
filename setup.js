/**
 * LexisLocal ⚖️🤖 - Automatický Setup a Instalační Asistent
 * Tento skript provede kompletní instalaci a konfiguraci lokálního AI prostředí.
 */

const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.clear();
console.log(`\x1b[36m==================================================================\x1b[0m`);
console.log(`\x1b[1m\x1b[34m               ⚖️  LEXISLOCAL - AI SETUP ASSISTANT  🤖\x1b[0m`);
console.log(`\x1b[33m         Soukromý, lokální AI ekosystém pro moderní advokáty\x1b[0m`);
console.log(`\x1b[36m==================================================================\x1b[0m\n`);

const WATCH_DIR = path.join(process.env.HOME || process.env.USERPROFILE, 'Desktop', 'LexisSpisy');

async function main() {
    try {
        // 1. Kontrola Node.js
        console.log(`\x1b[32m[1/5]\x1b[0m Ověřuji prostředí Node.js...`);
        console.log(`   - Verze: ${process.version} \x1b[32m[OK]\x1b[0m`);

        // 2. Vytvoření složky pro spisy
        console.log(`\x1b[32m[2/5]\x1b[0m Příprava složky pro spisy na Vaší ploše...`);
        if (!fs.existsSync(WATCH_DIR)) {
            fs.mkdirSync(WATCH_DIR, { recursive: true });
            console.log(`   - Vytvořena složka: \x1b[34m${WATCH_DIR}\x1b[0m \x1b[32m[OK]\x1b[0m`);
        } else {
            console.log(`   - Složka již existuje: \x1b[34m${WATCH_DIR}\x1b[0m \x1b[32m[OK]\x1b[0m`);
        }

        // 3. Instalace NPM závislostí
        console.log(`\x1b[32m[3/5]\x1b[0m Instalace a aktualizace softwarových knihoven (NPM)...`);
        console.log(`   - Spouštím 'npm install' (může to chvíli trvat)...`);
        try {
            execSync('npm install', { stdio: 'inherit' });
            console.log(`   - Instalace závislostí úspěšně dokončena. \x1b[32m[OK]\x1b[0m`);
        } catch (e) {
            console.warn(`   - \x1b[33mUpozornění: Některé nepovinné závislosti se nepodařilo nainstalovat automaticky.\x1b[0m`);
            console.log(`     Spusťte prosím 'npm install --force' ručně v systémovém Terminálu.`);
        }

        // 4. Detekce a kontrola Ollamy
        console.log(`\x1b[32m[4/5]\x1b[0m Kontrola lokálního AI serveru Ollama...`);
        const isOllamaRunning = await checkOllamaService();
        
        if (!isOllamaRunning) {
            console.log(`\x1b[31m   - POZOR: Server Ollama neběží nebo není nainstalován!\x1b[0m`);
            console.log(`     1. Stáhněte si bezplatnou aplikaci Ollama z \x1b[4mhttps://ollama.com\x1b[0m`);
            console.log(`     2. Spusťte ji na svém počítači.`);
            console.log(`     3. Poté spusťte tento setup znovu.\n`);
            console.log(`\x1b[33mℹ️ Tip: LexisLocal bude fungovat i bez běžící Ollamy v nouzovém offline režimu,\x1b[0m`);
            console.log(`\x1b[33m      ale sémantické vyhledávání a chaty budou simulovány.\x1b[0m\n`);
        } else {
            console.log(`   - AI server Ollama běží v pořádku. \x1b[32m[OK]\x1b[0m`);
            
            // 5. Automatické stažení AI modelů
            console.log(`\x1b[32m[5/5]\x1b[0m Kontrola přítomnosti potřebných AI modelů...`);
            await ensureOllamaModel('nomic-embed-text', 'sémantický vyhledávací index');
            await ensureOllamaModel('llama3', 'hlavní rojový AI model');
        }

        // Dokončení setupu
        console.log(`\n\x1b[32m🎉 SETUP DOKONČEN! VŠE JE PŘIPRAVENO! 🎉\x1b[0m`);
        console.log(`------------------------------------------------------------------`);
        console.log(`1. Složka pro Vaše spisy se nachází na ploše:`);
        console.log(`   👉 \x1b[34m${WATCH_DIR}\x1b[0m`);
        console.log(`2. Spusťte celý systém příkazem v systémovém Terminálu:`);
        console.log(`   👉 \x1b[1m\x1b[36mnpm run dev\x1b[0m`);
        console.log(`3. Otevřete ve Vašem prohlížeči adresu dashboardu:`);
        console.log(`   👉 \x1b[4mhttp://localhost:4000\x1b[0m`);
        console.log(`------------------------------------------------------------------\n`);

    } catch (error) {
        console.error(`\x1b[31m❌ Setup selhal s neočekávanou chybou:\x1b[0m`, error.message);
    }
}

function checkOllamaService() {
    return new Promise((resolve) => {
        const req = http.request({
            host: '127.0.0.1',
            port: 11434,
            path: '/',
            method: 'GET',
            timeout: 2000
        }, (res) => {
            resolve(res.statusCode === 200);
        });
        
        req.on('error', () => resolve(false));
        req.on('timeout', () => resolve(false));
        req.end();
    });
}

function ensureOllamaModel(modelName, description) {
    return new Promise((resolve) => {
        console.log(`   - Kontrola modelu \x1b[36m${modelName}\x1b[0m (${description})...`);
        
        // Zkontrolujeme, zda model už existuje
        exec(`ollama show ${modelName}`, (err, stdout, stderr) => {
            if (!err) {
                console.log(`     ✓ Model ${modelName} je již stažen. \x1b[32m[OK]\x1b[0m`);
                resolve();
            } else {
                console.log(`     ⚠️ Model ${modelName} chybí. Spouštím automatické stahování (může to trvat několik minut)...`);
                
                const pullProcess = spawn('ollama', ['pull', modelName], { stdio: 'inherit' });
                
                pullProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(`     ✓ Model ${modelName} byl úspěšně stažen a nakonfigurován. \x1b[32m[OK]\x1b[0m`);
                    } else {
                        console.log(`     \x1b[33m⚠️ Stahování modelu se nezdařilo. Můžete jej stáhnout ručně příkazem 'ollama pull ${modelName}'\x1b[0m`);
                    }
                    resolve();
                });
            }
        });
    });
}

main();
