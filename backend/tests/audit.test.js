const audit = require('../lib/audit');

describe('Audit Logger', () => {
    let consoleErrorSpy;
    let consoleLogSpy;
    let originalDateNow;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        originalDateNow = Date.now;
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
        Date.now = originalDateNow;
    });

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
});
