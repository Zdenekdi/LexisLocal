/**
 * routes/document.js — archivace (Dublin Core) a anonymizace textu (GDPR).
 * Montuje se v server.js na /api/document.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { generateDublinCoreXml } = require('../lib/archival');
const { anonymizeText } = require('../lib/anonymizer');

// POST /api/document/archive - Vygeneruje Dublin Core XML metadata
router.post('/archive', (req, res) => {
    const { title, creator, subject, description, type, language, rights } = req.body;
    try {
        const xml = generateDublinCoreXml({
            title,
            creator,
            subject,
            description,
            type,
            language,
            rights
        });

        res.setHeader('Content-type', 'application/xml');
        res.write(xml);
        res.end();
    } catch (err) {
        res.status(500).json({ error: `Chyba při generování metadat pro archivaci: ${err.message}` });
    }
});

// POST /api/document/anonymize - Anonymize text containing GDPR sensitive terms
router.post('/anonymize', (req, res) => {
    const { text } = req.body;
    if (text === undefined) {
        return res.status(400).json({ error: "Text k anonymizaci je povinný." });
    }
    try {
        const anonymized = anonymizeText(text);
        res.json({ anonymized });
    } catch (err) {
        res.status(500).json({ error: `Chyba při anonymizaci: ${err.message}` });
    }
});

module.exports = router;
