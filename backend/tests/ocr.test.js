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

const { extractTextFromFile } = require('../lib/ocr');
const fs = require('fs');
const child_process = require('child_process');

jest.mock('fs');
jest.mock('child_process');
jest.mock('pdf-parse', () => jest.fn());
jest.mock('tesseract.js', () => ({
    createWorker: jest.fn().mockResolvedValue({
        recognize: jest.fn().mockResolvedValue({ data: { text: 'mocked ocr text' } }),
        terminate: jest.fn().mockResolvedValue()
    })
}));

jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    getDocument: jest.fn().mockReturnValue({
        promise: Promise.resolve({
            numPages: 1,
            getPage: jest.fn().mockResolvedValue({
                getViewport: jest.fn().mockReturnValue({ width: 100, height: 100 }),
                render: jest.fn().mockReturnValue({ promise: Promise.resolve() })
            })
        })
    }),
    GlobalWorkerOptions: {}
}), { virtual: true });

jest.mock('canvas', () => ({
    createCanvas: jest.fn().mockReturnValue({
        getContext: jest.fn(),
        toBuffer: jest.fn().mockReturnValue(Buffer.from('mock image buffer'))
    })
}));

describe('extractTextFromFile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should extract text from plain text files (.txt)', async () => {
        fs.readFileSync.mockReturnValue('mocked plain text');
        const result = await extractTextFromFile('document.txt');
        expect(result).toEqual({ text: 'mocked plain text', ocr: false });
        expect(fs.readFileSync).toHaveBeenCalledWith('document.txt', 'utf-8');
    });

    it('should extract text from html files (.html)', async () => {
        fs.readFileSync.mockReturnValue('mocked html text');
        const result = await extractTextFromFile('document.html');
        expect(result).toEqual({ text: 'mocked html text', ocr: false });
        expect(fs.readFileSync).toHaveBeenCalledWith('document.html', 'utf-8');
    });

    it('should extract text from Word documents (.docx) successfully', async () => {
        child_process.execFile.mockImplementation((cmd, args, opts, cb) => {
            cb(null, { stdout: '<w:p><w:t>mocked docx text</w:t></w:p>' });
        });
        const result = await extractTextFromFile('document.docx');
        expect(result).toEqual({ text: 'mocked docx text', ocr: false });
    });

    it('should handle errors when extracting text from Word documents (.docx)', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        child_process.execFile.mockImplementation((cmd, args, opts, cb) => {
            cb(new Error('unzip failed'), null);
        });
        const result = await extractTextFromFile('error.docx');
        expect(result).toEqual({ text: '', ocr: false });
        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('should run direct OCR on image files', async () => {
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const result = await extractTextFromFile('image.png');
        expect(result).toEqual({ text: 'mocked ocr text', ocr: true });
        consoleLogSpy.mockRestore();
    });

    it('should handle digital PDF files correctly', async () => {
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const pdfParse = require('pdf-parse');
        // Return a text long enough to be considered digital (> 80 chars)
        const longText = 'a'.repeat(100);
        pdfParse.mockResolvedValue({ text: longText });
        fs.readFileSync.mockReturnValue(Buffer.from('pdf data'));

        const result = await extractTextFromFile('digital.pdf');
        expect(result).toEqual({ text: longText, ocr: false });
        expect(pdfParse).toHaveBeenCalledWith(Buffer.from('pdf data'));
        consoleLogSpy.mockRestore();
    });

    it('should handle scanned PDF files correctly (fallback to OCR)', async () => {
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const pdfParse = require('pdf-parse');
        // Return a short text to trigger OCR (< 80 chars)
        pdfParse.mockResolvedValue({ text: 'short text' });
        fs.readFileSync.mockReturnValue(Buffer.from('pdf data'));

        const result = await extractTextFromFile('scanned.pdf');
        // Format of ocrScannedPdf string builder
        expect(result).toEqual({ text: '--- Strana 1 ---\nmocked ocr text', ocr: true });
        consoleLogSpy.mockRestore();
    });

    it('should handle pdf-parse errors and fallback to OCR', async () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const pdfParse = require('pdf-parse');
        pdfParse.mockRejectedValue(new Error('pdf-parse failed'));
        fs.readFileSync.mockReturnValue(Buffer.from('pdf data'));

        const result = await extractTextFromFile('error.pdf');
        expect(result).toEqual({ text: '--- Strana 1 ---\nmocked ocr text', ocr: true });
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('PDF-parse selhal'));

        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    it('should handle completely failed OCR for PDF and return empty string', async () => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const pdfParse = require('pdf-parse');
        pdfParse.mockResolvedValue({ text: 'short text' });
        fs.readFileSync.mockReturnValue(Buffer.from('pdf data'));

        const tesseract = require('tesseract.js');
        // Override tesseract behavior to return empty for this test
        tesseract.createWorker.mockResolvedValueOnce({
            recognize: jest.fn().mockResolvedValue({ data: { text: '' } }),
            terminate: jest.fn().mockResolvedValue()
        });

        const result = await extractTextFromFile('failed_ocr.pdf');
        expect(result).toEqual({ text: '', ocr: true });
        expect(consoleWarnSpy).toHaveBeenCalledWith('⚠️ OCR: Ani OCR neposkytl text. Vracím prázdný řetězec.');

        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    it('should return empty text for unsupported file extensions', async () => {
        const result = await extractTextFromFile('unknown.xyz');
        expect(result).toEqual({ text: '', ocr: false });
    });
});
