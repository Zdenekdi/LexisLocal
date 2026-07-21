const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Připravíme prostředí PŘED načtením database.js (singleton se inicializuje při require).
const stamp = Date.now();
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_migr_watch_${stamp}`);
const tempKeyDir = path.join(os.tmpdir(), `lexis_test_migr_key_${stamp}`);
fs.mkdirSync(tempWatchDir, { recursive: true });

// Nasimulujeme starou instalaci: klíč leží ve WATCH_DIR (nebezpečné, k migraci).
const legacyKeyHex = crypto.randomBytes(32).toString('hex');
const legacyKeyPath = path.join(tempWatchDir, '.lexis.key');
fs.writeFileSync(legacyKeyPath, legacyKeyHex, 'utf8');

process.env.WATCH_DIR = tempWatchDir;
process.env.LEXIS_KEY_DIR = tempKeyDir; // nové (prázdné) bezpečné umístění

const db = require('../lib/database');

describe('Migrace šifrovacího klíče mimo WATCH_DIR', () => {
    afterAll(() => {
        for (const d of [tempWatchDir, tempKeyDir]) {
            if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        }
    });

    it('přesune legacy klíč z WATCH_DIR do bezpečného umístění', () => {
        const newKeyPath = path.join(tempKeyDir, 'lexis.key');
        // Klíč je nově mimo WATCH_DIR...
        expect(fs.existsSync(newKeyPath)).toBe(true);
        // ...a starý ve WATCH_DIR byl odstraněn.
        expect(fs.existsSync(legacyKeyPath)).toBe(false);
    });

    it('zachová stejnou hodnotu klíče (data zůstanou dešifrovatelná)', () => {
        const migratedHex = fs.readFileSync(path.join(tempKeyDir, 'lexis.key'), 'utf8').trim();
        expect(migratedHex).toBe(legacyKeyHex);
        expect(db.encryptionKey.toString('hex')).toBe(legacyKeyHex);
    });
});
