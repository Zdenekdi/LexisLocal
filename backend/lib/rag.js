/**
 * LexisLocal RAG & Embedded Vector Database Module
 * Implements a lightweight, zero-dependency, pure JavaScript vector storage.
 * Stores chunked text and vectors in WATCH_DIR/ under encrypted partitions.
 * Uses Ollama for embedding generation with a robust deterministic offline fallback.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

const { WATCH_DIR } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

// Jednoduchý mutex — serializuje zápisové operace nad indexem. Chokidar spouští
// indexaci více souborů paralelně; bez serializace by se interleaved load→save
// navzájem přepisovaly (ztráta chunků / přepis partitionů).
// Jeden zdroj: lib/mutex.js (dřív měl rag.js vlastní identickou kopii třídy).
const Mutex = require('./mutex');
const ragMutex = new Mutex();

/**
 * Lists all active subdirectories in WATCH_DIR to determine partition boundaries.
 */
function getActiveDirectories() {
    const dirs = ['root'];
    try {
        if (fs.existsSync(WATCH_DIR)) {
            const entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    dirs.push(entry.name);
                }
            }
        }
    } catch (e) {
        console.error("⚠️ RAG: Selhal výpis aktivních složek:", e.message);
    }
    return dirs;
}

/**
 * Derives a cryptographic partition key from master key and directory name.
 */
function getPartitionKey(directoryName) {
    const masterKey = db.encryptionKey || crypto.pbkdf2Sync('default_lexis_master_key', 'salt', 100, 32, 'sha256');
    return crypto.pbkdf2Sync(masterKey, directoryName, 1000, 32, 'sha256');
}

/**
 * Saves a partition index file encrypted with a key derived for the specific directory.
 */
