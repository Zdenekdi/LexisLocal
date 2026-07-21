'use strict';
/**
 * Per-agent API tokeny se scopy pro LexisLocal.
 * Každý agent má vlastní token s oprávněními (read / write). Tokeny se ukládají
 * jako SHA-256 hash (tokeny jsou vysoko-entropické náhodné → hash bez soli stačí)
 * mimo WATCH_DIR (secure_crypto.resolveKeyDir()).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secureCrypto = require('./secure_crypto');

const VALID_SCOPES = ['read', 'write'];

function tokenFile() {
  return path.join(secureCrypto.resolveKeyDir(), 'agent_tokens.json');
}

function loadRaw() {
  try {
    const f = tokenFile();
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('⚠️ Nelze načíst agent_tokens.json:', e.message);
  }
  return [];
}

function saveRaw(list) {
  const dir = secureCrypto.resolveKeyDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokenFile(), JSON.stringify(list, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function normalizeScopes(scopes) {
  const arr = (Array.isArray(scopes) ? scopes : String(scopes || '').split(','))
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => VALID_SCOPES.includes(s));
  return [...new Set(arr)];
}

/** Vytvoří (nebo nahradí) token pro agenta. Vrátí token v plaintextu (jen jednou). */
function createToken(name, scopes) {
  if (!name || !String(name).trim()) throw new Error('Jméno agenta je povinné.');
  const sc = normalizeScopes(scopes && (Array.isArray(scopes) ? scopes.length : scopes) ? scopes : ['read']);
  if (!sc.length) throw new Error('Neplatné scopes. Povolené: read, write.');
  const list = loadRaw().filter((t) => t.name !== name);
  const token = crypto.randomBytes(32).toString('hex');
  list.push({ name: String(name).trim(), hash: sha256(token), scopes: sc, createdAt: new Date().toISOString() });
  saveRaw(list);
  return token;
}

/** Zruší token agenta. Vrátí true, pokud něco smazal. */
function revokeToken(name) {
  const list = loadRaw();
  const next = list.filter((t) => t.name !== name);
  saveRaw(next);
  return list.length !== next.length;
}

/** Vrátí metadata tokenů (bez hashů). */
function listTokens() {
  return loadRaw().map(({ name, scopes, createdAt }) => ({ name, scopes, createdAt }));
}

/** Ověří token. Vrátí { name, scopes } nebo null. Porovnání v konstantním čase. */
function verifyToken(token) {
  if (!token) return null;
  const h = sha256(token);
  for (const t of loadRaw()) {
    if (t.hash && secureCrypto.timingSafeEqualStr(h, t.hash)) {
      return { name: t.name, scopes: Array.isArray(t.scopes) ? t.scopes : [] };
    }
  }
  return null;
}

module.exports = { createToken, revokeToken, listTokens, verifyToken, normalizeScopes, VALID_SCOPES };
