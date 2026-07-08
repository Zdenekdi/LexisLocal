/**
 * LexisLocal Sovereign Long-Term Archival Module (Dublin Core XML metadata generator)
 * Conforming to ISO 15836 / EU standards for electronic document preservation (PDF/A).
 */

const crypto = require('crypto');

/**
 * Generates an XML sidecar containing Dublin Core metadata for a document.
 * @param {object} metadata - Document properties (title, creator, description, type, language, etc.)
 * @returns {string} - XML string conforming to Dublin Core Metadata Element Set.
 */
function generateDublinCoreXml(metadata = {}) {
    const title = escapeXml(metadata.title || 'Nepojmenovaný dokument');
    const creator = escapeXml(metadata.creator || 'LexisLocal Agent');
    const subject = escapeXml(metadata.subject || 'Právní dokument');
    const description = escapeXml(metadata.description || 'Automaticky vygenerovaný dokument');
    const date = escapeXml(metadata.date || new Date().toISOString());
    const type = escapeXml(metadata.type || 'Text / Smlouva');
    const format = escapeXml(metadata.format || 'application/pdf');
    const identifier = escapeXml(metadata.identifier || `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`);
    const language = escapeXml(metadata.language || 'cs');
    const rights = escapeXml(metadata.rights || 'Důvěrné / Advokátní tajemství');

    return `<?xml version="1.0" encoding="UTF-8"?>
<metadata
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${title}</dc:title>
  <dc:creator>${creator}</dc:creator>
  <dc:subject>${subject}</dc:subject>
  <dc:description>${description}</dc:description>
  <dc:date>${date}</dc:date>
  <dc:type>${type}</dc:type>
  <dc:format>${format}</dc:format>
  <dc:identifier>${identifier}</dc:identifier>
  <dc:language>${language}</dc:language>
  <dc:rights>${rights}</dc:rights>
</metadata>`;
}

/**
 * Helper to escape XML special characters.
 */
function escapeXml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

module.exports = {
    generateDublinCoreXml,
    escapeXml
};
