const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup mock for Ollama before requiring rag.js
jest.mock('ollama', () => {
    return {
        embeddings: jest.fn().mockResolvedValue({
            embedding: [0.1, 0.2, 0.3]
        }),
        chat: jest.fn()
    };
});

// Setup temp dir and create it BEFORE requiring rag.js
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_rag_filters_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;

const rag = require('../lib/rag');

describe('Scoped RAG Filtering', () => {
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

    it('should filter chunks by specific fileNames when filters are provided', async () => {
        const mockIndex = {
            chunks: [
                { id: '1', fileName: 'spisA.txt', text: 'Tato smlouva se týká spisu A.', vector: [0.1, 0.2, 0.3] },
                { id: '2', fileName: 'spisA.txt', text: 'Druhý odstavec spisu A.', vector: [0.1, 0.2, 0.3] },
                { id: '3', fileName: 'spisB.txt', text: 'Tento dokument se týká spisu B.', vector: [0.1, 0.2, 0.3] }
            ]
        };
        rag.savePartition('root', mockIndex);

        // Search only in spisA.txt
        const matchesSpisA = await rag.searchSimilar('smlouva', 5, { fileNames: ['spisA.txt'] });
        expect(matchesSpisA).toHaveLength(2);
        expect(matchesSpisA.every(m => m.fileName === 'spisA.txt')).toBe(true);

        // Search only in spisB.txt
        const matchesSpisB = await rag.searchSimilar('smlouva', 5, { fileNames: ['spisB.txt'] });
        expect(matchesSpisB).toHaveLength(1);
        expect(matchesSpisB[0].fileName).toBe('spisB.txt');
    });

    it('should return empty matches if the fileNames filter has no overlap with existing files', async () => {
        const mockIndex = {
            chunks: [
                { id: '1', fileName: 'spisA.txt', text: 'Tato smlouva se týká spisu A.', vector: [0.1, 0.2, 0.3] }
            ]
        };
        rag.savePartition('root', mockIndex);

        const matches = await rag.searchSimilar('smlouva', 5, { fileNames: ['nonexistent.txt'] });
        expect(matches).toHaveLength(0);
    });

    it('should return all matches if no filters are provided', async () => {
        const mockIndex = {
            chunks: [
                { id: '1', fileName: 'spisA.txt', text: 'Tato smlouva se týká spisu A.', vector: [0.1, 0.2, 0.3] },
                { id: '2', fileName: 'spisB.txt', text: 'Tento dokument se týká spisu B.', vector: [0.1, 0.2, 0.3] }
            ]
        };
        rag.savePartition('root', mockIndex);

        const matches = await rag.searchSimilar('smlouva', 5, null);
        expect(matches).toHaveLength(2);
    });

    it('should filter chunks by directory when directory filter is provided', async () => {
        // In partitioned storage, we save each directory's chunks inside its corresponding partition
        const indexA = {
            chunks: [
                { id: '1', fileName: 'KlientA/smlouva.txt', text: 'Kontext klienta A', vector: [0.1, 0.2, 0.3] },
                { id: '2', fileName: 'KlientA/Podslozka/zaloba.txt', text: 'Hlubší kontext klienta A', vector: [0.1, 0.2, 0.3] }
            ]
        };
        const indexB = {
            chunks: [
                { id: '3', fileName: 'KlientB/smlouva.txt', text: 'Kontext klienta B', vector: [0.1, 0.2, 0.3] }
            ]
        };
        
        // Mock getActiveDirectories to return our directories during the test
        const originalGetActiveDirs = rag.getActiveDirectories;
        rag.getActiveDirectories = () => ['KlientA', 'KlientB'];
        
        rag.savePartition('KlientA', indexA);
        rag.savePartition('KlientB', indexB);

        try {
            // Search in KlientA directory
            const matchesA = await rag.searchSimilar('kontext', 5, { directory: 'KlientA' });
            expect(matchesA).toHaveLength(2);
            expect(matchesA.map(m => m.fileName)).toContain('KlientA/smlouva.txt');
            expect(matchesA.map(m => m.fileName)).toContain('KlientA/Podslozka/zaloba.txt');

            // Search in KlientB directory
            const matchesB = await rag.searchSimilar('kontext', 5, { directory: 'KlientB' });
            expect(matchesB).toHaveLength(1);
            expect(matchesB[0].fileName).toBe('KlientB/smlouva.txt');
        } finally {
            // Restore original method
            rag.getActiveDirectories = originalGetActiveDirs;
        }
    });
});
