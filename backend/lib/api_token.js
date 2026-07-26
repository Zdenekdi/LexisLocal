// --- api_token — správa API tokenu backendu ---
// Token řeší přístup k /api/* (viz lib/auth.js). Historicky se bral JEN z
// prostředí (process.env.API_TOKEN) a byl opt-in. Nově se — když v prostředí
// není — token JEDNOU vygeneruje a PERSISTUJE mimo datovou složku
// (vedle šifrovacího klíče, resolveKeyDir), takže je vždy k dispozici pro
// klienty (dashboard/editor). Samotné VYNUCENÍ zůstává řízené zvlášť v server.js
// (opt-in), aby se nikdo omylem nezamkl ven.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveKeyDir } = require('./secure_crypto');

function tokenFile() {
    return path.join(resolveKeyDir(), 'api_token');
}

// Vrátí API token: 1) z prostředí, 2) z perzistovaného souboru, 3) nově vygeneruje a uloží.
function resolveApiToken() {
    if (process.env.API_TOKEN) return process.env.API_TOKEN;

    const file = tokenFile();
    try {
        if (fs.existsSync(file)) {
            const t = fs.readFileSync(file, 'utf8').trim();
            if (t) return t;
        }
    } catch (e) { /* přečteme níže znovu vygenerovaný */ }

    const token = crypto.randomBytes(32).toString('hex');
    try {
        const dir = resolveKeyDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        // atomicky (temp + rename), práva 0600 — token je tajemství
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, token, { encoding: 'utf8', mode: 0o600 });
        try { fs.chmodSync(tmp, 0o600); } catch (e) {}
        fs.renameSync(tmp, file);
    } catch (e) {
        console.error('⚠️ Nelze uložit API token na disk (použiji jen v paměti):', e.message);
    }
    return token;
}

module.exports = { resolveApiToken, tokenFile };
