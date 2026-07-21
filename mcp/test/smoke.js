'use strict';
const http = require('http');
const assert = require('assert');
const { makeApi } = require('../lib/api.js');
const { TOOLS } = require('../lib/tools.js');

const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: u.pathname, token: req.headers['x-api-token'], query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null });
    if (u.pathname === '/api/fail') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'nope' })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: u.pathname }));
  });
});

let pass = 0;
const ok = (n, c) => { assert(c, 'FAIL: ' + n); pass++; console.log('  ✓', n); };

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const api = makeApi('http://127.0.0.1:' + port + '/', 'tok-abc');

  // struktura nástrojů
  ok('11 nástrojů', TOOLS.length === 11);
  ok('každý má name/description/call', TOOLS.every(t => t.name && t.description && typeof t.call === 'function' && t.inputSchema));
  ok('unikátní názvy', new Set(TOOLS.map(t => t.name)).size === TOOLS.length);

  const byName = Object.fromEntries(TOOLS.map(t => [t.name, t]));

  await byName.lexis_status.call(api, {});
  ok('lexis_status → GET /api/status', calls.at(-1).method === 'GET' && calls.at(-1).path === '/api/status');
  ok('token v hlavičce', calls.at(-1).token === 'tok-abc');

  await byName.search_rag.call(api, { query: 'nájem', limit: 3 });
  ok('search_rag → GET /api/rag/search s query', calls.at(-1).path === '/api/rag/search' && calls.at(-1).query.query === 'nájem' && calls.at(-1).query.limit === '3');

  await byName.upload_document.call(api, { fileName: 'a.pdf', base64: 'AAAA' });
  ok('upload_document → POST body', calls.at(-1).method === 'POST' && calls.at(-1).path === '/api/inbox/upload' && calls.at(-1).body.fileName === 'a.pdf');

  await byName.run_agent.call(api, { agentId: 'spisovatel', prompt: 'sepiš žalobu' });
  ok('run_agent → POST /api/agent/spisovatel', calls.at(-1).path === '/api/agent/spisovatel' && calls.at(-1).body.prompt === 'sepiš žalobu');

  await byName.add_calendar_event.call(api, { title: 'Jednání', dueDate: '2026-08-01' });
  ok('add_calendar_event → POST', calls.at(-1).path === '/api/calendar/add' && calls.at(-1).body.title === 'Jednání');

  await byName.check_registry.call(api, { ico: '12345678' });
  ok('check_registry → GET query ico', calls.at(-1).path === '/api/registries/check' && calls.at(-1).query.ico === '12345678');

  // chybová odpověď → throw
  let threw = false;
  try { await api('GET', '/api/fail'); } catch (e) { threw = /HTTP 401/.test(e.message); }
  ok('non-200 vyhodí chybu', threw);

  server.close();
  console.log('\nVŠE PROŠLO: ' + pass + ' kontrol.');
});
