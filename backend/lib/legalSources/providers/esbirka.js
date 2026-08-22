/**
 * providers/esbirka.js — poskytovatel LEGISLATIVY z oficiálního e-Sbírka API.
 *
 * e-Sbírka poskytuje veřejné REST API a otevřená data (od 15. 1. 2024; produkčně
 * stabilní od 15. 1. 2026). Přístup vyžaduje REGISTRACI přes MV (datovou schránkou),
 * proto je provider VÝCHOZE VYPNUTÝ a zapíná se až po konfiguraci:
 *   LEXIS_ESBIRKA_ENABLED=1
 *   LEXIS_ESBIRKA_BASE_URL=https://…            (kořen REST API)
 *   LEXIS_ESBIRKA_TOKEN=…                        (volitelné, dle registrace)
 *   LEXIS_LEGALSOURCES_TIMEOUT_MS=6000           (volitelné)
 *
 * ⚠ MAPOVÁNÍ ODPOVĚDI je PROVIZORNÍ a izolované do _lawQuery/_nonEmpty — přesné
 *   cesty a pole se finalizují proti živému API po registraci (odsud nešlo přečíst
 *   schéma). Bezpečnostní kontrakt (fail-closed, žádná klientská data ven) je hotový
 *   a nezávisí na těch detailech.
 */
'use strict';

const NAME = 'e-Sbírka';
const CAPABILITIES = ['statute'];

// Test seam: injektovatelný fetch (jinak globální fetch Node 18+/22).
let _fetch = (...args) => (typeof globalThis.fetch === 'function'
    ? globalThis.fetch(...args)
    : Promise.reject(new Error('fetch není k dispozici')));
function _setFetchForTests(fn) { _fetch = fn; }

function _cfg() {
    const en = process.env.LEXIS_ESBIRKA_ENABLED;
    return {
        enabled: en === '1' || en === 'true',
        baseUrl: String(process.env.LEXIS_ESBIRKA_BASE_URL || '').replace(/\/+$/, ''),
        token: process.env.LEXIS_ESBIRKA_TOKEN || null,
        timeoutMs: Number(process.env.LEXIS_LEGALSOURCES_TIMEOUT_MS || 6000)
    };
}

function isEnabled() {
    const c = _cfg();
    return c.enabled && !!c.baseUrl;
}

async function _get(path) {
    const c = _cfg();
    if (!c.baseUrl) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), c.timeoutMs);
    try {
        const headers = { Accept: 'application/json' };
        if (c.token) headers.Authorization = 'Bearer ' + c.token;
        const res = await _fetch(c.baseUrl + path, { headers, signal: ac.signal });
        if (!res || !res.ok) return null;          // HTTP chyba → nedostupné (fail-closed)
        return await res.json();
    } catch (e) {
        return null;                                // síť/timeout/abort → nedostupné
    } finally {
        clearTimeout(timer);
    }
}

// ⚠ PROVIZORNÍ: dotaz na předpis podle čísla/roku ("89/2012" → 89, 2012).
function _lawQuery(law) {
    const parts = String(law || '').split('/');
    const cislo = encodeURIComponent(parts[0] || '');
    const rok = encodeURIComponent(parts[1] || '');
    return `/predpisy?cislo=${cislo}&rok=${rok}`;
}

// ⚠ PROVIZORNÍ: rozpozná neprázdnou kolekci výsledků napříč pravděpodobnými tvary.
function _nonEmpty(data) {
    if (!data) return false;
    if (Array.isArray(data)) return data.length > 0;
    if (Array.isArray(data.items)) return data.items.length > 0;
    if (Array.isArray(data.predpisy)) return data.predpisy.length > 0;
    if (Array.isArray(data.results)) return data.results.length > 0;
    if (typeof data.pocet === 'number') return data.pocet > 0;
    return false;
}

/**
 * Ověří existenci zákona (a rámcově §). Vrací {found:boolean} nebo null (nedostupné).
 * Pozn.: ověření KONKRÉTNÍHO paragrafu proti fragmentovému endpointu doplníme při
 * finalizaci schématu; teď potvrzujeme existenci předpisu (silnější než dnešek, kdy
 * bez indexu byla citace neověřitelná).
 */
async function verifyStatute(arg) {
    const law = arg && arg.law;
    if (!law) return null;
    const data = await _get(_lawQuery(law));
    if (data == null) return null;                  // nedostupné → UNKNOWN
    return { found: _nonEmpty(data) };
}

module.exports = { name: NAME, capabilities: CAPABILITIES, isEnabled, verifyStatute, _cfg, _setFetchForTests };
