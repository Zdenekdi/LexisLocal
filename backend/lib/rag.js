/**
 * LexisLocal RAG & Embedded Vector Database Module
 * Implements a lightweight, zero-dependency, pure JavaScript vector storage.
 * Stores chunked text and vectors in WATCH_DIR/ under encrypted partitions.
 *
 * Embeddingy počítá lokální Ollama (sémantické vyhledávání). Když model NEBĚŽÍ,
 * modul degraduje na deterministický LEXIKÁLNÍ (klíčový) fallback nad textem
 * chunků — RAG tak funguje i bez modelu (viz lexicalScore / searchSimilar opts).
 * Indexace bez modelu ukládá chunky TEXTOVĚ (bez vektoru), lexikálně dohledatelné.
 * POZOR: fallback je OPT-IN (searchSimilar(..., { lexicalFallback:true })), aby
 * bezpečnostně kritická cesta (conflicts.js) při výpadku modelu stále FAIL-CLOSED
 * vyhodila chybu místo neúplného „žádný konflikt".
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

// AI poskytovatel nezávislý na backendu (Ollama | OpenAI | Anthropic) — stejné
// rozhraní jako ollama lib. Embeddingy tak fungují pro jakýkoli model.
const ollama = require('./ai_provider');

const { WATCH_DIR } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
const secureCrypto = require('./secure_crypto'); // AES-GCM + zpětné čtení CBC (jeden zdroj)
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
        // AES-256-GCM (integrita) přes sdílený secure_crypto.
        const payload = JSON.stringify(secureCrypto.encrypt(key, JSON.stringify(index)));
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

        const key = getPartitionKey(directoryName);
        // Přečte GCM i starší CBC (zpětná kompatibilita).
        const decrypted = secureCrypto.decrypt(key, payload);
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

            const oldKey = crypto.pbkdf2Sync(oldMasterKey, dir, 1000, 32, 'sha256');
            const decrypted = secureCrypto.decrypt(oldKey, payload); // GCM i legacy CBC
            const index = JSON.parse(decrypted);

            const newKey = crypto.pbkdf2Sync(newMasterKey, dir, 1000, 32, 'sha256');
            const newPayload = JSON.stringify(secureCrypto.encrypt(newKey, JSON.stringify(index)));
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

// --- Lexikální (deterministický, offline) fallback ---
// Když embedding model neběží, RAG degraduje na klíčové vyhledávání nad TEXTEM
// chunků: kosinová podobnost frekvencí termů. Bez závislostí, deterministické,
// funguje i nad chunky uloženými bez vektoru (indexace proběhla offline).
function _deaccent(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
// Krátká česká/anglická stop-slova — nenesou rozlišovací význam pro shodu.
const _STOP = new Set(['a', 'i', 'o', 'u', 'v', 'k', 's', 'z', 'na', 'do', 'od', 'po', 'za', 'se', 'si',
    'je', 'to', 've', 'ke', 'ze', 'pro', 'nad', 'pod', 'pri', 'ci', 'ze', 'by', 'byl', 'byla', 'bylo',
    'jako', 'tak', 'ale', 'nebo', 'aby', 'jsou', 'jsem', 'the', 'of', 'and', 'or', 'in', 'on', 'at']);
function _lexTokens(text) {
    return _deaccent(text).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !_STOP.has(t));
}
function _termFreq(tokens) {
    const tf = Object.create(null);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return tf;
}
// Kosinová podobnost term-frekvencí mezi dotazem a textem chunku. query může být
// řetězec i předtokenizované pole (rychlejší při skórování mnoha chunků).
function lexicalScore(query, text) {
    const q = _termFreq(Array.isArray(query) ? query : _lexTokens(query));
    const d = _termFreq(_lexTokens(text));
    let dot = 0, nq = 0, nd = 0;
    for (const k in q) { nq += q[k] * q[k]; if (d[k]) dot += q[k] * d[k]; }
    for (const k in d) { nd += d[k] * d[k]; }
    if (nq === 0 || nd === 0) return 0;
    return dot / (Math.sqrt(nq) * Math.sqrt(nd));
}

// Cílová velikost chunku a překryv (znaky). Laditelné přes env BEZ zásahu do kódu:
//   RAG_CHUNK_MAX_CHARS  (def. 700) — horní mez délky chunku,
//   RAG_CHUNK_OVERLAP_CHARS (def. 120) — kolik znaků konce chunku se zopakuje na
//   začátku dalšího (kontinuita kontextu přes hranici — lepší dohledatelnost faktů,
//   která by jinak padla přesně na předěl). Změna se projeví AŽ PO re-indexaci
//   (POST /api/rag/reindex-all); skóre ani prahy (0.70 v conflicts/agent) to nemění.
const CHUNK_MAX = Math.max(200, parseInt(process.env.RAG_CHUNK_MAX_CHARS, 10) || 700);
const CHUNK_OVERLAP = Math.max(0, Math.min(
    (parseInt(process.env.RAG_CHUNK_OVERLAP_CHARS, 10) || 120),
    Math.floor(CHUNK_MAX / 2)
));

// Rozdělí příliš dlouhý odstavec na věty (tečka/!/? + mezera + další „slovo"). Věta
// delší než `max` se tvrdě rozseká po slovech. České zkratky (odst., §, č.) můžou
// větu občas rozdělit navíc — pro embeddingy to nevadí (kratší smysluplné jednotky).
function _splitSentences(paragraph, max) {
    const parts = String(paragraph).split(/(?<=[.!?])\s+(?=[A-ZÁ-Ža-zá-ž0-9(„"])/);
    const out = [];
    for (const s of parts) {
        const seg = s.trim();
        if (!seg) continue;
        if (seg.length <= max) { out.push(seg); continue; }
        let buf = '';
        for (const w of seg.split(/\s+/)) {
            if (w.length > max) {
                // Patologicky dlouhé „slovo" (bez mezer) — nasekej po znacích, ať žádný
                // chunk nepřeteče MAX a nezahltí embedding.
                if (buf) { out.push(buf); buf = ''; }
                for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max));
                continue;
            }
            if (buf && (buf.length + 1 + w.length) > max) { out.push(buf); buf = w; }
            else buf = buf ? buf + ' ' + w : w;
        }
        if (buf) out.push(buf);
    }
    return out;
}

// Vrátí konec chunku (~overlap znaků) začínající na hranici slova — pro překryv.
function _tailForOverlap(chunk, overlap) {
    if (overlap <= 0) return '';
    const s = String(chunk);
    if (s.length <= overlap) return s;
    const slice = s.slice(s.length - overlap);
    const sp = slice.indexOf(' ');
    return sp >= 0 ? slice.slice(sp + 1) : slice;
}

/**
 * Rozdělí text dokumentu na chunky vhodné k indexaci. Oproti dřívějšku:
 *  • dlouhé odstavce (typické u smluv/podání) se rozdělí na věty → menší, přesnější
 *    chunky = kvalitnější embeddingy a cílenější dohledání,
 *  • mezi chunky je PŘEKRYV (kontinuita kontextu přes hranici),
 *  • velikost i překryv jsou laditelné (opts nebo env).
 * Krátký text zůstává jedním chunkem (zpětně kompatibilní chování).
 */
