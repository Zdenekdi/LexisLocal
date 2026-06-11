/**
 * Test script to verify the Paperless-ngx Webhook endpoint.
 * Run this while LexisLocal server is running!
 * 
 * Usage: node scratch/test_paperless_webhook.js
 */

const path = require('path');
const fs = require('fs');

// Load environment variables if available
const dotenvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
}

const PORT = process.env.PORT || 4000;
const API_TOKEN = process.env.API_TOKEN || '';

const mockPayload = {
    event: "document_added",
    document_id: "99",
    title: "Rozsudek Okresního soudu v Ostravě - sp. zn. 23 C 120/2026",
    created: new Date().toISOString(),
    tags: ["Rozsudek", "Ostrava", "23 C 120/2026"],
    content: `
ROZSUDEK
JMÉNEM REPUBLIKY

Okresní soud v Ostravě rozhodl samosoudcem Mgr. Janem Novákem ve věci
žalobce: Jan Novotný, nar. 1. 1. 1980, bytem Ostravská 12, Ostrava
proti
žalovanému: Úpadce s.r.o., IČO: 12345678, se sídlem Vodičkova 17, Praha

o zaplacení částky 50.000 Kč s příslušenstvím

takto:

Žalovaný je povinen zaplatit žalobci částku 50.000 Kč do 15 dnů od právní moci tohoto rozsudku.
Ve zbytku se žaloba zamítá.
    `.trim()
};

async function runTest() {
    console.log(`🧪 Spouštím test Paperless Webhooku na http://localhost:${PORT}...`);
    
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (API_TOKEN) {
        headers['X-API-Token'] = API_TOKEN;
        console.log(`🔒 Používám API Token z .env.`);
    }

    try {
        const url = `http://localhost:${PORT}/api/paperless/webhook`;
        console.log(`📤 Odesílám testovací payload...`);
        
        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(mockPayload)
        });

        const data = await res.json();
        
        console.log(`\n📥 Odpověď serveru (Status: ${res.status}):`);
        console.log(JSON.stringify(data, null, 2));

        if (res.status === 200 && data.success) {
            console.log(`\n✅ TEST ÚSPĚŠNÝ: Webhook byl úspěšně zpracován a dokument uložen do inboxu.`);
            
            // Check extracted values
            const file = data.file;
            console.log(`   - Spisová značka: ${file.caseNumber}`);
            console.log(`   - Žalobce: ${file.plaintiff}`);
            console.log(`   - Žalovaný: ${file.defendant}`);
            console.log(`   - IČO: ${file.ico}`);
            console.log(`   - Lhůta: ${file.deadlineDays} dní (vyprší ${file.deadlineDate})`);
            console.log(`   - Insolvence: ${file.inInsolvency ? 'ANO (detekováno)' : 'NE'}`);
            
            if (file.inInsolvency && file.ico === "12345678") {
                console.log(`✅ TEST REGISTRŮ ÚSPĚŠNÝ: Úpadce s.r.o. (IČO: 12345678) byl správně identifikován jako v insolvenci.`);
            }
        } else {
            console.error(`\n❌ TEST SELHAL: Server vrátil chybu.`);
        }
    } catch (err) {
        console.error(`\n❌ TEST SELHAL: Chyba připojení:`, err.message);
        console.log(`\n💡 Ujistěte se, že Vám běží Express server (npm run dev) na portu ${PORT}!`);
    }
}

runTest();
