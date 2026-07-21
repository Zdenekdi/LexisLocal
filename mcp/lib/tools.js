'use strict';
const { z } = require('zod');

/**
 * Definice MCP nástrojů = tenká vrstva nad REST API LexisLocalu.
 * Každý nástroj: name, description, inputSchema (Zod raw shape), call(api, args).
 * Zápisové nástroje (upload_document, run_agent, add_calendar_event, log_activity)
 * jsou „agent write" bránou — jak agenti píší do LexisLocalu.
 */
const TOOLS = [
  {
    name: 'lexis_status',
    description: 'Stav LexisLocal serveru: verze, sledovaná složka spisů, aktivní agenti.',
    inputSchema: {},
    call: (api) => api('GET', '/api/status'),
  },
  {
    name: 'search_rag',
    description: 'Sémantické vyhledávání ve spisech (RAG). Vrátí nejrelevantnější úryvky dokumentů.',
    inputSchema: {
      query: z.string().describe('Dotaz v přirozeném jazyce'),
      limit: z.number().int().min(1).max(20).optional().describe('Počet výsledků (default 5)'),
      caseNumber: z.string().optional().describe('Filtr na spisovou značku'),
    },
    call: (api, a) => api('GET', '/api/rag/search', { query: { query: a.query, limit: a.limit ?? 5, caseNumber: a.caseNumber } }),
  },
  {
    name: 'list_inbox',
    description: 'Vypíše všechny dokumenty ve schránce (inbox) LexisLocalu.',
    inputSchema: {},
    call: (api) => api('GET', '/api/inbox/all'),
  },
  {
    name: 'get_document',
    description: 'Vrátí textový obsah dokumentu ze schránky podle názvu souboru.',
    inputSchema: { fileName: z.string().describe('Název souboru vč. přípony') },
    call: (api, a) => api('GET', '/api/inbox/content', { query: { fileName: a.fileName } }),
  },
  {
    name: 'upload_document',
    description: 'Nahraje dokument do schránky LexisLocalu (obsah v base64). Takto agent zapisuje dovnitř.',
    inputSchema: {
      fileName: z.string().describe('Název souboru vč. přípony (např. podani.pdf)'),
      base64: z.string().describe('Obsah souboru zakódovaný v base64'),
    },
    call: (api, a) => api('POST', '/api/inbox/upload', { body: { fileName: a.fileName, base64: a.base64 } }),
  },
  {
    name: 'list_agents',
    description: 'Vypíše dostupné AI agenty (roj) a jejich ID.',
    inputSchema: {},
    call: (api) => api('GET', '/api/agents'),
  },
  {
    name: 'run_agent',
    description: 'Spustí konkrétního LexisLocal agenta (rešeršník, spisovatel, kontrolor…) s promptem a kontextem.',
    inputSchema: {
      agentId: z.string().describe('ID agenta z list_agents (např. resersnik, spisovatel, kontrolor)'),
      prompt: z.string().describe('Zadání pro agenta'),
      context: z.string().optional().describe('Volitelný kontext (např. text dokumentu)'),
      model: z.string().optional().describe('Volitelný model (default dle konfigurace serveru)'),
    },
    call: (api, a) => api('POST', '/api/agent/' + encodeURIComponent(a.agentId), { body: { prompt: a.prompt, context: a.context ?? '', model: a.model } }),
  },
  {
    name: 'add_calendar_event',
    description: 'Přidá událost/lhůtu do kalendáře (soudní jednání, procesní termín…).',
    inputSchema: {
      title: z.string().describe('Název události'),
      dueDate: z.string().describe('Datum (ISO 8601 nebo YYYY-MM-DD)'),
      time: z.string().optional().describe('Čas HH:MM'),
      location: z.string().optional(),
      context: z.string().optional().describe('Poznámka / kontext'),
      spisovaZnacka: z.string().optional(),
    },
    call: (api, a) => api('POST', '/api/calendar/add', { body: a }),
  },
  {
    name: 'log_activity',
    description: 'Zapíše výkon/úkon (time tracking) k dokumentu.',
    inputSchema: {
      documentName: z.string().describe('Název dokumentu / věci'),
      hours: z.number().describe('Počet hodin'),
      actionType: z.string().optional().describe('Typ úkonu'),
      date: z.string().optional().describe('Datum (YYYY-MM-DD)'),
    },
    call: (api, a) => api('POST', '/api/activity/custom', { body: a }),
  },
  {
    name: 'anonymize_text',
    description: 'Anonymizuje osobní údaje v textu (GDPR Sovereign Shield).',
    inputSchema: { text: z.string().describe('Text k anonymizaci') },
    call: (api, a) => api('POST', '/api/document/anonymize', { body: { text: a.text } }),
  },
  {
    name: 'check_registry',
    description: 'Ověří subjekt ve veřejných registrech podle IČO.',
    inputSchema: { ico: z.string().describe('IČO subjektu (8 číslic)') },
    call: (api, a) => api('GET', '/api/registries/check', { query: { ico: a.ico } }),
  },
];

module.exports = { TOOLS };
