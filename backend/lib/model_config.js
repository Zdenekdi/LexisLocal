'use strict';
/**
 * model_config.js — jednotný zdroj výchozích názvů AI modelů.
 *
 * Dříve byl chat model natvrdo "llama3" na ~12 místech (orchestrator, agenti,
 * routy). Nyní je jediný přepínač:
 *   CHAT_MODEL       — výchozí/fallback chat model (default 'llama3')
 *   EMBEDDING_MODEL  — model pro sémantické embeddingy (default 'nomic-embed-text')
 *
 * Bez nastavení env proměnných se chování nemění (zůstává llama3 / nomic-embed-text).
 * setup.js nabídne dle RAM lehčí model a zapíše CHAT_MODEL do .env.
 */

const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

module.exports = { CHAT_MODEL, EMBEDDING_MODEL };
