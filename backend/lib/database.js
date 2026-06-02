/**
 * LexisLocal Secure Database Manager
 * Uses Node.js native crypto for AES-256-CBC encrypted, transactional JSON-based storage.
 * Zero-dependency to bypass sandboxed npm installation blocks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WATCH_DIR = process.env.WATCH_DIR || path.join(require('os').homedir(), 'Desktop', 'LexisSpisy');
const DB_FILE = path.join(WATCH_DIR, '.lexis.db');
const KEY_FILE = path.join(WATCH_DIR, '.lexis.key'); // Local encryption key

class LexisDatabase {
    constructor() {
        this.collections = {
            activities: [],
            timesheets: [],
            workflows: [],
            conflicts: [],
            alerts: [],
            email_settings: [],
            email_tasks: []
        };
        this.encryptionKey = null;
        this.init();
    }

    init() {
        // Ensure WATCH_DIR exists
        if (!fs.existsSync(WATCH_DIR)) {
            try {
                fs.mkdirSync(WATCH_DIR, { recursive: true });
            } catch (e) {
                console.error("⚠️ Nelze vytvořit adresář pro databázi:", e.message);
            }
        }

        // Initialize or load Encryption Key
        this.loadOrCreateKey();

        // Load existing encrypted database or create blank
        if (fs.existsSync(DB_FILE)) {
            this.load();
        } else {
            this.save(); // Write default structure
        }
    }

    loadOrCreateKey() {
        if (fs.existsSync(KEY_FILE)) {
            try {
                const hexKey = fs.readFileSync(KEY_FILE, 'utf8').trim();
                this.encryptionKey = Buffer.from(hexKey, 'hex');
            } catch (err) {
                console.error("❌ Selhalo načtení šifrovacího klíče:", err.message);
                this.encryptionKey = crypto.randomBytes(32); // Fallback to memory-only volatile key
            }
        } else {
            try {
                // Generate a highly secure 256-bit key
                this.encryptionKey = crypto.randomBytes(32);
                fs.writeFileSync(KEY_FILE, this.encryptionKey.toString('hex'), 'utf8');
                console.log("🔑 Vygenerován nový lokální šifrovací klíč .lexis.key");
            } catch (err) {
                console.error("⚠️ Nelze zapsat klíč na disk, používám paměťový:", err.message);
                this.encryptionKey = crypto.randomBytes(32);
            }
        }
    }

    /**
     * Encrypts and saves database state atomically to disk
     */
    save() {
        try {
            const rawText = JSON.stringify(this.collections, null, 2);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
            
            let encrypted = cipher.update(rawText, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const payload = JSON.stringify({
                iv: iv.toString('hex'),
                data: encrypted
            });

            // Write atomically using temporary file to prevent corruption
            const tempFile = DB_FILE + '.tmp';
            fs.writeFileSync(tempFile, payload, 'utf8');
            fs.renameSync(tempFile, DB_FILE);
        } catch (err) {
            console.error("❌ Kritická chyba při ukládání šifrované DB:", err.message);
        }
    }

    /**
     * Decrypts and loads database state from disk
     */
    load() {
        try {
            const rawPayload = fs.readFileSync(DB_FILE, 'utf8');
            const payload = JSON.parse(rawPayload);

            if (!payload.iv || !payload.data) {
                throw new Error("Neplatný formát zašifrovaného souboru.");
            }

            const iv = Buffer.from(payload.iv, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
            
            let decrypted = decipher.update(payload.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            this.collections = JSON.parse(decrypted);
        } catch (err) {
            console.error("❌ Selhalo dešifrování DB (pravděpodobně změněný klíč). Vytvářím záložní DB:", err.message);
            
            // Backup corrupted file and reset
            if (fs.existsSync(DB_FILE)) {
                try {
                    fs.renameSync(DB_FILE, DB_FILE + `.corrupt.${Date.now()}`);
                } catch (e) {}
            }
            this.collections = {
                activities: [],
                timesheets: [],
                workflows: [],
                conflicts: [],
                alerts: [],
                email_settings: [],
                email_tasks: []
            };
            this.save();
        }
    }

    // CRUD Helper methods

    get(collectionName) {
        return this.collections[collectionName] || [];
    }

    insert(collectionName, item) {
        if (!this.collections[collectionName]) {
            this.collections[collectionName] = [];
        }
        
        const newItem = {
            id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
            createdAt: new Date().toISOString(),
            ...item
        };

        this.collections[collectionName].push(newItem);
        this.save();
        return newItem;
    }

    update(collectionName, id, updates) {
        const list = this.collections[collectionName] || [];
        const index = list.findIndex(item => item.id === id);
        
        if (index !== -1) {
            list[index] = {
                ...list[index],
                ...updates,
                updatedAt: new Date().toISOString()
            };
            this.save();
            return list[index];
        }
        return null;
    }

    delete(collectionName, id) {
        const list = this.collections[collectionName] || [];
        const index = list.findIndex(item => item.id === id);
        
        if (index !== -1) {
            const removed = list.splice(index, 1);
            this.save();
            return removed[0];
        }
        return null;
    }
}

// Export singleton instance
module.exports = new LexisDatabase();
