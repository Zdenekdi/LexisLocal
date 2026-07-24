/**
 * ollama_client.js — jeden sdílený Ollama klient.
 * Podporuje CommonJS i ESM default export knihovny `ollama`.
 * Sdílené mezi server.js (agent / agent-swarm) a routery (models, system).
 */
'use strict';

const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

module.exports = ollama;
