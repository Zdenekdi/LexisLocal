/**
 * lexis-spec.js — přečte LexisEditor „spec" (JSON) vnořený v .docx jako custom XML
 * part (customXml/item1.xml, <lexisSpec enc="base64">…</lexisSpec>). Zapisuje ho
 * LexisEditor (js/export/spec-embed.js). Word tuto část ignoruje.
 *
 * Bez závislosti na jszip — používá nativní `unzip -p` (stejně jako lib/ocr.js),
 * takže .docx uložený LexisEditorem lze v LexisLocalu otevřít BEZ ZTRÁTY struktury.
 *
 * parseLexisSpecXml(xml)          -> spec | null   (čistá funkce, testovatelná)
 * extractLexisSpecFromDocx(path)  -> Promise<spec|null>
 */
'use strict';

const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

// Čistá část: z obsahu customXml/item1.xml vytáhne base64 a dekóduje na JSON spec.
function parseLexisSpecXml(xml) {
    if (!xml || typeof xml !== 'string') return null;
    const m = xml.match(/<lexisSpec[^>]*>([\s\S]*?)<\/lexisSpec>/);
    if (!m) return null;
    try {
        return JSON.parse(Buffer.from(m[1].trim(), 'base64').toString('utf-8'));
    } catch (e) {
        return null;
    }
}

async function extractLexisSpecFromDocx(filePath) {
    if (!filePath || !/\.docx$/i.test(filePath)) return null;
    let xml;
    try {
        // Cesta k položce se předává polem (ne shellem) → bez rizika injektáže.
        const { stdout } = await execFileAsync('unzip', ['-p', filePath, 'customXml/item1.xml'], {
            encoding: 'utf-8',
            maxBuffer: 50 * 1024 * 1024
        });
        xml = stdout;
    } catch (e) {
        // Položka v archivu není → .docx nemá LexisEditor spec (cizí Word soubor).
        return null;
    }
    return parseLexisSpecXml(xml);
}

module.exports = { extractLexisSpecFromDocx, parseLexisSpecXml };
