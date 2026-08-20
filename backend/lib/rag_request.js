/**
 * rag_request.js — přeloží `ragFilters` z těla requestu na filtry pro RAG
 * vyhledávání (rozbalí caseNumber na konkrétní soubory spisu apod.).
 *
 * Sdílené mezi server.js (agent / agent-swarm routy) a routes/rag.js, aby
 * logika žila na jednom místě.
 */
'use strict';

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
    if (scopes.size) f.scopes = [...scopes];
    if (restrictClient) f.clientAccess = false;
    else if (redactClient) f.redactClient = true; // klientský kontext se anonymizuje (viz agent.js)
    return Object.keys(f).length > 0 ? f : null;
}

module.exports = { resolveRagFilters, applyAgentScope };
