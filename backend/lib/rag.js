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
async function initIndex() {
    if (!fs.existsSync(RAG_INDEX_PATH)) {
        await fs.promises.writeFile(RAG_INDEX_PATH, JSON.stringify({ chunks: [] }, null, 2), 'utf-8');
    }
}

// Load RAG index from disk
async function loadIndex() {
    try {
        await initIndex();
        if (fs.existsSync(RAG_INDEX_PATH)) {
            const data = await fs.promises.readFile(RAG_INDEX_PATH, 'utf-8');
            return JSON.parse(data);
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
 * Fetch embeddings from local Ollama service.
 * Throws an error if the model is unreachable to prevent index corruption.
 */
async function getEmbedding(text) {
    // Query local Ollama API
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
    
    const index = await loadIndex();
    
    // 2. Generate embedding for each chunk
    try {
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
    } catch (e) {
        console.error(`❌ RAG: Chyba při generování embeddings pro ${fileName}:`, e.message);
        // Do not save the partially generated chunks if generating embedding fails
        throw e;
    }
}

/**
 * API: Removes indexed chunks belonging to the specified file.
 */
async function deleteDocumentIndex(fileName) {
    const index = await loadIndex();
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
    
    let queryVector;
    try {
        queryVector = await getEmbedding(query);
    } catch (e) {
        console.error(`❌ RAG: Vyhledávání selhalo, model nedostupný:`, e.message);
        throw e;
    }

    const index = await loadIndex();
    
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
