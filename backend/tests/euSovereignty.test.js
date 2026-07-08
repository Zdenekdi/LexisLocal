const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Setup mock for Ollama before requiring other modules
jest.mock('ollama', () => {
    return {
        chat: jest.fn().mockResolvedValue({
            message: {
                content: JSON.stringify([
                    {
                        step: 1,
                        agentId: "sekretarka",
                        instruction: "Napíše e-mail.",
                        tier: "light"
                    },
                    {
                        step: 2,
                        agentId: "spisovatel",
                        instruction: "Sepiš žalobu.",
                        tier: "advanced"
                    }
                ])
            }
        }),
        list: jest.fn().mockResolvedValue({
            models: [
                { name: 'llama3:latest' },
                { name: 'mistral:latest' }
            ]
        }),
        embeddings: jest.fn().mockResolvedValue({
            embedding: [0.1, 0.2, 0.3]
        })
    };
});

// Setup temporary watched directory for database isolation in tests
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_sovereignty_${Date.now()}`);
if (!fs.existsSync(tempWatchDir)) {
    fs.mkdirSync(tempWatchDir, { recursive: true });
}
process.env.WATCH_DIR = tempWatchDir;

const { anonymizeText } = require('../lib/anonymizer');
const { calculateInferenceMetrics, getHardwareProfile, getSystemTelemetry } = require('../lib/green_monitor');
const { generateDublinCoreXml } = require('../lib/archival');
const db = require('../lib/database');
const orchestrator = require('../lib/orchestrator');
const rag = require('../lib/rag');

describe('Sovereign Environment Setup', () => {
    afterAll(() => {
        // Clean up global temp folder at the very end
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    describe('GDPR Sovereign Data Shield (Anonymizer)', () => {
        it('redacts e-mails correctly', () => {
            const text = 'Kontaktujte mě na jan.novak@firma.cz nebo info@advokat.cz.';
            const anonymized = anonymizeText(text);
            expect(anonymized).toBe('Kontaktujte mě na [E-MAIL] nebo [E-MAIL].');
        });

        it('redacts Czech birth numbers (rodná čísla) correctly', () => {
            const text = 'Obviněný Jan Novotný, nar. 850708/1234, bytem Ostrava.';
            const anonymized = anonymizeText(text);
            expect(anonymized).toContain('[RODNÉ ČÍSLO]');
            expect(anonymized).not.toContain('850708/1234');
        });

        it('redacts Czech phone numbers correctly', () => {
            const text = 'Mé telefonní číslo je +420 777 123 456, případně volejte 602987654.';
            const anonymized = anonymizeText(text);
            expect(anonymized).toBe('Mé telefonní číslo je [TELEFON], případně volejte [TELEFON].');
        });

        it('redacts Czech academic titles and names correctly', () => {
            const text = 'Rozhodnutí připravil Mgr. Jiří Kopecký a schválil JUDr. Martin Černý.';
            const anonymized = anonymizeText(text);
            expect(anonymized).toBe('Rozhodnutí připravil [JMÉNO A TITUL] a schválil [JMÉNO A TITUL].');
        });

        it('redacts common Czech given names + surnames correctly', () => {
            const text = 'Žalobce Jan Novák a svědek Petr Svoboda byli přítomni.';
            const anonymized = anonymizeText(text);
            expect(anonymized).toBe('Žalobce [JMÉNO A PŘÍJMENÍ] a svědek [JMÉNO A PŘÍJMENÍ] byli přítomni.');
        });
    });

    describe('Green AI Resource Monitor', () => {
        it('retrieves valid hardware profile info', () => {
            const profile = getHardwareProfile();
            expect(profile).toHaveProperty('hardwareName');
            expect(profile).toHaveProperty('estimatedTdp');
            expect(typeof profile.estimatedTdp).toBe('number');
        });

        it('calculates energy and carbon metrics correctly', () => {
            const metrics = calculateInferenceMetrics(5000);
            expect(metrics).toHaveProperty('hardware');
            expect(metrics).toHaveProperty('tdpWatts');
            expect(metrics.durationSeconds).toBe(5);
            expect(metrics.energyWh).toBeGreaterThan(0);
            expect(metrics.co2Grams).toBeGreaterThan(0);
            expect(metrics.cloudEquivalentWh).toBe(2.5);
            expect(metrics.cloudCo2Grams).toBe(1.0);
            expect(metrics).toHaveProperty('carbonSavedGrams');
            expect(metrics.co2SavingPercent).toBeDefined();
        });
    });

    describe('Sovereign Cryptographic Security (Key Rotation)', () => {
        it('should successfully rotate local database encryption key and re-encrypt RAG partitions', () => {
            const initialKeyFile = path.join(tempWatchDir, '.lexis.key');
            expect(fs.existsSync(initialKeyFile)).toBe(true);
            const originalKeyHex = fs.readFileSync(initialKeyFile, 'utf8');

            // Create a dummy RAG partition folder to register under active directories
            const dummyPartitionDir = 'ClientTestKeyRotation';
            fs.mkdirSync(path.join(tempWatchDir, dummyPartitionDir), { recursive: true });

            const dummyPartitionId = crypto.createHash('sha256').update(dummyPartitionDir).digest('hex').substring(0, 16);
            const partitionPath = path.join(tempWatchDir, `.rag_${dummyPartitionId}.json`);
            
            // Write mock encrypted RAG data using old key
            rag.savePartition(dummyPartitionDir, { chunks: [{ id: 'c1', fileName: `${dummyPartitionDir}/file.txt`, text: 'důvěrná informace', vector: [0.1, 0.2] }] });
            expect(fs.existsSync(partitionPath)).toBe(true);

            // Execute key rotation
            const success = db.rotateEncryptionKey();
            expect(success).toBe(true);

            // Verify database key has changed
            const newKeyHex = fs.readFileSync(initialKeyFile, 'utf8');
            expect(newKeyHex).not.toBe(originalKeyHex);

            // Verify RAG partition is readable and decrypted successfully with the rotated key
            const loaded = rag.loadPartition(dummyPartitionDir);
            expect(loaded.chunks).toHaveLength(1);
            expect(loaded.chunks[0].text).toBe('důvěrná informace');
        });
    });

    describe('Smart Model Routing & Swarm Tiering', () => {
        it('should decompose query with task tiers', async () => {
            const steps = await orchestrator.decomposeQuery('Sepiš žalobu a pošli o tom sekretářce e-mail.', 'llama3');
            expect(steps).toBeDefined();
            expect(steps[0]).toHaveProperty('tier');
            expect(steps[0].tier === 'light' || steps[0].tier === 'advanced').toBe(true);
        });
    });

    describe('Hardware Performance Telemetry', () => {
        it('gathers valid memory and CPU telemetry metrics', () => {
            const stats = getSystemTelemetry();
            expect(stats).toHaveProperty('platform');
            expect(stats).toHaveProperty('cpuCores');
            expect(stats).toHaveProperty('memoryTotalGb');
            expect(stats).toHaveProperty('memoryFreeGb');
            expect(stats).toHaveProperty('vramTotalGb');
            expect(stats).toHaveProperty('vramFreeGb');
        });
    });

    describe('Sovereign Archival Metadata (Dublin Core XML)', () => {
        it('generates a compliant Dublin Core XML sidecar descriptor', () => {
            const xml = generateDublinCoreXml({
                title: 'Smlouva o dílo',
                creator: 'JUDr. Martin Černý',
                description: 'Vymalování kanceláře',
                language: 'cs'
            });
            
            expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
            expect(xml).toContain('<dc:title>Smlouva o dílo</dc:title>');
            expect(xml).toContain('<dc:creator>JUDr. Martin Černý</dc:creator>');
            expect(xml).toContain('<dc:description>Vymalování kanceláře</dc:description>');
            expect(xml).toContain('<dc:language>cs</dc:language>');
        });
    });

    describe('Zero-Knowledge RAG Partitioning', () => {
        it('isolates and encrypts different client files inside separate partitions', async () => {
            const fileA = 'KlientA/smlouva.txt';
            const fileB = 'KlientB/žaloba.txt';
            
            // Create target folders
            fs.mkdirSync(path.join(tempWatchDir, 'KlientA'), { recursive: true });
            fs.mkdirSync(path.join(tempWatchDir, 'KlientB'), { recursive: true });

            // Index documents into their respective partitions
            await rag.indexDocument(fileA, 'Obsah smlouvy klienta A.');
            await rag.indexDocument(fileB, 'Obsah žaloby klienta B.');
            
            // Verify partitions exist on disk
            const hashA = crypto.createHash('sha256').update('KlientA').digest('hex').substring(0, 16);
            const hashB = crypto.createHash('sha256').update('KlientB').digest('hex').substring(0, 16);
            
            expect(fs.existsSync(path.join(tempWatchDir, `.rag_${hashA}.json`))).toBe(true);
            expect(fs.existsSync(path.join(tempWatchDir, `.rag_${hashB}.json`))).toBe(true);
            
            // Query search with scoped partition filtering
            const matchesA = await rag.searchSimilar('smlouva', 5, { directory: 'KlientA' });
            expect(matchesA).toHaveLength(1);
            expect(matchesA[0].fileName).toBe(fileA);
            
            const matchesB = await rag.searchSimilar('žaloba', 5, { directory: 'KlientB' });
            expect(matchesB).toHaveLength(1);
            expect(matchesB[0].fileName).toBe(fileB);
        });
    });
});
