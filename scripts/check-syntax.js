#!/usr/bin/env node
/**
 * Rychlá pojistka: projede všechny JS soubory v repu a spustí na ně `node --check`.
 * Zachytí syntaktické chyby (např. přebytečnou závorku), které jinak shodí celý renderer.
 * Použití: `node scripts/check-syntax.js` nebo `npm run check:syntax`.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['node_modules', 'dist', 'build', 'vendor', 'playwright-report', 'test-results', 'coverage', 'out']);
const root = process.cwd();
let checked = 0;
const failed = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      const full = path.join(dir, entry.name);
      try {
        execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
        checked++;
      } catch (err) {
        failed.push(full);
        const msg = err.stderr ? err.stderr.toString() : err.message;
        console.error('✗ ' + path.relative(root, full) + '\n' + msg);
      }
    }
  }
}

walk(root);
console.log(`\nSyntax check: ${checked} souborů OK, ${failed.length} s chybou.`);
process.exit(failed.length ? 1 : 0);
