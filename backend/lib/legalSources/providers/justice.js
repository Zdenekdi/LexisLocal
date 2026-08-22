/**
 * providers/justice.js — poskytovatel JUDIKATURY (ověření spisové značky) z
 * oficiálních otevřených dat české justice (data.justice.cz / sbírky NSS a NS).
 *
 * Konfigurovatelný, VÝCHOZE VYPNUTÝ (přesná koncová URL/schéma se liší dle zdroje):
 *   LEXIS_JUSTICE_ENABLED=1
 *   LEXIS_JUSTICE_URL=https://…            (kořen; dotaz ?spisznacka=)
 *   LEXIS_JUSTICE_URL_TEMPLATE=https://…{q}…  (alternativa s {q} = URL-enkódovaná sp. zn.)
 *   LEXIS_JUSTICE_TOKEN=…                   (volitelné)
 *
 * ⚠ Mapování odpovědi (_nonEmpty) je provizorní — finalizovat proti zvolenému zdroji.
 * Bezpečnostní kontrakt (fail-closed, jen POTVRZENÍ existence) nezávisí na detailech.
 */
'use strict';

const NAME = 'justice.cz';
const CAPABILITIES = ['caseLaw'];

let _fetch = (...args) => (typeof globalThis.fetch === 'function'
    ? globalThis.fetch(...args)
    : Promise.reject(new Error('fetch není k dispozici')));
function _setFetchForTests(fn) { _fetch = fn; }

function _cfg() {
    const en = process.env.LEXIS_JUSTICE_ENABLED;
    return {
        enabled: en === '1' || en === 'true',
        baseUrl: String(process.env.LEXIS_JUSTICE_URL || '').replace(/\/+$/, ''),
        urlTemplate: String(process.env.LEXIS_JUSTICE_URL_TEMPLATE || ''),
        token: process.env.LEXIS_JUSTICE_TOKEN || null,
        timeoutMs: Number(process.env.LEXIS_LEGALSOURCES_TIMEOUT_MS || 6000)
    };
}

function isEnabled() {
    const c = _cfg();
    return c.enabled && (!!c.baseUrl || !!c.urlTemplate);
}

function _query(spisZn) {
    const c = _cfg();
    const q = encodeURIComponent(String(spisZn || '').trim());
    if (c.urlTemplate) return c.urlTemplate.replace('{q}', q);
    return c.baseUrl + '/rozhodnuti?spisznacka=' + q;
}

function _nonEmpty(data) {
    if (!data) return false;
    if (Array.isArray(data)) return data.length > 0;
    if (Array.isArray(data.items)) return data.items.length > 0;
    if (Array.isArray(data.rozhodnuti)) return data.rozhodnuti.length > 0;
    if (Array.isArray(data.results)) return data.results.length > 0;
    if (typeof data.pocet === 'number') return data.pocet > 0;
    if (typeof data.total === 'number') return data.total > 0;
    return false;
}

async function _get(url) {
    const c = _cfg();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), c.timeoutMs);
    try {
        const headers = { Accept: 'application/json' };
        if (c.token) headers.Authorization = 'Bearer ' + c.token;
        const res = await _fetch(url, { headers, signal: ac.signal });
        if (!res || !res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function verifyCaseLaw(arg) {
    const spisZn = arg && arg.spisZn;
    if (!spisZn) return null;
    const data = await _get(_query(spisZn));
    if (data == null) return null;         // nedostupné → UNKNOWN
    return { found: _nonEmpty(data) };
}

module.exports = { name: NAME, capabilities: CAPABILITIES, isEnabled, verifyCaseLaw, _cfg, _setFetchForTests };
