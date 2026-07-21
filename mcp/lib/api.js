'use strict';
/**
 * Tenký HTTP klient pro LexisLocal REST API.
 * Autentizace přes X-API-Token (viz per-agent tokeny v LexisLocal).
 */
function makeApi(baseUrl, token) {
  const BASE = (baseUrl || 'http://127.0.0.1:4000').replace(/\/$/, '');
  return async function api(method, path, opts = {}) {
    const url = new URL(BASE + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = { Accept: 'application/json' };
    if (token) headers['X-API-Token'] = token;
    const init = { method, headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { data = raw; }
    if (!res.ok) {
      const msg = typeof data === 'string' ? data : (data && data.error) || JSON.stringify(data);
      throw new Error(`LexisLocal ${method} ${path} → HTTP ${res.status}: ${msg}`);
    }
    return data;
  };
}

/**
 * Počká, až bude LexisLocal backend dostupný (GET /api/status projde).
 * Vrátí true/false. Používá se pro health-check a auto-start.
 */
async function waitForBackend(api, opts = {}) {
  const retries = opts.retries || 1;
  const delayMs = opts.delayMs || 1500;
  for (let i = 0; i < retries; i++) {
    try {
      await api('GET', '/api/status');
      return true;
    } catch (e) {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

module.exports = { makeApi, waitForBackend };
