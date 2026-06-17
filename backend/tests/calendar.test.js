const { generateAppleScriptDate } = require('../lib/calendar');

describe('generateAppleScriptDate', () => {
    it('should generate valid AppleScript for a specific date and time', () => {
        // Date: 2025-06-15T14:30:45
        const testDate = new Date(2025, 5, 15, 14, 30, 45); // Month is 0-indexed in JS (5 = June)

        const script = generateAppleScriptDate('myDate', testDate);

        // Expected time in seconds: 14 * 3600 + 30 * 60 + 45 = 50400 + 1800 + 45 = 52245
        const expectedScript = `
set myDate to (current date)
set day of myDate to 1
set year of myDate to 2025
set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
set month of myDate to item 6 of monthNames
set day of myDate to 15
set time of myDate to (14 * 3600 + 30 * 60 + 45)
        `.trim();

        expect(script).toBe(expectedScript);
    });

    it('should handle midnight correctly (0 hours, 0 minutes, 0 seconds)', () => {
        // Date: 2024-01-01T00:00:00
        const testDate = new Date(2024, 0, 1, 0, 0, 0); // Month is 0-indexed in JS (0 = January)

        const script = generateAppleScriptDate('startDate', testDate);

        const expectedScript = `
set startDate to (current date)
set day of startDate to 1
set year of startDate to 2024
set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
set month of startDate to item 1 of monthNames
set day of startDate to 1
set time of startDate to (0 * 3600 + 0 * 60 + 0)
        `.trim();

        expect(script).toBe(expectedScript);
    });

    it('should handle end of day correctly (23 hours, 59 minutes, 59 seconds)', () => {
        // Date: 2023-12-31T23:59:59
        const testDate = new Date(2023, 11, 31, 23, 59, 59); // Month is 0-indexed in JS (11 = December)

        const script = generateAppleScriptDate('endDate', testDate);

        const expectedScript = `
set endDate to (current date)
set day of endDate to 1
set year of endDate to 2023
set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
set month of endDate to item 12 of monthNames
set day of endDate to 31
set time of endDate to (23 * 3600 + 59 * 60 + 59)
        `.trim();

        expect(script).toBe(expectedScript);
    });

    it('should handle different variable names', () => {
        const testDate = new Date(2026, 6, 4, 12, 0, 0); // 4th of July, 2026

        const script = generateAppleScriptDate('customVarName123', testDate);

        const expectedScript = `
set customVarName123 to (current date)
set day of customVarName123 to 1
set year of customVarName123 to 2026
set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
set month of customVarName123 to item 7 of monthNames
set day of customVarName123 to 4
set time of customVarName123 to (12 * 3600 + 0 * 60 + 0)
        `.trim();

        expect(script).toBe(expectedScript);
    });
});
