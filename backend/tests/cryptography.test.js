const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Create temp directory for watcher tests
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_crypto_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;
// Klíč mimo WATCH_DIR (bezpečnost) — izolovaný temp adresář pro test.
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_cryptokey_${Date.now()}`);

const db = require('../lib/database');
const { loadInbox, saveInbox } = require('../lib/watcher');

describe('Cryptographic & Integrity Shield (Phase 4)', () => {
    beforeEach(() => {
        // Clear collections before each test
        db.collections.inbox_files = [];
        db.collections.transparency_logs = [];
        db.save();
    });

    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    describe('Zero-Knowledge Encrypted Inbox & Migration', () => {
        it('migrates raw .inbox.json to encrypted database and unlinks plain file', async () => {
            const INBOX_PATH = path.join(tempWatchDir, '.inbox.json');
            const mockInboxData = {
                files: {
                    'smlouva.pdf': {
                        fileName: 'smlouva.pdf',
                        filePath: '/path/to/smlouva.pdf',
                        status: 'unread',
                        caseNumber: '12 C 45/2026'
                    }
                }
            };
            
            // Create legacy unencrypted file on disk
            fs.writeFileSync(INBOX_PATH, JSON.stringify(mockInboxData, null, 2), 'utf-8');
            expect(fs.existsSync(INBOX_PATH)).toBe(true);

            // Load inbox, which should trigger automatic migration
            const loaded = await loadInbox();
            
            // 1. Verify data is successfully loaded
            expect(loaded.files['smlouva.pdf']).toBeDefined();
            expect(loaded.files['smlouva.pdf'].caseNumber).toBe('12 C 45/2026');
            
            // 2. Verify data is now in db collection
            const dbList = db.get('inbox_files');
            expect(dbList).toHaveLength(1);
            expect(dbList[0].id).toBe('smlouva.pdf');
            expect(dbList[0].caseNumber).toBe('12 C 45/2026');

            // 3. Verify unencrypted file has been deleted from disk
            expect(fs.existsSync(INBOX_PATH)).toBe(false);
        });

        it('saves and loads inbox files dynamically using encrypted db', async () => {
            const newInbox = {
                files: {
                    'dokument.txt': {
                        fileName: 'dokument.txt',
                        filePath: '/path/to/dokument.txt',
                        status: 'read'
                    }
                }
            };
            
            await saveInbox(newInbox);
            
            // Load again and verify
            const loaded = await loadInbox();
            expect(loaded.files['dokument.txt']).toBeDefined();
            expect(loaded.files['dokument.txt'].status).toBe('read');
            expect(db.get('inbox_files')).toHaveLength(1);
        });
    });

    describe('Hash-Chained AI Act Transparency Ledger', () => {
        it('automatically creates a cryptographically linked chain of logs', () => {
            const entry1 = db.insert('transparency_logs', { agentId: 'test-agent', prompt: 'Otázka 1' });
            const entry2 = db.insert('transparency_logs', { agentId: 'test-agent', prompt: 'Otázka 2' });

            expect(entry1.prevHash).toBe('genesis_hash_lexis_ledger');
            expect(entry1.hash).toBeDefined();

            expect(entry2.prevHash).toBe(entry1.hash);
            expect(entry2.hash).toBeDefined();

            // Verify entire chain is valid
            const validation = db.verifyLedger();
            expect(validation.valid).toBe(true);
        });

        it('fails validation if any historical log content is altered', () => {
            db.insert('transparency_logs', { agentId: 'test-agent', prompt: 'Otázka 1' });
            db.insert('transparency_logs', { agentId: 'test-agent', prompt: 'Otázka 2' });
            
            const validationBefore = db.verifyLedger();
            expect(validationBefore.valid).toBe(true);

            // Directly modify a field in collections to simulate tampering
            db.collections.transparency_logs[0].prompt = 'Změněný text (manipulace)';
            db.save();

            const validationAfter = db.verifyLedger();
            expect(validationAfter.valid).toBe(false);
            expect(validationAfter.reason).toContain('Obsah záznamu byl pozměněn');
        });

        it('allows human-review status updates (mutable fields) without breaking the hash chain', () => {
            const entry1 = db.insert('transparency_logs', {
                agentId: 'test-agent',
                prompt: 'Otázka 1',
                humanApproved: false
            });

            const validationBefore = db.verifyLedger();
            expect(validationBefore.valid).toBe(true);

            // Update mutable humanApproved status
            db.update('transparency_logs', entry1.id, {
                humanApproved: true,
                approvedAt: new Date().toISOString()
            });

            // Verify ledger is STILL cryptographically valid
            const validationAfter = db.verifyLedger();
            expect(validationAfter.valid).toBe(true);
        });
    });
});
