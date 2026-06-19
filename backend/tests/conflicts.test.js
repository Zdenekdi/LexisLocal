const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary directory to prevent any real DB side-effects before loading modules
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_conflicts_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const ConflictDetector = require('../lib/conflicts');
const db = require('../lib/database');
const rag = require('../lib/rag');

// Mock the RAG search
jest.mock('../lib/rag', () => ({
    searchSimilar: jest.fn()
}));

describe('ConflictDetector', () => {
    beforeAll(() => {
        if (!fs.existsSync(tempWatchDir)) {
            fs.mkdirSync(tempWatchDir, { recursive: true });
        }
        // Use fake timers in case we care about the exact timestamp,
        // though our tests don't strictly assert the timestamp right now.
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2023-01-01T00:00:00Z'));
    });

    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
        jest.useRealTimers();
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Spy and mock db.insert to avoid real file system writes during tests
        jest.spyOn(db, 'insert').mockImplementation((collectionName, data) => {
            return {
                id: 'mock-id-123',
                createdAt: new Date().toISOString(),
                ...data
            };
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('checkConflict', () => {
        it('should throw an error if clientName is missing', async () => {
            await expect(ConflictDetector.checkConflict(null, 'Opponent LLC'))
                .rejects
                .toThrow("Jméno klienta i protistrany jsou povinné pro prověření konfliktu.");
        });

        it('should throw an error if counterpartyName is missing', async () => {
            await expect(ConflictDetector.checkConflict('Client Corp', ''))
                .rejects
                .toThrow("Jméno klienta i protistrany jsou povinné pro prověření konfliktu.");
        });

        it('should return riskLevel none if no matches are found', async () => {
            rag.searchSimilar.mockResolvedValue([]);

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            expect(result.riskLevel).toBe('none');
            expect(result.conflictsFound).toHaveLength(0);
            expect(result.clientName).toBe('Client Corp');
            expect(result.counterpartyName).toBe('Opponent LLC');

            // Should be called twice: once for client, once for counterparty
            expect(rag.searchSimilar).toHaveBeenCalledTimes(2);
            expect(db.insert).toHaveBeenCalledWith('conflicts', expect.objectContaining({
                riskLevel: 'none'
            }));
        });

        it('should return riskLevel none if matches have a score below 0.70', async () => {
            rag.searchSimilar.mockResolvedValue([
                { score: 0.69, fileName: 'doc.pdf', text: 'Some text' }
            ]);

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            expect(result.riskLevel).toBe('none');
            expect(result.conflictsFound).toHaveLength(0);
        });

        it('should handle searchSimilar throwing an error gracefully and default to none', async () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            rag.searchSimilar.mockRejectedValue(new Error('Network error'));

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            expect(result.riskLevel).toBe('none');
            expect(result.conflictsFound).toHaveLength(0);
            expect(consoleWarnSpy).toHaveBeenCalledTimes(2); // One for client, one for counterparty
        });

        it('should identify high risk if counterparty matches with score >= 0.70', async () => {
            // First call for client returns empty.
            // Second call for counterparty returns a high score match.
            rag.searchSimilar
                .mockResolvedValueOnce([]) // Client
                .mockResolvedValueOnce([ // Counterparty
                    { score: 0.85, fileName: 'old_case.pdf', text: 'Opponent LLC sued us.' }
                ]);

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            expect(result.riskLevel).toBe('high');
            expect(result.description).toContain('Existuje vážné riziko střetu zájmů.');
            expect(result.conflictsFound).toHaveLength(1);
            expect(result.conflictsFound[0]).toEqual(expect.objectContaining({
                type: 'counterparty_match',
                subject: 'Opponent LLC',
                fileName: 'old_case.pdf',
                score: 0.85,
                textSnippet: 'Opponent LLC sued us....'
            }));
        });

        it('should identify medium risk if client matches with score >= 0.70', async () => {
            // First call for client returns a high score match.
            // Second call for counterparty returns empty.
            rag.searchSimilar
                .mockResolvedValueOnce([ // Client
                    { score: 0.75, fileName: 'previous_client.pdf', text: 'Client Corp onboarding.' }
                ])
                .mockResolvedValueOnce([]); // Counterparty

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            expect(result.riskLevel).toBe('medium');
            expect(result.description).toContain('Zkontrolujte, zda se nejedná o duplicitní zastupování nebo dřívější spory.');
            expect(result.conflictsFound).toHaveLength(1);
            expect(result.conflictsFound[0]).toEqual(expect.objectContaining({
                type: 'client_match',
                subject: 'Client Corp',
                fileName: 'previous_client.pdf',
                score: 0.75,
                textSnippet: 'Client Corp onboarding....'
            }));
        });

        it('should prioritize high risk (counterparty) over medium risk (client)', async () => {
            // Both match with high scores
            rag.searchSimilar
                .mockResolvedValueOnce([ // Client
                    { score: 0.80, fileName: 'client_doc.pdf', text: 'client text' }
                ])
                .mockResolvedValueOnce([ // Counterparty
                    { score: 0.90, fileName: 'opponent_doc.pdf', text: 'opponent text' }
                ]);

            const result = await ConflictDetector.checkConflict('Client Corp', 'Opponent LLC');

            // Counterparty match is checked first in the logic, so riskLevel should be high
            expect(result.riskLevel).toBe('high');
            expect(result.conflictsFound).toHaveLength(1);
            expect(result.conflictsFound[0].type).toBe('counterparty_match');
        });
    });
});
