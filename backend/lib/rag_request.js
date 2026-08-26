/**
 * rag_request.js — přeloží `ragFilters` z těla requestu na filtry pro RAG
 * vyhledávání (rozbalí caseNumber na konkrétní soubory spisu apod.).
 *
 * Sdílené mezi server.js (agent / agent-swarm routy) a routes/rag.js, aby
 * logika žila na jednom místě.
 */
'use strict';

// --- Oborově dělený RAG -------------------------------------------------------
// Judikatura se plní do oborových partitionů `_kb_obor_<slug>`; slug se odvozuje
// z volného pole `agenda` spisu (viz spisy.js). STEJNÁ funkce se použije při
// plnění (routes/knowledge.js) i při dotazu, aby se scope trefily.
function oborSlug(agenda) {
    return String(agenda == null ? '' : agenda)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // deakcent
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
}
function oborScope(agenda) {
    const slug = oborSlug(agenda);
    return slug ? '_kb_obor_' + slug : null;
}

// `watcher` (a jeho závislost `ocr`) načítáme LÍNĚ až uvnitř resolveRagFilters —
// aby se dal modul (a applyAgentScope) použít bez roztažení celého watcher řetězce.

async function resolveRagFilters(reqBody) {
    if (!reqBody || !reqBody.ragFilters) return null;
    const { ragFilters } = reqBody;

    let fileNames = [];
    if (Array.isArray(ragFilters.fileNames)) {
        fileNames = [...ragFilters.fileNames];
    }

    if (ragFilters.caseNumber) {
        try {
            const { loadInbox } = require('./watcher');
            const inbox = await loadInbox();
            const caseFiles = Object.values(inbox.files || {})
                .filter(f => f.caseNumber === ragFilters.caseNumber)
                .map(f => f.relativePath || f.fileName);
            fileNames = [...new Set([...fileNames, ...caseFiles])];
        } catch (err) {
            console.warn("⚠️ RAG Filter: Nepodařilo se načíst spisy pro caseNumber:", err.message);
        }
    }

    const filters = {};
    if (fileNames.length > 0) {
        filters.fileNames = fileNames;
    }
    if (ragFilters.directory) {
        filters.directory = ragFilters.directory;
    }
    if (ragFilters.strict !== undefined) {
        filters.strict = ragFilters.strict;
    }

    // Oborový scope (dělený RAG): explicitní `obor`, jinak z `agenda` spisu dle caseNumber.
    let oborAgenda = ragFilters.obor || '';
    if (!oborAgenda && ragFilters.caseNumber) {
        try {
            const spisy = require('./spisy');
            const spis = spisy.findByCase(ragFilters.caseNumber);
            if (spis && spis.agenda) oborAgenda = spis.agenda;
        } catch (e) { /* spisy modul nedostupný → dotaz jede bez oborového scope */ }
    }
    const scope = oborScope(oborAgenda);
    if (scope) {
        filters.scopes = Array.isArray(filters.scopes) ? filters.scopes : [];
        if (!filters.scopes.includes(scope)) filters.scopes.push(scope);
    }

    return Object.keys(filters).length > 0 ? filters : null;
}

/**
 * Doplní do RAG filtrů zaměření AGENTA (per-agent RAG + úroveň přístupu ke spisům):
 *   • přidá vlastní znalostní bázi agenta (`knowledgeScope` → filters.scopes),
 *   • pokud agent nemá přístup ke klientským spisům (`spisAccess === 'none'`),
 *     nastaví `clientAccess:false` (agent pak čerpá JEN z vlastní báze).
 * Přijímá jednoho agenta i pole (debata dvou agentů) — scopes se sjednotí a přístup
 * ke klientským spisům se omezí, jakmile ho NEMÁ kterýkoli z účastníků (konzervativně).
 * Vrací nový objekt (nemutuje vstup); null když nevzniknou žádné filtry.
 */
function applyAgentScope(filters, agentOrAgents) {
    const agents = Array.isArray(agentOrAgents) ? agentOrAgents : [agentOrAgents];
    const f = filters ? { ...filters } : {};
    const scopes = new Set(Array.isArray(f.scopes) ? f.scopes : []);
    // Nejpřísnější úroveň napříč účastníky vyhrává: none > redacted > full.
    let restrictClient = false;   // 'none'
    let redactClient = false;     // 'redacted'
    for (const a of agents) {
        if (!a) continue;
        if (a.knowledgeScope) scopes.add(a.knowledgeScope);
        if (a.spisAccess === 'none') restrictClient = true;
        else if (a.spisAccess === 'redacted') redactClient = true;
    }
    // Judikatura (společná báze): má-li ji některý účastník zapnutou, přidej VŠECHNY
    // judikaturní scopy → celoplošné sémantické hledání. Obor jen zpřesňuje (viz oborScope).
    if (agents.some(a => a && a.useJudikatura)) {
        try {
            const rag = require('./rag');
            if (typeof rag.listJudikaturaScopes === 'function') {
                for (const sc of rag.listJudikaturaScopes()) scopes.add(sc);
            }
        } catch (e) { /* rag nedostupný → bez judikatury */ }
    }
    if (scopes.size) f.scopes = [...scopes];
    if (restrictClient) f.clientAccess = false;
    else if (redactClient) f.redactClient = true; // klientský kontext se anonymizuje (viz agent.js)
    return Object.keys(f).length > 0 ? f : null;
}

module.exports = { resolveRagFilters, applyAgentScope, oborSlug, oborScope };
