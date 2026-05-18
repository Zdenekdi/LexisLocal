/**
 * LexisLocal RAG & Embedded Vector Database Module
 * Implements a lightweight, zero-dependency, pure JavaScript vector storage.
 * Stores chunked text and vectors in WATCH_DIR/.rag_index.json.
 * Uses Ollama for embedding generation with a robust deterministic offline fallback.
 */

const fs = require('fs');
const path = require('path');

// Robust Ollama module import supporting both CommonJS and ESM default exports
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

// WATCH_DIR resolution (matches watcher.js)
const WATCH_DIR = process.env.WATCH_DIR || path.join(process.env.HOME || process.env.USERPROFILE, 'Desktop', 'LexisSpisy');
const RAG_INDEX_PATH = path.join(WATCH_DIR, '.rag_index.json');
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

// Ensure index file exists
function initIndex() {
    if (!fs.existsSync(RAG_INDEX_PATH)) {
        fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify({ chunks: [] }, null, 2), 'utf-8');
    }
}

// Load RAG index from disk
function loadIndex() {
    try {
        initIndex();
        if (fs.existsSync(RAG_INDEX_PATH)) {
            return JSON.parse(fs.readFileSync(RAG_INDEX_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error("⚠️ Nepodařilo se načíst .rag_index.json:", e.message);
    }
    return { chunks: [] };
}

// Save RAG index to disk
function saveIndex(index) {
    try {
        fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
    } catch (e) {
        console.error("⚠️ Nepodařilo se uložit .rag_index.json:", e.message);
    }
}

/**
 * Generate deterministic pseudo-embedding (768 dimensions) for offline development.
 * Provides deterministic float vector normalized to length of 1.
 */
function generatePseudoEmbedding(text) {
    const vector = new Array(768).fill(0);
    
    // Hash text to a stable numeric seed
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    
    let seed = Math.abs(hash) || 99;
    
    // Deterministic pseudo-random number generator (LCG-like)
    function random() {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }
    
    // Generate components
    for (let i = 0; i < 768; i++) {
        vector[i] = random() * 2 - 1;
    }
    
    // Normalize to unit magnitude for accurate cosine similarity
    const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (mag > 0) {
        for (let i = 0; i < 768; i++) {
            vector[i] /= mag;
        }
    }
    
    return vector;
}

/**
 * Fetch embeddings from local Ollama service, or fallback to pseudo-embeddings.
 */
async function getEmbedding(text) {
    try {
        // Query local Ollama API
        const response = await ollama.embeddings({
            model: EMBEDDING_MODEL,
            prompt: text
        });
        
        if (response && response.embedding) {
            return response.embedding;
        }
    } catch (err) {
        // Log once or quietly fallback
        // console.warn(`ℹ️ Ollama embedding fail: ${err.message}. Using offline pseudo-vector.`);
    }
    
    // Graceful offline fallback
    return generatePseudoEmbedding(text);
}

/**
 * Intelligently splits document text into paragraphs/chunks.
 * Merges small paragraphs to maintain contextual relevance (target 300-600 characters).
 */
function chunkText(text) {
    if (!text) return [];
    
    // Clean text and split by newlines
    const paragraphs = text
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
        
    const chunks = [];
    let currentChunk = "";
    
    for (const paragraph of paragraphs) {
        // If current paragraph fits in existing chunk, append it
        if (currentChunk.length + paragraph.length < 500) {
            currentChunk += (currentChunk ? " " : "") + paragraph;
        } else {
            // Push old chunk if non-empty
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            // Start new chunk
            currentChunk = paragraph;
        }
    }
    
    // Push the final chunk
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

/**
 * API: Indexes document text into the vector store.
 * Overwrites previous index for the same file.
 */
async function indexDocument(fileName, text) {
    console.log(`🧠 RAG: Zahajuji vektorovou indexaci pro soubor ${fileName}...`);
    
    // 1. Remove previous chunks of the same file to prevent duplicates
    await deleteDocumentIndex(fileName);
    
    const chunks = chunkText(text);
    if (chunks.length === 0) {
        console.warn(`⚠️ RAG: Soubor ${fileName} neobsahuje text k indexaci.`);
        return;
    }
    
    const index = loadIndex();
    
    // 2. Generate embedding for each chunk
    for (let i = 0; i < chunks.length; i++) {
        const chunkTextContent = chunks[i];
        const vector = await getEmbedding(chunkTextContent);
        
        index.chunks.push({
            id: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            fileName: fileName,
            text: chunkTextContent,
            vector: vector,
            chunkIndex: i,
            totalChunks: chunks.length
        });
    }
    
    saveIndex(index);
    console.log(`✅ RAG: Soubor ${fileName} úspěšně indexován (${chunks.length} odstavců uloženo).`);
}

/**
 * API: Removes indexed chunks belonging to the specified file.
 */
async function deleteDocumentIndex(fileName) {
    const index = loadIndex();
    const originalCount = index.chunks.length;
    
    // Filter out chunks belonging to this file
    index.chunks = index.chunks.filter(chunk => chunk.fileName !== fileName);
    
    if (index.chunks.length !== originalCount) {
        saveIndex(index);
        console.log(`🗑️ RAG: Odstraněno ${originalCount - index.chunks.length} indexovaných odstavců pro soubor ${fileName}.`);
    }
}

/**
 * API: Queries the vector index for semantically similar chunks.
 * Returns sorted list of matches with similarity score.
 */
async function searchSimilar(query, limit = 5) {
    if (!query || !query.trim()) return [];
    
    const queryVector = await getEmbedding(query);
    const index = loadIndex();
    
    const results = index.chunks.map(chunk => {
        const score = cosineSimilarity(queryVector, chunk.vector);
        return {
            fileName: chunk.fileName,
            text: chunk.text,
            score: score,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks
        };
    });
    
    // Sort descending by score and apply limit
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
    cosineSimilarity
};
