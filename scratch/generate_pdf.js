const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Simple Markdown to HTML Parser
function markdownToHtml(md) {
    let html = '';
    const lines = md.split('\n');
    let inList = false;
    let inCode = false;
    let codeLang = '';
    let codeBlockContent = '';
    let inTable = false;
    let tableHeaders = [];
    let tableRows = [];

    // CSS styling for beautiful PDF
    const style = `
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
        
        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            color: #1e293b;
            line-height: 1.6;
            font-size: 11pt;
            margin: 0;
            padding: 0;
        }
        h1, h2, h3, h4 {
            font-family: 'Outfit', sans-serif;
            color: #0f172a;
            font-weight: 700;
            margin-top: 1.8em;
            margin-bottom: 0.5em;
            page-break-after: avoid;
        }
        h1 {
            font-size: 24pt;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 8px;
            margin-top: 0;
            color: #1e3a8a;
        }
        h2 {
            font-size: 16pt;
            border-bottom: 1px solid #f1f5f9;
            padding-bottom: 6px;
            color: #0f172a;
        }
        h3 {
            font-size: 13pt;
            color: #2563eb;
        }
        p {
            margin-top: 0;
            margin-bottom: 1em;
            text-align: justify;
        }
        blockquote {
            margin: 1.5em 0;
            padding: 10px 20px;
            background-color: #f8fafc;
            border-left: 4px solid #10b981;
            border-radius: 4px;
            color: #475569;
            font-style: italic;
        }
        ul, ol {
            margin-top: 0;
            margin-bottom: 1em;
            padding-left: 20px;
        }
        li {
            margin-bottom: 0.4em;
        }
        pre {
            background-color: #0f172a;
            color: #f8fafc;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Fira Code', monospace;
            font-size: 9pt;
            overflow-x: auto;
            margin: 1.5em 0;
            white-space: pre-wrap;
            word-break: break-all;
            page-break-inside: avoid;
        }
        code {
            font-family: 'Fira Code', monospace;
            background-color: #f1f5f9;
            color: #0f172a;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9.5pt;
        }
        pre code {
            background-color: transparent;
            color: inherit;
            padding: 0;
            font-size: inherit;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5em 0;
            font-size: 10pt;
            page-break-inside: avoid;
        }
        th, td {
            border: 1px solid #cbd5e1;
            padding: 10px 12px;
            text-align: left;
        }
        th {
            background-color: #f1f5f9;
            color: #0f172a;
            font-weight: 600;
        }
        tr:nth-child(even) {
            background-color: #f8fafc;
        }
        hr {
            border: none;
            border-top: 1px solid #e2e8f0;
            margin: 2em 0;
        }
        .page-break {
            page-break-before: always;
        }
        .center {
            text-align: center;
        }
        .title-subtitle {
            font-size: 14pt;
            color: #64748b;
            margin-top: -10px;
            margin-bottom: 30px;
        }
    `;

    for (let line of lines) {
        let trimmed = line.trim();

        // Code block toggle
        if (trimmed.startsWith('```')) {
            if (inCode) {
                inCode = false;
                html += `<pre><code class="language-${codeLang}">${escapeHtml(codeBlockContent.trim())}</code></pre>\n`;
                codeBlockContent = '';
            } else {
                inCode = true;
                codeLang = trimmed.substring(3).trim();
            }
            continue;
        }

        if (inCode) {
            codeBlockContent += line + '\n';
            continue;
        }

        // Table parser
        if (trimmed.startsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableHeaders = [];
                tableRows = [];
            }
            // Parse cells
            const cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (line.includes('---')) {
                // Separator, ignore
                continue;
            }
            if (tableHeaders.length === 0) {
                tableHeaders = cells;
            } else {
                tableRows.push(cells);
            }
            continue;
        } else {
            if (inTable) {
                inTable = false;
                // Render table
                html += '<table><thead><tr>';
                tableHeaders.forEach(h => {
                    html += `<th>${inlineFormatting(h)}</th>`;
                });
                html += '</tr></thead><tbody>';
                tableRows.forEach(row => {
                    html += '<tr>';
                    row.forEach(cell => {
                        html += `<td>${inlineFormatting(cell)}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody></table>\n';
            }
        }

        // List close/open
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
            if (!inList) {
                inList = true;
                html += '<ul>\n';
            }
            const content = trimmed.replace(/^[\*\-]\s+/, '').replace(/^\d+\.\s+/, '');
            html += `<li>${inlineFormatting(content)}</li>\n`;
            continue;
        } else {
            if (inList) {
                inList = false;
                html += '</ul>\n';
            }
        }

        // Horizontal rules
        if (trimmed === '---') {
            html += '<hr />\n';
            continue;
        }

        // Headings
        if (trimmed.startsWith('# ')) {
            const hText = trimmed.substring(2);
            // Treat the first # as title with cover spacing
            if (hText.includes('Česká verze')) {
                html += `<div class="page-break"></div>`;
            } else if (hText.includes('English Version')) {
                html += `<div class="page-break"></div>`;
            }
            html += `<h1>${inlineFormatting(hText)}</h1>\n`;
            continue;
        }
        if (trimmed.startsWith('## ')) {
            html += `<h2>${inlineFormatting(trimmed.substring(3))}</h2>\n`;
            continue;
        }
        if (trimmed.startsWith('### ')) {
            html += `<h3>${inlineFormatting(trimmed.substring(4))}</h3>\n`;
            continue;
        }

        // Blockquotes
        if (trimmed.startsWith('> ')) {
            html += `<blockquote>${inlineFormatting(trimmed.substring(2))}</blockquote>\n`;
            continue;
        }

        // Empty lines
        if (trimmed === '') {
            continue;
        }

        // Standard paragraph
        html += `<p>${inlineFormatting(line)}</p>\n`;
    }

    // Flush remaining open tags
    if (inList) html += '</ul>\n';
    if (inTable) {
        html += '<table><thead><tr>';
        tableHeaders.forEach(h => html += `<th>${inlineFormatting(h)}</th>`);
        html += '</tr></thead><tbody>';
        tableRows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => html += `<td>${inlineFormatting(cell)}</td>`);
            html += '</tr>';
        });
        html += '</tbody></table>\n';
    }

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>LexisLocal Dokumentace</title>
            <style>${style}</style>
        </head>
        <body>
            <div class="center" style="margin-top: 5cm; margin-bottom: 2cm;">
                <span style="font-size: 72pt;">⚖️</span>
                <h1 style="font-size: 38pt; border: none; margin-top: 20px; color: #1e3a8a;">LexisLocal</h1>
                <div class="title-subtitle">Kompletní technická a provozní dokumentace</div>
                <div style="font-size: 10pt; color: #64748b; margin-top: 5cm;">
                    Lokální AI Ekosystém pro Advokátní Kanceláře<br>
                    Verze 1.1.2 | Generováno: ${new Date().toLocaleDateString('cs-CZ')}
                </div>
            </div>
            ${html}
        </body>
        </html>
    `;
}

function inlineFormatting(text) {
    // Escape HTML first
    let res = escapeHtml(text);

    // Bold (**text**)
    res = res.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Inline Code (`code`)
    res = res.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Remove markdown links completely for clean printing or make them plain text
    res = res.replace(/\[([^\]]+)\]\(file:\/\/\/[^\)]+\)/g, '$1');
    res = res.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    return res;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

(async () => {
    try {
        console.log("📖 Načítám README.md...");
        const readmePath = path.join(__dirname, '..', 'README.md');
        const markdown = fs.readFileSync(readmePath, 'utf-8');

        console.log("⚙️ Převádím Markdown na HTML...");
        const html = markdownToHtml(markdown);

        console.log("🌐 Spouštím Playwright (headless Chromium)...");
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        
        console.log("✏️ Nastavuji obsah stránky...");
        await page.setContent(html);
        await page.evaluate(() => document.fonts.ready); // Wait for fonts to load

        console.log("💾 Generuji PDF dokument...");
        const pdfPath = path.join(__dirname, '..', 'LexisLocal_Dokumentace.pdf');
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            margin: {
                top: '20mm',
                bottom: '20mm',
                left: '20mm',
                right: '20mm'
            },
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: '<div style="font-size: 8pt; color: #94a3b8; width: 100%; text-align: right; padding-right: 20mm; font-family: Outfit, sans-serif;">LexisLocal ⚖️</div>',
            footerTemplate: '<div style="font-size: 8pt; color: #94a3b8; width: 100%; text-align: center; font-family: Outfit, sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        });

        console.log(`✅ PDF úspěšně vygenerováno: ${pdfPath}`);
        await browser.close();
        process.exit(0);
    } catch (err) {
        console.error("❌ Chyba při generování PDF:", err);
        process.exit(1);
    }
})();
