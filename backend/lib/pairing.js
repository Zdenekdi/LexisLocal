'use strict';

/**
 * lib/pairing.js — LexisLink párování (LAN).
 *
 * Jednorázové, krátkodobé párovací kódy pro spárování telefonu s /m.
 * Token se do QR NIKDY nedává přímo — QR nese jen jednorázový kód, který
 * telefon vymění za token přes POST /api/pair/claim. Kód:
 *   • má krátkou životnost (TTL),
 *   • je použitelný právě jednou (po claim se smaže),
 *   • je náhodný (~48 bitů), takže se nedá rozumně uhodnout.
 * Úložiště je čistě v paměti (přežije jen běh procesu) — pro párování stačí.
 */

const crypto = require('crypto');
const os = require('os');

const TTL_MS = 120 * 1000; // 2 minuty
const codes = new Map(); // code -> { token, expiresAt }

function _sweep() {
    const now = Date.now();
    for (const [c, v] of codes) if (v.expiresAt <= now) codes.delete(c);
}

/** Vytvoří jednorázový párovací kód pro daný token. */
function createCode(token) {
    _sweep();
    const code = crypto.randomBytes(6).toString('base64url'); // ~8 znaků
    const expiresAt = Date.now() + TTL_MS;
    codes.set(code, { token, expiresAt });
    return { code, ttl: Math.floor(TTL_MS / 1000), expiresAt };
}

/** Vymění kód za token. Vrací token, nebo null (neplatný/expirovaný/použitý). */
function claim(code) {
    _sweep();
    if (!code || typeof code !== 'string') return null;
    const rec = codes.get(code);
    if (!rec) return null;
    codes.delete(code); // jednorázové — spotřebováno ihned
    if (rec.expiresAt <= Date.now()) return null;
    return rec.token;
}

/** LAN IPv4 adresy tohoto stroje (bez loopbacku). */
function lanIPv4() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const ni of ifs[name] || []) {
            if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
        }
    }
    return out;
}

/** Sestaví URL do QR: http://<LANIP>:<port>/m?pair=<code> pro každou LAN IP. */
function buildUrls(port, code) {
    return lanIPv4().map(ip => `http://${ip}:${port}/m?pair=${encodeURIComponent(code)}`);
}

module.exports = { createCode, claim, lanIPv4, buildUrls, TTL_MS };