function chunkText(text, opts) {
    if (!text) return [];
    const MAX = (opts && opts.maxChars) || CHUNK_MAX;
    const OVERLAP = (opts && opts.overlapChars != null) ? opts.overlapChars : CHUNK_OVERLAP;

    const paragraphs = String(text)
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Dlouhé odstavce → věty (aby chunky nebyly obří).
    const units = [];
    for (const p of paragraphs) {
        if (p.length <= MAX) units.push(p);
        else units.push(..._splitSentences(p, MAX));
    }

    const chunks = [];
    let cur = '';
    for (const u of units) {
        if (cur && (cur.length + 1 + u.length) > MAX) {
            chunks.push(cur);
            const tail = _tailForOverlap(cur, OVERLAP);
            cur = tail ? tail + ' ' + u : u;
        } else {
            cur = cur ? cur + ' ' + u : u;
        }
    }
    if (cur) chunks.push(cur);

    return chunks.map(c => c.trim()).filter(Boolean);
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
    // Když model neběží, NEshazujeme celou indexaci — chunk uložíme TEXTOVĚ
    // (vector=null) a je pak dohledatelný lexikálně; po zapnutí modelu stačí
    // spustit re-indexaci (POST /api/rag/reindex-all), která vektory doplní.
    const vectors = [];
    let embeddedCount = 0;
    for (let i = 0; i < chunks.length; i++) {
        try {
            vectors.push(await getEmbedding(chunks[i]));
            embeddedCount++;
        } catch (e) {
            vectors.push(null);
        }
    }
    if (embeddedCount === 0) {
        console.warn(`⚠️ RAG: Embedding model nedostupný — „${fileName}" indexován TEXTOVĚ (lexikální vyhledávání). Po zapnutí modelu spusťte re-indexaci.`);
    } else if (embeddedCount < chunks.length) {
        console.warn(`⚠️ RAG: „${fileName}" — část chunků bez vektoru (${chunks.length - embeddedCount}/${chunks.length}); po zapnutí modelu doindexujte.`);
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
                embedded: vectors[i] != null,
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
async function searchSimilar(query, limit = 5, filters = null, opts = {}) {
    if (!query || !query.trim()) return [];

    // Fallback je OPT-IN: přísné volání (bez opts) při výpadku modelu vyhodí chybu
    // (fail-closed) — kritické pro conflicts.js, kde „nemožnost prověřit" ≠ „bez
    // konfliktu". Obecné vyhledávání zapne { lexicalFallback:true } a degraduje.
    const allowLexicalFallback = !!(opts && opts.lexicalFallback);

    let queryVector = null;
    let embeddingFailed = false;
    try {
        queryVector = await getEmbedding(query);
    } catch (e) {
        if (!allowLexicalFallback) {
            console.error(`❌ RAG: Vyhledávání selhalo, model nedostupný:`, e.message);
            throw e;
        }
        embeddingFailed = true;
        console.warn(`⚠️ RAG: Embedding model nedostupný — lexikální (klíčový) fallback:`, e.message);
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

    // Sémantický režim: kosinová podobnost vektorů (chunky bez vektoru → 0, jako dřív).
    // Lexikální fallback: kosinová podobnost term-frekvencí nad textem chunku.
    const qTokens = embeddingFailed ? _lexTokens(query) : null;
    const results = chunks.map(chunk => {
        const score = embeddingFailed
            ? lexicalScore(qTokens, chunk.text || '')
            : cosineSimilarity(queryVector, chunk.vector);
        return {
            fileName: chunk.fileName,
            text: chunk.text,
            score: score,
            method: embeddingFailed ? 'lexical' : 'semantic',
            degraded: embeddingFailed,
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
    lexicalScore,
    chunkText,
    reencryptAllPartitions,
    loadPartition,
    savePartition,
    getActiveDirectories
};
