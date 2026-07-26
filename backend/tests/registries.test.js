const { checkSubject } = require('../lib/registries');

// Živé integrační testy (reálný dotaz do ARES/ISIR) jsou opt-in — vyžadují síť
// a povolený egress. Defaultně se přeskočí, aby `npm test` byl zelený i offline
// a v CI/sandboxu. Spuštění na dev stroji: `RUN_LIVE_ARES=1 npm test`.
const itLive = process.env.RUN_LIVE_ARES ? it : it.skip;

describe('Registries Utility', () => {

    it('should return error for invalid ICO format', async () => {
        const result1 = await checkSubject('');
        expect(result1.error).toBeDefined();

        const result2 = await checkSubject('123'); // Too short
        expect(result2.error).toBeDefined();

        const result3 = await checkSubject('ABCDEFGH'); // Not digits
        expect(result3.error).toBeDefined();
    });

    it('should correctly mock ARES and ISIR data for ICO 12345678 (Bankrupt Company)', async () => {
        const result = await checkSubject('12345678');
        expect(result.ico).toBe('12345678');
        expect(result.name).toBe('Úpadce s.r.o.');
        expect(result.inInsolvency).toBe(true);
        expect(result.insolvencyCase).toBe('MSP-123/2026');
        expect(result.verifiedAt).toBeDefined();
    });

    it('should correctly mock ARES and ISIR data for ICO 88888888 (Risky Creditor)', async () => {
        const result = await checkSubject('88888888');
        expect(result.ico).toBe('88888888');
        expect(result.name).toBe('Rizikový Věřitel a.s.');
        expect(result.inInsolvency).toBe(true);
        expect(result.insolvencyCase).toBe('MSP-123/2026');
        expect(result.verifiedAt).toBeDefined();
    });

    // Real API call test (might fail if external API is down or changed, but good for sanity check)
    // Using a well known ICO (e.g., ČEZ, a.s. - 45274649) which is highly unlikely to be in insolvency
    itLive('should fetch real data from ARES and ISIR for a valid ICO (integration test)', async () => {
        const result = await checkSubject('45274649'); // ČEZ, a.s.

        expect(result.error).toBeUndefined();
        expect(result.ico).toBe('45274649');
        expect(result.name).toContain('ČEZ');
        expect(result.seat).toBeDefined();

        // It shouldn't be in insolvency
        expect(result.inInsolvency).toBe(false);
    }, 10000); // Give it a longer timeout since it makes real network requests

});
