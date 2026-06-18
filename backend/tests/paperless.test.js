const { runRegexExtractor } = require('../lib/paperless');

describe('runRegexExtractor', () => {
    it('returns default metadata for empty inputs', () => {
        const result = runRegexExtractor('', [], '');
        expect(result).toEqual({
            caseNumber: '',
            plaintiff: '',
            defendant: '',
            deadlineDays: 0,
            deadlineDate: null,
            summary: 'Dokument importovaný z Paperless-ngx.',
            ico: ''
        });
    });

    describe('caseNumber extraction', () => {
        it('extracts caseNumber from tags', () => {
            const tags = ['important', '23 C 120/2026', 'urgent'];
            const result = runRegexExtractor('Some title', tags, 'Some text here');
            expect(result.caseNumber).toBe('23 C 120/2026');
        });

        it('extracts caseNumber from text with sp. zn. prefix', () => {
            const text = 'Toto je dokument sp. zn. 45 D 12/2023 k projednání.';
            const result = runRegexExtractor('Title', [], text);
            expect(result.caseNumber).toBe('45 D 12/2023');
        });

        it('extracts caseNumber from text with č. j. prefix', () => {
            const text = 'Rozhodnutí č. j. 12 A 34/2024 bylo vydáno.';
            const result = runRegexExtractor('Title', [], text);
            expect(result.caseNumber).toBe('12 A 34/2024');
        });

        it('extracts caseNumber from title with spisová značka prefix', () => {
            const title = 'Rozsudek spisová značka 99 T 1/2025';
            const result = runRegexExtractor(title, [], 'Some text');
            expect(result.caseNumber).toBe('99 T 1/2025');
        });

        it('extracts caseNumber using fallback broad regex from text', () => {
            const text = 'Věc 77 C 88/2022 se odročuje.';
            const result = runRegexExtractor('Title', [], text);
            expect(result.caseNumber).toBe('77 C 88/2022');
        });

        it('extracts caseNumber using fallback broad regex from title', () => {
            const title = 'Dokument 11 B 22/2021';
            const result = runRegexExtractor(title, [], 'Text without case number');
            expect(result.caseNumber).toBe('11 B 22/2021');
        });
    });

    describe('deadline extraction', () => {
        beforeAll(() => {
            jest.useFakeTimers();
        });

        afterAll(() => {
            jest.useRealTimers();
        });

        it('extracts deadlineDays and calculates deadlineDate', () => {
            jest.setSystemTime(new Date('2023-01-01T12:00:00Z'));

            const text = 'Soud vyzývá, lhůta k vyjádření činí 15 dnů od doručení.';
            const result = runRegexExtractor('Title', [], text);

            expect(result.deadlineDays).toBe(15);
            // 2023-01-01 + 15 days = 2023-01-16
            expect(result.deadlineDate).toBe('2023-01-16');
        });

        it('extracts deadline with "ve lhůtě" wording', () => {
             jest.setSystemTime(new Date('2024-05-10T12:00:00Z'));

             const text = 'Zaslat ve lhůtě 30 dnů.';
             const result = runRegexExtractor('Title', [], text);

             expect(result.deadlineDays).toBe(30);
             // 2024-05-10 + 30 days = 2024-06-09
             expect(result.deadlineDate).toBe('2024-06-09');
        });
    });

    describe('plaintiff extraction', () => {
        it('extracts plaintiff with "žalobce:" prefix', () => {
            const text = 'žalobce: Jan Novák, nar. 1.1.1980\nDalší text';
            const result = runRegexExtractor('Title', [], text);
            expect(result.plaintiff).toBe('Jan Novák');
        });

        it('extracts plaintiff with "žalující strana:" prefix', () => {
            const text = 'Žalující strana: Firma ABC s r o , se sídlem v Praze';
            const result = runRegexExtractor('Title', [], text);
            expect(result.plaintiff).toBe('Firma ABC s r o');
        });
    });

    describe('defendant extraction', () => {
        it('extracts defendant with "žalované:" prefix', () => {
            const text = 'žalované : Petr Svoboda';
            const result = runRegexExtractor('Title', [], text);
            expect(result.defendant).toBe('Petr Svoboda');
        });

        it('extracts defendant with "žalovaná strana:" prefix', () => {
            const text = 'Nějaký úvod.\nŽalovaná strana: DEF a s IČO 12345678.';
            const result = runRegexExtractor('Title', [], text);
            expect(result.defendant).toBe('DEF a s IČO 12345678');
        });
    });

    describe('ico extraction', () => {
        it('extracts ico with "IČO" prefix', () => {
            const text = 'Dodavatel: XYZ s.r.o., IČO: 12345678, zapsaná v...';
            const result = runRegexExtractor('Title', [], text);
            expect(result.ico).toBe('12345678');
        });

        it('extracts ico with "IČ" prefix and spaces', () => {
            const text = 'Společnost s IČ 9 8 7 6 5 4 3 2 se sídlem tamtéž.';
            const result = runRegexExtractor('Title', [], text);
            expect(result.ico).toBe('98765432');
        });
    });
});
