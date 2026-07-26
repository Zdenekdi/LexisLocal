/**
 * frontend_syntax.test.js — levná pojistka proti syntaktickým chybám v browser JS.
 *
 * Dashboard (`backend/public/app.js`) je obří třída bez unit testů. Když se do ní
 * dostane syntaktická chyba (např. přebytečná/chybějící složená závorka), CELÝ
 * dashboard přestane fungovat — soubor se neparsuje, třída se nedefinuje. Přesně
 * to se stalo (předčasně uzavřená třída osiřela metody). Tenhle test to chytí:
 * spustí `node --check` na každém browser JS souboru. Nepotřebuje prohlížeč.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function browserJsFiles() {
    if (!fs.existsSync(PUBLIC_DIR)) return [];
    return fs.readdirSync(PUBLIC_DIR)
        .filter((f) => f.endsWith('.js'))
        .map((f) => path.join(PUBLIC_DIR, f));
}

describe('Syntaxe browser JS (public/*.js)', () => {
    const files = browserJsFiles();

    test('v public/ je aspoň jeden .js soubor ke kontrole', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    test.each(files)('`node --check` projde: %s', (file) => {
        // Vyhodí, pokud má soubor syntaktickou chybu (nenulový exit + stderr).
        expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    });
});
