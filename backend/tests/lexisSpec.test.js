/**
 * Test parseru vnořeného LexisEditor specu z .docx custom XML (lib/lexis-spec.js).
 * Čistá část (parseLexisSpecXml) — nezávisí na unzip ani na fixture .docx.
 */
'use strict';
const { parseLexisSpecXml, extractLexisSpecFromDocx } = require('../lib/lexis-spec');

const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
const wrap = (payload) => `<?xml version="1.0"?><lexisSpec xmlns="urn:lexiseditor:spec" enc="base64">${payload}</lexisSpec>`;

describe('parseLexisSpecXml', () => {
    test('validní custom XML → spec objekt', () => {
        const spec = { title: 'Odvolání', blocks: [{ type: 'paragraph', id: 'p1', text: 'X' }] };
        expect(parseLexisSpecXml(wrap(b64(spec)))).toEqual(spec);
    });
    test('XML bez lexisSpec → null', () => {
        expect(parseLexisSpecXml('<?xml version="1.0"?><foo/>')).toBeNull();
    });
    test('poškozený base64 → null (bez pádu)', () => {
        expect(parseLexisSpecXml(wrap('%%%není-base64%%%'))).toBeNull();
    });
    test('prázdný / nevalidní vstup → null', () => {
        expect(parseLexisSpecXml('')).toBeNull();
        expect(parseLexisSpecXml(null)).toBeNull();
        expect(parseLexisSpecXml(undefined)).toBeNull();
    });
});

describe('extractLexisSpecFromDocx — guardy bez I/O', () => {
    test('ne-.docx cesta → null', async () => {
        expect(await extractLexisSpecFromDocx('/tmp/soubor.pdf')).toBeNull();
        expect(await extractLexisSpecFromDocx('')).toBeNull();
        expect(await extractLexisSpecFromDocx(null)).toBeNull();
    });
});
