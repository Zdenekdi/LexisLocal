#!/usr/bin/env node
'use strict';
/**
 * LexisLocal MCP server (stdio).
 * Zpřístupňuje REST API LexisLocalu jako MCP nástroje pro Claude, Claude Code i agenty.
 *
 * Konfigurace přes proměnné prostředí:
 *   LEXISLOCAL_URL        (default http://127.0.0.1:4000)
 *   LEXISLOCAL_API_TOKEN  (token; viz per-agent tokeny v LexisLocalu)
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { spawn } = require('child_process');
const { makeApi, waitForBackend } = require('./lib/api.js');
const { TOOLS } = require('./lib/tools.js');

const BASE_URL = process.env.LEXISLOCAL_URL || 'http://127.0.0.1:4000';
const TOKEN = process.env.LEXISLOCAL_API_TOKEN || '';
const api = makeApi(BASE_URL, TOKEN);

function buildServer() {
  const server = new McpServer({ name: 'lexislocal', version: '1.0.0' });
  for (const t of TOOLS) {
    server.tool(t.name, t.description, t.inputSchema, async (args) => {
      try {
        const result = await t.call(api, args || {});
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (e) {
        return { content: [{ type: 'text', text: '❌ ' + e.message }], isError: true };
      }
    });
  }
  return server;
}

// Health-check + volitelný auto-start LexisLocal backendu.
// LEXISLOCAL_AUTOSTART_CMD = shell příkaz ke spuštění backendu (např. "docker compose up -d").
async function ensureBackend() {
  const AUTOSTART = process.env.LEXISLOCAL_AUTOSTART_CMD || '';
  if (await waitForBackend(api, { retries: 1 })) {
    console.error(`✅ LexisLocal dostupný na ${BASE_URL}.`);
    return;
  }
  if (AUTOSTART) {
    console.error(`⚠️ LexisLocal nedostupný na ${BASE_URL}. Spouštím: ${AUTOSTART}`);
    try {
      const child = spawn(AUTOSTART, { shell: true, stdio: 'ignore', detached: true });
      child.unref();
    } catch (e) {
      console.error('❌ Auto-start selhal:', e.message);
    }
    const up = await waitForBackend(api, { retries: 20, delayMs: 3000 });
    console.error(up ? `✅ LexisLocal naběhl na ${BASE_URL}.` : '❌ LexisLocal se nepodařilo nastartovat včas.');
  } else {
    console.error(`⚠️ LexisLocal backend nedostupný na ${BASE_URL}.\n   Spusť ho: "docker compose up -d" nebo "npm run dev" v kořeni projektu.\n   (Pro automatické spuštění nastav LEXISLOCAL_AUTOSTART_CMD.)`);
  }
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`LexisLocal MCP server běží (stdio). Cíl: ${BASE_URL}, ${TOOLS.length} nástrojů${TOKEN ? '' : ' (BEZ tokenu)'}.`);
  // Nesmí zablokovat MCP handshake → spouštíme po connect.
  ensureBackend().catch((e) => console.error('Health-check chyba:', e.message));
}

if (require.main === module) {
  main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = { buildServer, api, TOOLS };
