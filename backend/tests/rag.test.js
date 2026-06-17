const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temp dir and create it BEFORE requiring rag.js
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_rag_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;

// We need to require rag.js after setting process.env.WATCH_DIR
const RAG_INDEX_PATH = path.join(tempWatchDir, '.rag_index.json');

const rag = require('../lib/rag');

describe('RAG Document Index Deletion', () => {
    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        // Clear index if exists
        if (fs.existsSync(RAG_INDEX_PATH)) {
            fs.rmSync(RAG_INDEX_PATH, { force: true });
        }
    });

    it('should remove all chunks for the specified file', async () => {
        // Create an initial index
        const initialIndex = {
            chunks: [
                { id: '1', fileName: 'file1.txt', text: 'chunk 1' },
                { id: '2', fileName: 'file1.txt', text: 'chunk 2' },
                { id: '3', fileName: 'file2.txt', text: 'chunk 3' }
            ]
        };
        fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify(initialIndex));

        await rag.deleteDocumentIndex('file1.txt');

        const rawData = fs.readFileSync(RAG_INDEX_PATH, 'utf8');
        const index = JSON.parse(rawData);

        expect(index.chunks).toHaveLength(1);
        expect(index.chunks[0].fileName).toBe('file2.txt');
    });

    it('should do nothing if the specified file has no chunks', async () => {
        const initialIndex = {
            chunks: [
                { id: '1', fileName: 'file1.txt', text: 'chunk 1' },
                { id: '2', fileName: 'file1.txt', text: 'chunk 2' },
                { id: '3', fileName: 'file2.txt', text: 'chunk 3' }
            ]
        };
        fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify(initialIndex));

        await rag.deleteDocumentIndex('file3.txt');

        const rawData = fs.readFileSync(RAG_INDEX_PATH, 'utf8');
        const index = JSON.parse(rawData);

        expect(index.chunks).toHaveLength(3);
    });

    it('should handle an empty index gracefully', async () => {
        fs.writeFileSync(RAG_INDEX_PATH, JSON.stringify({ chunks: [] }));

        await rag.deleteDocumentIndex('file1.txt');

        const rawData = fs.readFileSync(RAG_INDEX_PATH, 'utf8');
        const index = JSON.parse(rawData);

        expect(index.chunks).toHaveLength(0);
    });

    it('should handle a missing index gracefully without throwing errors', async () => {
        if (fs.existsSync(RAG_INDEX_PATH)) {
            fs.rmSync(RAG_INDEX_PATH, { force: true });
        }

        // Should resolve cleanly without error
        await expect(rag.deleteDocumentIndex('file1.txt')).resolves.toBeUndefined();
    });
});
