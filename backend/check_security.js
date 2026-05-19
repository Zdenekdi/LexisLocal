/**
 * LexisLocal Security Verification Script
 * Validates that all network configuration options, environment profiles,
 * and dependency pathways conform to the specified local-first network security policies.
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config', 'deployment_security.json');

console.log("🔒 Zahajuji kontrolu síťové bezpečnosti LexisLocal...");

let assertionsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(` ✅ PASS: ${message}`);
    } else {
        console.error(` ❌ FAIL: ${message}`);
        assertionsFailed++;
    }
}

// 1. Check configuration file existence and read
if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ Konfigurační soubor ${CONFIG_PATH} nebyl nalezen!`);
    process.exit(1);
}

try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    
    // 2. Assert local-only configs
    assert(config.WHISPER_BACKEND === 'local', 'Whisper přepis je nastaven na lokální instanci (žádný cloud)');
    assert(config.OLLAMA_FALLBACK === 'none', 'Ollama nemá nastavený externí cloudový fallback');
    assert(config.TELEMETRY_ENABLED === false, 'Telemetrie a odesílání statistik jsou vypnuté');
    assert(config.ALLOW_CLOUD_BACKUPS === false, 'Cloudové zálohování spisů je zakázáno');
    
    // 3. Test that there are no OpenAI API keys or similar in environment
    const dangerousKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY'];
    dangerousKeys.forEach(key => {
        assert(!process.env[key], `V prostředí (ENV) se nenachází tajný klíč ${key}`);
    });

} catch (err) {
    console.error("❌ Chyba při načítání nebo parsování konfigurace:", err.message);
    process.exit(1);
}

console.log("\n--- Výsledek bezpečnostní kontroly ---");
if (assertionsFailed === 0) {
    console.log("🛡️  Všechny bezpečnostní kontroly proběhly ÚSPĚŠNĚ. LexisLocal je bezpečně izolovaný.");
    process.exit(0);
} else {
    console.error(`⚠️  Nalezeno ${assertionsFailed} bezpečnostních rizik! Opravte konfiguraci.`);
    process.exit(1);
}
