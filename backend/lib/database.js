/**
 * LexisLocal Secure Database Manager
 * Uses Node.js native crypto for AES-256-CBC encrypted, transactional JSON-based storage.
 * Zero-dependency to bypass sandboxed npm installation blocks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { WATCH_DIR } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
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
            email_tasks: [],
            green_logs: [],
            transparency_logs: [],
            inbox_files: []
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

    set(collectionName, data) {
        this.collections[collectionName] = data;
        this.save();
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

        if (collectionName === 'transparency_logs') {
            const list = this.collections.transparency_logs;
            const lastRecord = list[list.length - 1];
            const prevHash = lastRecord ? lastRecord.hash : 'genesis_hash_lexis_ledger';
            
            newItem.prevHash = prevHash;
            
            const cleanItem = { ...newItem };
            delete cleanItem.id;
            delete cleanItem.createdAt;
            delete cleanItem.hash;
            delete cleanItem.prevHash;
            // Exclude mutable human-review fields from hash
            delete cleanItem.humanApproved;
            delete cleanItem.approvedAt;
            delete cleanItem.updatedAt;
            
            const hashInput = prevHash + JSON.stringify(cleanItem);
            newItem.hash = crypto.createHash('sha256').update(hashInput).digest('hex');
        }

        this.collections[collectionName].push(newItem);
        this.save();
        return newItem;
    }

    verifyLedger() {
        const list = this.collections.transparency_logs || [];
        let prevHash = 'genesis_hash_lexis_ledger';
        
        for (let i = 0; i < list.length; i++) {
            const record = list[i];
            
            if (record.prevHash !== prevHash) {
                return { valid: false, reason: "Byla porušena kontinuita řetězce (prevHash neodpovídá).", index: i, id: record.id };
            }
            
            const cleanItem = { ...record };
            delete cleanItem.id;
            delete cleanItem.createdAt;
            delete cleanItem.hash;
            delete cleanItem.prevHash;
            // Exclude mutable human-review fields from hash
            delete cleanItem.humanApproved;
            delete cleanItem.approvedAt;
            delete cleanItem.updatedAt;
            
            const hashInput = prevHash + JSON.stringify(cleanItem);
            const expectedHash = crypto.createHash('sha256').update(hashInput).digest('hex');
            
            if (record.hash !== expectedHash) {
                return { valid: false, reason: "Obsah záznamu byl pozměněn (neodpovídá SHA-256 hash).", index: i, id: record.id };
            }
            
            prevHash = record.hash;
        }
        
        return { valid: true };
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

    /**
     * Atomically rotates the database encryption key, re-encrypting all contents.
     */
    rotateEncryptionKey() {
        try {
            const oldKey = this.encryptionKey;
            // Generate a secure new 256-bit key
            const newKey = crypto.randomBytes(32);
            const tempKeyFile = KEY_FILE + '.tmp';
            
            // Write new key file temporarily
            fs.writeFileSync(tempKeyFile, newKey.toString('hex'), 'utf8');
            
            // Re-encrypt collections with new key
            this.encryptionKey = newKey;
            this.save();

            // Re-encrypt RAG partitions (lazy load to avoid circular dependency)
            try {
                const rag = require('./rag');
                if (rag && typeof rag.reencryptAllPartitions === 'function') {
                    rag.reencryptAllPartitions(oldKey, newKey);
                }
            } catch (ragErr) {
                console.warn("⚠️ Nebylo možné přeregistrovat partitions (může chybět RAG modul):", ragErr.message);
            }
            
            // Atomically replace old key with new key
            fs.renameSync(tempKeyFile, KEY_FILE);
            console.log("🔑 Úspěšně rotován lokální šifrovací klíč .lexis.key");
            return true;
        } catch (err) {
            console.error("❌ Kritická chyba při rotaci šifrovacího klíče:", err.message);
            return false;
        }
    }
}

// Export singleton instance
module.exports = new LexisDatabase();
