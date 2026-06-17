const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary environment variables BEFORE loading the database
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_audit_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const audit = require('../lib/audit');
const AUDIT_LOG_FILE = path.join(tempWatchDir, '.audit_log.json');

describe('Audit Utility', () => {
    let consoleErrorSpy;
    let consoleLogSpy;
    let originalDateNow;

    beforeAll(() => {
        if (!fs.existsSync(tempWatchDir)) {
            fs.mkdirSync(tempWatchDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(tempWatchDir)) {
            fs.rmSync(tempWatchDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        originalDateNow = Date.now;

        // Clear the audit log file before each test
        if (fs.existsSync(AUDIT_LOG_FILE)) {
            fs.rmSync(AUDIT_LOG_FILE);
        }
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        Date.now = originalDateNow;
    });

    describe('loadAuditLogs', () => {
        it('should return an empty array if the audit log file does not exist', () => {
            const logs = audit.loadAuditLogs();
            expect(logs).toEqual([]);
        });

        it('should return an empty array if the audit log file is invalid JSON', () => {
            fs.writeFileSync(AUDIT_LOG_FILE, 'invalid-json', 'utf-8');
            const logs = audit.loadAuditLogs();
            expect(logs).toEqual([]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("❌ Nepodařilo se načíst auditní log:"),
                expect.any(String)
            );
        });

        it('should return parsed logs if the audit log file is valid JSON', () => {
            const mockLogs = [{ id: '1', user: 'TestUser' }];
            fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(mockLogs), 'utf-8');
            const logs = audit.loadAuditLogs();
            expect(logs).toEqual(mockLogs);
        });
    });

    describe('logEvent', () => {
        it('should successfully log an event', () => {
            audit.logEvent('TestUser', 'TestOp', 'TestTarget');
            expect(consoleLogSpy).toHaveBeenCalledWith(
                expect.stringContaining('📜 Audit: Zaznamenán úkon [TestOp] pro [TestTarget]')
            );
        });

        it('should catch errors and log them via console.error', () => {
            Date.now = jest.fn(() => {
                throw new Error('Mocked Date.now error');
            });

            audit.logEvent('TestUser', 'TestOp', 'TestTarget');

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                '❌ Chyba logování:',
                'Mocked Date.now error'
            );
        });

        it('should log a new event and save it to the file', () => {
            audit.logEvent('TestUser', 'TestOperation', 'TestTarget', { testDetail: true });

            const logs = audit.loadAuditLogs();
            expect(logs.length).toBe(1);
            expect(logs[0].user).toBe('TestUser');
            expect(logs[0].operation).toBe('TestOperation');
            expect(logs[0].target).toBe('TestTarget');
            expect(logs[0].details).toEqual({ testDetail: true });
            expect(logs[0].id).toBeDefined();
            expect(logs[0].timestamp).toBeDefined();
        });

        it('should cap logs to 1000 items', () => {
            // Generate 1005 dummy logs
            const manyLogs = Array.from({ length: 1005 }).map((_, i) => ({
                id: `log_${i}`,
                user: 'User',
                operation: 'Op',
                target: 'Target'
            }));

            // Save them initially (simulate existing file)
            fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(manyLogs), 'utf-8');

            // Log one more event
            audit.logEvent('NewUser', 'NewOp', 'NewTarget');

            // Verify
            const logs = audit.loadAuditLogs();
            expect(logs.length).toBe(1000);

            // Verify it kept the newest ones. The newest event should be the last one.
            expect(logs[999].user).toBe('NewUser');
            expect(logs[999].operation).toBe('NewOp');
            expect(logs[999].target).toBe('NewTarget');

            // The first one should be log_6 because we had 1005 logs + 1 new = 1006. 1006 - 1000 = 6 were dropped.
            expect(logs[0].id).toBe('log_6');
        });
    });
});
