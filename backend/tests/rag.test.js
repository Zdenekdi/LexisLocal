const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temp dir and create it BEFORE requiring rag.js
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_rag_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;

const rag = require('../lib/rag');

describe('RAG Document Index Deletion', () => {
    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        // Clear all files in watch directory
        const files = fs.readdirSync(tempWatchDir);
        for (const file of files) {
            fs.unlinkSync(path.join(tempWatchDir, file));
        }
    });

    it('should remove all chunks for the specified file', async () => {
        const initialIndex = {
            chunks: [
                { id: '1', fileName: 'file1.txt', text: 'chunk 1' },
                { id: '2', fileName: 'file1.txt', text: 'chunk 2' },
                { id: '3', fileName: 'file2.txt', text: 'chunk 3' }
            ]
        };
        rag.savePartition('root', initialIndex);

        await rag.deleteDocumentIndex('file1.txt');

        const index = rag.loadPartition('root');

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
        rag.savePartition('root', initialIndex);

        await rag.deleteDocumentIndex('file3.txt');

        const index = rag.loadPartition('root');

        expect(index.chunks).toHaveLength(3);
    });

    it('should handle an empty index gracefully', async () => {
        rag.savePartition('root', { chunks: [] });

        await rag.deleteDocumentIndex('file1.txt');

        const index = rag.loadPartition('root');

        expect(index.chunks).toHaveLength(0);
    });

    it('should handle a missing index gracefully without throwing errors', async () => {
        // Should resolve cleanly without error when no partition exists
        await expect(rag.deleteDocumentIndex('file1.txt')).resolves.toBeUndefined();
    });
});
