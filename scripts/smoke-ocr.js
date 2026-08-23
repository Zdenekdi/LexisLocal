/**
 * scripts/smoke-ocr.js — ověří rizikovou cestu OCR: pdfjs-dist v6 (ESM) + canvas render.
 * Přesně to, co dělá backend/lib/ocr.js (render PDF stránky do PNG). Spusť na Macu:
 *   node scripts/smoke-ocr.js
 */
'use strict';

function buildMinimalPDF() {
    const objs = [
        '<</Type/Catalog/Pages 2 0 R>>',
        '<</Type/Pages/Kids[3 0 R]/Count 1>>',
        '<</Type/Page/Parent 2 0 R/MediaBox[0 0 160 120]/Contents 4 0 R>>',
        '<</Length 46>>\nstream\nBT /F1 20 Tf 20 50 Td (LexisLocal) Tj ET\nendstream'
    ];
    let pdf = '%PDF-1.4\n'; const off = [];
    objs.forEach((o, i) => { off.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    off.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
    pdf += 'trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
    return Buffer.from(pdf, 'latin1');
}

(async () => {
    console.log('\n🧪 OCR render check (pdfjs-dist v6 + canvas)\n');
    try {
        let pdfjs;
        try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); console.log('✅ pdfjs načten (ESM .mjs — v6)'); }
        catch (e) { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); console.log('✅ pdfjs načten (CJS .js — v5 fallback)'); }

        try { pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'); }
        catch (e) { try { pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js'); } catch (e2) { pdfjs.GlobalWorkerOptions.workerSrc = ''; } }

        const doc = await pdfjs.getDocument({ data: new Uint8Array(buildMinimalPDF()), isEvalSupported: false }).promise;
        console.log('✅ getDocument OK, stránek:', doc.numPages);
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 2.0 });
        const { createCanvas } = require('canvas');
        const canvas = createCanvas(vp.width, vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const png = canvas.toBuffer('image/png');
        console.log('✅ render do PNG OK, bytes:', png.length);
        if (png.length > 100) { console.log('\n🎉 OCR render funguje (pdfjs v6 + canvas).\n'); process.exit(0); }
        console.log('\n❌ PNG je podezřele malý.\n'); process.exit(1);
    } catch (e) {
        console.log('\n❌ OCR render SELHAL:', e.message);
        console.log('   Tip: spusť `npm install` (kvůli pdfjs v6 a nativnímu canvasu na tvém Macu).\n');
        process.exit(1);
    }
})();
