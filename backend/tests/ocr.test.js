const { isScannedPdf } = require('../lib/ocr');

describe('isScannedPdf', () => {
    it('should return true for an empty string', () => {
        expect(isScannedPdf('')).toBe(true);
    });

    it('should return true for null or undefined', () => {
        expect(isScannedPdf(null)).toBe(true);
        expect(isScannedPdf(undefined)).toBe(true);
    });

    it('should return true for a string with less than 80 characters', () => {
        const shortString = 'a'.repeat(79);
        expect(isScannedPdf(shortString)).toBe(true);
    });

    it('should return false for a string with 80 or more characters', () => {
        const longString = 'a'.repeat(80);
        expect(isScannedPdf(longString)).toBe(false);
        const evenLongerString = 'a'.repeat(100);
        expect(isScannedPdf(evenLongerString)).toBe(false);
    });

    it('should strip whitespace before evaluating the string length', () => {
        const stringWithOptionsOfWhitespace = '  a  \n \t'.repeat(79) + '  '; // 79 non-whitespace chars, lots of whitespace
        expect(isScannedPdf(stringWithOptionsOfWhitespace)).toBe(true);

        const stringWithOptionsOfWhitespaceLong = '  a  \n \t'.repeat(80) + '  '; // 80 non-whitespace chars, lots of whitespace
        expect(isScannedPdf(stringWithOptionsOfWhitespaceLong)).toBe(false);
    });
});
