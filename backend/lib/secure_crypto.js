/**
 * secure_crypto.js — jeden zdroj pravdy pro lokální šifrování LexisLocal.
 *
 * Dvě věci, které dřív chyběly / byly rozbité:
 *
 *  1) KLÍČ MIMO DATA. Historicky ležel `.lexis.key` ve stejné (potenciálně
 *     cloudově synchronizované) složce jako `.lexis.db` → klíč cestoval s daty.
 *     Nově je klíč v dedikovaném adresáři mimo WATCH_DIR (`~/.lexislocal/lexis.key`,
 *     práva 0600), který se nesynchronizuje. Starý klíč z WATCH_DIR se při prvním
 *     startu ZMIGRUJE (přesune) sem, aby se stávající data dala dál dešifrovat.
 *
 *  2) AES-256-GCM MÍSTO CBC. GCM přidává autentizační tag → detekce manipulace
 *     (integrita), aby platilo tvrzení o „tamper-proof". Starý CBC formát se
 *     STÁLE PŘEČTE (zpětná kompatibilita), ale nové zápisy jsou GCM. Data se tak
 *     samovolně přemigrují při prvním uložení.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WATCH_DIR } = require('./config');

// Klíč mimo synchronizovanou složku. Lze přepsat přes LEXIS_KEY_DIR (např. keychain-mount).
const KEY_DIR = process.env.LEXIS_KEY_DIR || path.join(os.homedir(), '.lexislocal');
const KEY_FILE = path.join(KEY_DIR, 'lexis.key');
const LEGACY_KEY_FILE = path.join(WATCH_DIR, '.lexis.key'); // původní umístění (u dat)

/**
 * Adresář, kam patří lokální tajemství (klíč, per-agent tokeny). Řeší se dynamicky
 * (za běhu), aby respektoval změnu LEXIS_KEY_DIR a testovací prostředí:
 *  1) explicitní LEXIS_KEY_DIR má vždy přednost,
 *  2) v testech (NODE_ENV=test) míří do temp, aby se nešahalo do domovské složky,
 *  3) jinak výchozí `~/.lexislocal`.
 * Používá např. agent_tokens.js pro umístění agent_tokens.json mimo WATCH_DIR.
 */
function resolveKeyDir() {
    if (process.env.LEXIS_KEY_DIR) return process.env.LEXIS_KEY_DIR;
    if (process.env.NODE_ENV === 'test') return path.join(os.tmpdir(), 'lexislocal-test-keys');
    return path.join(os.homedir(), '.lexislocal');
}

/**
 * Porovnání dvou řetězců v konstantním čase (obrana proti timing-attackům při
 * ověřování hashů tokenů). Vrací false už při rozdílné délce.
 */
function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(String(a == null ? '' : a), 'utf8');
    const bufB = Buffer.from(String(b == null ? '' : b), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function readHexKey(file) {
    try {
        const hex = fs.readFileSync(file, 'utf8').trim();
        const buf = Buffer.from(hex, 'hex');
        return buf.length === 32 ? buf : null;
    } catch (e) { return null; }
}

function writeKey(keyBuf) {
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    // atomický zápis: temp + rename, aby při pádu nezůstal půlklíč
    const tmp = KEY_FILE + '.tmp';
    fs.writeFileSync(tmp, keyBuf.toString('hex'), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch (e) {}
    fs.renameSync(tmp, KEY_FILE);
}

// Veřejné atomické uložení klíče (používá rotace klíče v database.js).
function saveKey(keyBuf) { writeKey(keyBuf); }

/**
 * Vrátí 256bitový klíč. Pořadí: nové umístění → migrace starého z WATCH_DIR →
 * vygenerování nového. Při selhání zápisu vrátí volatilní paměťový klíč
 * (data se pak sice nedají po restartu přečíst, ale běh nespadne).
 */
function resolveKey() {
    // 1) klíč už je na novém (bezpečném) místě
    const existing = readHexKey(KEY_FILE);
    if (existing) return existing;

    // 2) migrace ze starého umístění u dat
    const legacy = readHexKey(LEGACY_KEY_FILE);
    if (legacy) {
        try {
            writeKey(legacy);
            // ověř zápis a teprve pak odstraň klíč od dat (aby se přestal synchronizovat)
            if (readHexKey(KEY_FILE)) {
                try { fs.unlinkSync(LEGACY_KEY_FILE); } catch (e) {}
                console.log(`🔐 Šifrovací klíč zmigrován mimo datovou složku: ${KEY_FILE}`);
            }
            return legacy;
        } catch (err) {
            console.error('⚠️ Migrace klíče selhala, používám starý v místě dat:', err.message);
            return legacy;
        }
    }

    // 3) nový klíč
    const key = crypto.randomBytes(32);
    try {
        writeKey(key);
        console.log(`🔑 Vygenerován nový šifrovací klíč: ${KEY_FILE}`);
    } catch (err) {
        console.error('⚠️ Nelze zapsat klíč na disk, používám paměťový (volatilní):', err.message);
    }
    return key;
}

/**
 * Zašifruje řetězec pomocí AES-256-GCM. Vrací serializovatelný objekt
 * { v:2, iv, tag, data } (vše hex).
 */
function encrypt(key, plaintext) {
    const iv = crypto.randomBytes(12); // GCM standard nonce
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let data = cipher.update(String(plaintext == null ? '' : plaintext), 'utf8', 'hex');
    data += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    // `tag` + `v:2` = původní formát; `authTag` + `alg` = novější pojmenování.
    // Vydáváme obojí, aby byl payload čitelný oběma verzemi kódu i testů.
    return { v: 2, alg: 'aes-256-gcm', iv: iv.toString('hex'), tag, authTag: tag, data };
}

/**
 * Dešifruje payload. Detekuje formát:
 *  - v2 / přítomný `tag` → AES-256-GCM (ověří integritu, jinak vyhodí chybu),
 *  - jinak → starší AES-256-CBC (16B IV, bez tagu) kvůli zpětné kompatibilitě.
 */
function decrypt(key, payload) {
    if (!payload || !payload.iv || !payload.data) {
        throw new Error('Neplatný formát zašifrovaného souboru.');
    }
    const authTagHex = payload.authTag || payload.tag; // preferuj authTag (novější), fallback tag
    if (payload.v === 2 || payload.alg === 'aes-256-gcm' || authTagHex) {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let out = decipher.update(payload.data, 'hex', 'utf8');
        out += decipher.final('utf8'); // vyhodí, pokud tag nesedí (data byla změněna)
        return out;
    }
    // Legacy AES-256-CBC
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(payload.iv, 'hex'));
    let out = decipher.update(payload.data, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
}

module.exports = { resolveKey, resolveKeyDir, timingSafeEqualStr, saveKey, encrypt, decrypt, KEY_FILE, KEY_DIR, LEGACY_KEY_FILE };
