const { writeToSystemCalendar } = require('../lib/calendar');

describe('calendar.js', () => {
    describe('writeToSystemCalendar', () => {
        let originalPlatform;

        beforeAll(() => {
            originalPlatform = process.platform;
        });

        afterAll(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform
            });
        });

        it('should throw an error if date is not provided', async () => {
            await expect(writeToSystemCalendar({ title: 'Test Event' }))
                .rejects.toThrow("Date is required.");
        });

        it('should return unsupported_platform for platforms other than darwin or win32', async () => {
            // Mock process.platform to be 'linux'
            Object.defineProperty(process, 'platform', {
                value: 'linux'
            });

            const result = await writeToSystemCalendar({
                title: 'Test Event',
                date: '2025-10-10'
            });

            expect(result).toBe('unsupported_platform');
        });
    });
});
