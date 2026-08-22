/**
 * legalSources — abstrakce POSKYTOVATELŮ PRÁVNÍCH ZDROJŮ (free-first).
 *
 * Sjednocené API pro ověření/dotažení práva z autoritativních zdrojů:
 *   verifyStatute({law, paragraph}) — existuje zákon/§?
 *   verifyCaseLaw({spisZn})         — existuje spisová značka (judikát)?
 *
 * Filozofie (shodná s citation_verifier.js): zdroj může citaci POTVRDIT, nikdy ji
 * naslepo neprohlásí za pravou. FAIL-CLOSED: když je zdroj nedostupný/vypnutý,
 * vrací UNKNOWN ({ok:false}) — volající pak citaci NEČÍ jinak, než by udělal bez
 * zdroje. Klientská data ven nejdou; posílá se jen rešeršní dotaz (číslo zákona,
 * §, sp. zn.).
 *
 * Návratový kontrakt agregace:
 *   { ok:true,  found:true,  source }  — zdroj potvrdil existenci
 *   { ok:true,  found:false }          — zdroj odpověděl a NEnašel
 *   { ok:false, reason }               — nikdo nezapnutý / nedostupné → UNKNOWN
 *
 * Provider (viz providers/*.js): { name, capabilities:[...], isEnabled(),
 *   verifyStatute?(arg):Promise<{found:boolean}|null>, verifyCaseLaw?(arg):... }
 *   null / vyhozená chyba z metody = zdroj nedostupný (přeskočí se).
 */
'use strict';

const esbirka = require('./providers/esbirka');

// Pořadí = priorita. Další providery (justice.cz open data, Salvia MCP) sem přibudou.
let _providers = [esbirka];

function _enabled(capability) {
    return _providers.filter(p =>
        p && Array.isArray(p.capabilities) &&
        p.capabilities.indexOf(capability) !== -1 &&
        (() => { try { return p.isEnabled(); } catch (e) { return false; } })()
    );
}

async function _aggregate(capability, method, arg) {
    const provs = _enabled(capability);
    if (provs.length === 0) return { ok: false, reason: 'no-provider' };
    let anyReachable = false;
    for (const p of provs) {
        try {
            const r = await p[method](arg);
            if (r == null) continue;               // nedostupné → další provider
            anyReachable = true;
            if (r.found) return { ok: true, found: true, source: p.name };
        } catch (e) { /* nedostupné → další provider */ }
    }
    if (anyReachable) return { ok: true, found: false };
    return { ok: false, reason: 'unreachable' };
}

function verifyStatute(arg) { return _aggregate('statute', 'verifyStatute', arg || {}); }
function verifyCaseLaw(arg) { return _aggregate('caseLaw', 'verifyCaseLaw', arg || {}); }

function listProviders() {
    return _providers.map(p => {
        let enabled = false;
        try { enabled = p.isEnabled(); } catch (e) { enabled = false; }
        return { name: p.name, capabilities: p.capabilities, enabled };
    });
}

// Test seam: vložení vlastních providerů.
function _setProvidersForTests(arr) { _providers = Array.isArray(arr) ? arr.slice() : [esbirka]; }
function _resetProviders() { _providers = [esbirka]; }

module.exports = { verifyStatute, verifyCaseLaw, listProviders, _setProvidersForTests, _resetProviders };
