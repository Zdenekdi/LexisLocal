const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Setup temporary environment variables BEFORE loading the database
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_db_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;
// Klíč se nově ukládá MIMO WATCH_DIR (bezpečnost) — izolovaný temp adresář pro test.
const tempKeyDir = path.join(os.tmpdir(), `lexis_test_key_${Date.now()}`);
process.env.LEXIS_KEY_DIR = tempKeyDir;

const db = require('../lib/database');

describe('Database Utility', () => {
    beforeAll(() => {
        if (!fs.existsSync(tempWatchDir)) {
            fs.mkdirSync(tempWatchDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        // Clear all collections before each test
        for (const key in db.collections) {
            db.collections[key] = [];
        }
        db.save();
    });

    it('should create the key OUTSIDE the data folder (not in WATCH_DIR)', () => {
        // Bezpečnost: klíč nesmí ležet u dat (jinak by se syncoval do cloudu s daty).
        expect(fs.existsSync(path.join(tempKeyDir, 'lexis.key'))).toBe(true);
        expect(fs.existsSync(path.join(tempWatchDir, '.lexis.key'))).toBe(false);
    });

    it('should insert and retrieve an item', () => {
        const item = { name: 'Test Item', value: 42 };
        const inserted = db.insert('test_collection', item);

        expect(inserted.id).toBeDefined();
        expect(inserted.name).toBe('Test Item');
        expect(inserted.createdAt).toBeDefined();

        const items = db.get('test_collection');
        expect(items.length).toBe(1);
        expect(items[0].id).toBe(inserted.id);
    });

    it('should update an existing item', () => {
        const inserted = db.insert('test_collection', { name: 'Old Name' });

        const updated = db.update('test_collection', inserted.id, { name: 'New Name' });
        expect(updated).not.toBeNull();
        expect(updated.name).toBe('New Name');
        expect(updated.updatedAt).toBeDefined();

        const items = db.get('test_collection');
        expect(items[0].name).toBe('New Name');
    });

    it('should delete an item', () => {
        const inserted = db.insert('test_collection', { name: 'To Delete' });
        expect(db.get('test_collection').length).toBe(1);

        const deleted = db.delete('test_collection', inserted.id);
        expect(deleted).not.toBeNull();
        expect(deleted.id).toBe(inserted.id);

        expect(db.get('test_collection').length).toBe(0);
    });

    it('should encrypt and decrypt data correctly (persist across instances)', () => {
        db.insert('persist_collection', { secret: 'super_secret' });

        // Simulate a new database instance loading from disk
        const dbFile = path.join(tempWatchDir, '.lexis.db');
        expect(fs.existsSync(dbFile)).toBe(true);

        const rawData = fs.readFileSync(dbFile, 'utf8');
        expect(rawData).not.toContain('super_secret'); // Data should be encrypted

        // Reload internal state
        db.load();
        const items = db.get('persist_collection');
        expect(items.length).toBe(1);
        expect(items[0].secret).toBe('super_secret');
    });
});
