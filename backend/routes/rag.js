/**
 * routes/rag.js — sémantické vyhledávání a správa vektorového indexu.
 * Montuje se v server.js na /api/rag.
 */
'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { indexDocument, searchSimilar, loadIndex } = require('../lib/rag');
const { loadInbox } = require('../lib/watcher');
const { logEvent } = require('../lib/audit');
const { resolveRagFilters } = require('../lib/rag_request');

// GET /api/rag/search - Sémantické vyhledávání v podkladech
router.get('/search', async (req, res) => {
    const { query, limit, caseNumber, fileNames } = req.query;
    if (!query) {
        return res.status(400).json({ error: "Vyhledávací dotaz je povinný." });
    }
    const searchLimit = limit ? parseInt(limit) : 5;
    try {
        let resolvedFilters = null;
        let filterPayload = { ragFilters: {} };
        if (fileNames) {
            filterPayload.ragFilters.fileNames = fileNames.split(',').map(f => f.trim());
        }
        if (caseNumber) {
            filterPayload.ragFilters.caseNumber = caseNumber.trim();
        }

        if (fileNames || caseNumber) {
            resolvedFilters = await resolveRagFilters(filterPayload);
        }

        const matches = await searchSimilar(query, searchLimit, resolvedFilters);
        res.json({ query, matches });
    } catch (err) {
        res.status(500).json({ error: `Chyba sémantického vyhledávání: ${err.message}` });
    }
});

// GET /api/rag/status - Retrieve vector database size and metrics
router.get('/status', async (req, res) => {
    try {
        const index = await loadIndex();
        const uniqueFiles = new Set(index.chunks.map(c => c.fileName));
        res.json({
            chunksCount: index.chunks.length,
            filesCount: uniqueFiles.size,
            embeddingModel: 'nomic-embed-text'
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při čtení stavu RAG: ${err.message}` });
    }
});

// POST /api/rag/reindex-all - Reindex all documents from inbox on-demand
router.post('/reindex-all', async (req, res) => {
    console.log("⚡ RAG: Spouštím kompletní re-indexaci všech souborů...");
    try {
        const inbox = await loadInbox();
        const files = Object.values(inbox.files);

        let successCount = 0;
        for (const file of files) {
            if (file.filePath && fs.existsSync(file.filePath)) {
                let content = "";
                const ext = path.extname(file.filePath).toLowerCase();
                try {
                    if (ext === '.pdf') {
                        const pdfParser = require('pdf-parse');
                        const dataBuffer = await fs.promises.readFile(file.filePath);
                        const parsedPdf = await pdfParser(dataBuffer);
                        content = parsedPdf.text;
                    } else {
                        content = await fs.promises.readFile(file.filePath, 'utf-8');
                    }
                    if (content && content.trim()) {
                        await indexDocument(file.relativePath || file.fileName, content);
                        successCount++;
                    }
                } catch (parseErr) {
                    console.warn(`⚠️ RAG: Přeskakuji soubor ${file.fileName} kvůli chybě:`, parseErr.message);
                }
            }
        }
        logEvent('LexisLocal Dashboard', 'Re-indexace spisy', 'Všechny spisy', {
            successCount
        });

        res.json({
            success: true,
            message: `Re-indexace dokončena. Úspěšně přegenerováno ${successCount} z ${files.length} souborů.`
        });
    } catch (err) {
        res.status(500).json({ error: `Chyba při re-indexaci: ${err.message}` });
    }
});

module.exports = router;
