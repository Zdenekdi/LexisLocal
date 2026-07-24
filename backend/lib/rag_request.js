/**
 * rag_request.js — přeloží `ragFilters` z těla requestu na filtry pro RAG
 * vyhledávání (rozbalí caseNumber na konkrétní soubory spisu apod.).
 *
 * Sdílené mezi server.js (agent / agent-swarm routy) a routes/rag.js, aby
 * logika žila na jednom místě.
 */
'use strict';

const { loadInbox } = require('./watcher');

async function resolveRagFilters(reqBody) {
    if (!reqBody || !reqBody.ragFilters) return null;
    const { ragFilters } = reqBody;

    let fileNames = [];
    if (Array.isArray(ragFilters.fileNames)) {
        fileNames = [...ragFilters.fileNames];
    }

    if (ragFilters.caseNumber) {
        try {
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

module.exports = { resolveRagFilters };