function savePartition(directoryName, index) {
    const partitionId = crypto.createHash('sha256').update(directoryName).digest('hex').substring(0, 16);
    const partitionPath = path.join(WATCH_DIR, `.rag_${partitionId}.json`);
    
    try {
        const key = getPartitionKey(directoryName);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        
        const rawText = JSON.stringify(index);
        let encrypted = cipher.update(rawText, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const payload = JSON.stringify({
            iv: iv.toString('hex'),
            data: encrypted
        });
        
        fs.writeFileSync(partitionPath, payload, 'utf8');
    } catch (e) {
        console.error(`⚠️ RAG: Nepodařilo se uložit partition pro ${directoryName}:`, e.message);
    }
}

/**
 * Loads and decrypts a partition index file.
 */
function loadPartition(directoryName) {
    const partitionId = crypto.createHash('sha256').update(directoryName).digest('hex').substring(0, 16);
    const partitionPath = path.join(WATCH_DIR, `.rag_${partitionId}.json`);
    
    if (!fs.existsSync(partitionPath)) {
        const RAG_INDEX_PATH = path.join(WATCH_DIR, '.rag_index.json');
        if (fs.existsSync(RAG_INDEX_PATH)) {
            try {
                const data = fs.readFileSync(RAG_INDEX_PATH, 'utf-8');
                const index = JSON.parse(data);
                const filteredChunks = (index.chunks || []).filter(c => {
                    const dir = c.fileName.includes('/') ? c.fileName.split('/')[0] : 'root';
                    return dir === directoryName;
                });
                return { chunks: filteredChunks };
            } catch (e) {}
        }
        return { chunks: [] };
    }
    
    try {
        const rawPayload = fs.readFileSync(partitionPath, 'utf8');
        const payload = JSON.parse(rawPayload);
        
        const iv = Buffer.from(payload.iv, 'hex');
        const key = getPartitionKey(directoryName);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        let decrypted = decipher.update(payload.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    } catch (e) {
        console.error(`⚠️ RAG: Nepodařilo se dešifrovat partition pro ${directoryName}:`, e.message);
        return { chunks: [] };
    }
}

/**
 * Re-encrypts all partitions when the master key is rotated.
 */
function reencryptAllPartitions(oldMasterKey, newMasterKey) {
    const dirs = getActiveDirectories();
    for (const dir of dirs) {
        const partitionId = crypto.createHash('sha256').update(dir).digest('hex').substring(0, 16);
        const partitionPath = path.join(WATCH_DIR, `.rag_${partitionId}.json`);
        if (!fs.existsSync(partitionPath)) continue;
        
        try {
            const rawPayload = fs.readFileSync(partitionPath, 'utf8');
            const payload = JSON.parse(rawPayload);
            
            const iv = Buffer.from(payload.iv, 'hex');
            const oldKey = crypto.pbkdf2Sync(oldMasterKey, dir, 1000, 32, 'sha256');
            const decipher = crypto.createDecipheriv('aes-256-cbc', oldKey, iv);
            
            let decrypted = decipher.update(payload.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            const index = JSON.parse(decrypted);
            
            const newKey = crypto.pbkdf2Sync(newMasterKey, dir, 1000, 32, 'sha256');
            const newIv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', newKey, newIv);
            
            let encrypted = cipher.update(JSON.stringify(index), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            const newPayload = JSON.stringify({
                iv: newIv.toString('hex'),
                data: encrypted
            });
            fs.writeFileSync(partitionPath, newPayload, 'utf8');
        } catch (e) {
            console.error(`❌ RAG: Selhal přepisy klíče pro partition ${dir}:`, e.message);
        }
    }
}

// Load RAG index from disk (merges all partitions for backward compatibility)
async function loadIndex() {
    const dirs = getActiveDirectories();
    const allChunks = [];
    for (const dir of dirs) {
        const part = loadPartition(dir);
        if (part.chunks) {
            allChunks.push(...part.chunks);
        }
    }
    
    // BACKWARD COMPATIBILITY: Merge chunks from monolithic index if it exists
    const RAG_INDEX_PATH = path.join(WATCH_DIR, '.rag_index.json');
    if (fs.existsSync(RAG_INDEX_PATH)) {
        try {
            const data = fs.readFileSync(RAG_INDEX_PATH, 'utf-8');
            const index = JSON.parse(data);
            if (index.chunks) {
                const loadedIds = new Set(allChunks.map(c => c.id));
                for (const chunk of index.chunks) {
                    if (!loadedIds.has(chunk.id)) {
                        allChunks.push(chunk);
                    }
                }
            }
        } catch (e) {}
    }
    
    return { chunks: allChunks };
}

// Save RAG index to disk (splits chunks back to correct partitions).
// POZOR: neukládá nešifrovaný monolit .rag_index.json — ten by obcházel
// šifrování partitionů (plný text + vektory v plaintextu). Partitiony jsou
// jediný perzistentní formát; případný starý plaintext se po zápisu smaže.
function saveIndex(index) {
    const groups = {};
    const dirs = getActiveDirectories();
    for (const dir of dirs) {
        groups[dir] = [];
    }

    for (const chunk of index.chunks || []) {
        const dir = chunk.fileName.includes('/') ? chunk.fileName.split('/')[0] : 'root';
        if (!groups[dir]) {
            groups[dir] = [];
        }
        groups[dir].push(chunk);
    }

    for (const dir of Object.keys(groups)) {
        savePartition(dir, { chunks: groups[dir] });
    }

    // Migrace/úklid: starý nešifrovaný monolit už není potřeba (data jsou nyní
    // v šifrovaných partitionech) — smažeme ho, aby PII nezůstávalo v plaintextu.
    const RAG_INDEX_PATH = path.join(WATCH_DIR, '.rag_index.json');
    try {
        if (fs.existsSync(RAG_INDEX_PATH)) fs.unlinkSync(RAG_INDEX_PATH);
    } catch (e) { /* best-effort */ }
}

/**
 * Fetch embeddings from local Ollama service.
 */
async function getEmbedding(text) {
    const response = await ollama.embeddings({
        model: EMBEDDING_MODEL,
        prompt: text
    });

    if (response && response.embedding) {
        return response.embedding;
    }
    
    throw new Error("Ollama returned an empty embedding.");
}

/**
 * Intelligently splits document text into paragraphs/chunks.
 */
function chunkText(text) {
    if (!text) return [];
    
    const paragraphs = text
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
        
    const chunks = [];
    let currentChunk = "";
    
    for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length < 500) {
            currentChunk += (currentChunk ? " " : "") + paragraph;
        } else {
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            currentChunk = paragraph;
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}

/**
 * Calculate Cosine Similarity between two numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function indexDocument(fileName, text) {
    console.log(`🧠 RAG: Zahajuji vektorovou indexaci pro soubor ${fileName}...`);

    const chunks = chunkText(text);
    if (chunks.length === 0) {
        console.warn(`⚠️ RAG: Soubor ${fileName} neobsahuje text k indexaci.`);
        return;
    }

    // Embeddings (síťová/CPU operace) počítáme MIMO zámek, abychom neblokovali
    // ostatní; kritickou sekci load→merge→save serializuje mutex.
    const vectors = [];
    try {
        for (let i = 0; i < chunks.length; i++) {
            vectors.push(await getEmbedding(chunks[i]));
        }
    } catch (e) {
        console.error(`❌ RAG: Chyba při generování embeddings pro ${fileName}:`, e.message);
        throw e;
    }

    await ragMutex.acquire();
    try {
        const index = await loadIndex();
        // Odstranit staré chunky téhož souboru (re-indexace).
        index.chunks = index.chunks.filter(chunk => chunk.fileName !== fileName);
        for (let i = 0; i < chunks.length; i++) {
            index.chunks.push({
                id: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                fileName: fileName,
                text: chunks[i],
                vector: vectors[i],
                chunkIndex: i,
                totalChunks: chunks.length
            });
        }
        saveIndex(index);
        console.log(`✅ RAG: Soubor ${fileName} úspěšně indexován (${chunks.length} odstavců).`);
    } finally {
        ragMutex.release();
    }
}

/**
 * API: Removes indexed chunks belonging to the specified file.
 */
async function deleteDocumentIndex(fileName) {
    await ragMutex.acquire();
    try {
        const index = await loadIndex();
        const originalCount = index.chunks.length;

        index.chunks = index.chunks.filter(chunk => chunk.fileName !== fileName);

        if (index.chunks.length !== originalCount) {
            saveIndex(index);
            console.log(`🗑️ RAG: Odstraněno ${originalCount - index.chunks.length} odstavců pro soubor ${fileName}.`);
        }
    } finally {
        ragMutex.release();
    }
}

/**
 * API: Queries the vector index for semantically similar chunks.
 */
async function searchSimilar(query, limit = 5, filters = null) {
    if (!query || !query.trim()) return [];
    
    let queryVector;
    try {
        queryVector = await getEmbedding(query);
    } catch (e) {
        console.error(`❌ RAG: Vyhledávání selhalo, model nedostupný:`, e.message);
        throw e;
    }

    let chunks = [];
    if (filters && filters.directory) {
        chunks = loadPartition(filters.directory).chunks || [];
    } else if (filters && Array.isArray(filters.fileNames) && filters.fileNames.length > 0) {
        const dirs = new Set(filters.fileNames.map(f => f.includes('/') ? f.split('/')[0] : 'root'));
        for (const dir of dirs) {
            chunks.push(...(loadPartition(dir).chunks || []));
        }
    } else {
        const index = await loadIndex();
        chunks = index.chunks || [];
    }
    
    
    if (filters) {
        if (Array.isArray(filters.fileNames) && filters.fileNames.length > 0) {
            const allowedFiles = new Set(filters.fileNames.map(f => f.toLowerCase().replace(/\\/g, '/')));
            chunks = chunks.filter(chunk => {
                const normName = chunk.fileName.toLowerCase().replace(/\\/g, '/');
                return allowedFiles.has(normName);
            });
        }
        
        if (filters.directory) {
            const normDir = filters.directory.toLowerCase().replace(/\\/g, '/');
            chunks = chunks.filter(chunk => {
                const normName = chunk.fileName.toLowerCase().replace(/\\/g, '/');
                return normName.startsWith(normDir + '/') || normName === normDir;
            });
        }
    }

    const results = chunks.map(chunk => {
        const score = cosineSimilarity(queryVector, chunk.vector);
        return {
            fileName: chunk.fileName,
            text: chunk.text,
            score: score,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks
        };
    });
    
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

module.exports = {
    indexDocument,
    deleteDocumentIndex,
    searchSimilar,
    loadIndex,
    getEmbedding,
    cosineSimilarity,
    reencryptAllPartitions,
    loadPartition,
    savePartition,
    getActiveDirectories
};
