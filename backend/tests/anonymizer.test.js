/**
 * Testy GDPR anonymizéru (backend/lib/anonymizer.js). Kritické: neúnik PII
 * (e-mail, rodné číslo, telefon, jméno) A zároveň žádná nadměrná redakce
 * (spisové značky, ČÁSTKY, IČO se nesmí ničit). Dokumentuje i záměrné hranice.
 */
const { anonymizeText } = require('../lib/anonymizer');

describe('redakce PII (nesmí uniknout)', () => {
    test('e-mail', () => {
        expect(anonymizeText('Kontakt: jan.novak@example.cz')).toBe('Kontakt: [E-MAIL]');
    });
    test('rodné číslo (se lomítkem, 3 i 4 číslice)', () => {
        expect(anonymizeText('RČ 850708/1234.')).toBe('RČ [RODNÉ ČÍSLO].');
        expect(anonymizeText('Nar. 900101/123.')).toBe('Nar. [RODNÉ ČÍSLO].');
    });
    test('telefon: +420, se skupinami, po klíčovém slově, po výzvě k volání', () => {
        expect(anonymizeText('+420 777 123 456')).toBe('[TELEFON]');
        expect(anonymizeText('Mobil 777 123 456.')).toBe('Mobil [TELEFON].');
        expect(anonymizeText('tel: 777123456')).toBe('tel: [TELEFON]');
        expect(anonymizeText('zavolejte 602987654 prosím')).toBe('zavolejte [TELEFON] prosím');
    });
    test('jméno: titul, i jméno+příjmení ze slovníku', () => {
        expect(anonymizeText('Zastoupen JUDr. Petr Novotný, advokát.')).toBe('Zastoupen [JMÉNO A TITUL], advokát.');
        expect(anonymizeText('Žalobce Jan Novák podal žalobu.')).toBe('Žalobce [JMÉNO A PŘÍJMENÍ] podal žalobu.');
        expect(anonymizeText('Svědek Tomáš Dvořák vypověděl.')).toBe('Svědek [JMÉNO A PŘÍJMENÍ] vypověděl.');
    });
});

describe('žádná nadměrná redakce (regrese – dřív se ničily částky)', () => {
    test('peněžní částka seskupená po tisících se NEredaguje jako telefon', () => {
        expect(anonymizeText('Dluh činí 123 456 789 Kč.')).toBe('Dluh činí 123 456 789 Kč.');
        expect(anonymizeText('Ve výši 234 567 890 Kč')).toBe('Ve výši 234 567 890 Kč');
    });
    test('spisová značka zůstává nedotčená', () => {
        expect(anonymizeText('Ve věci sp. zn. 23 C 120/2026.')).toBe('Ve věci sp. zn. 23 C 120/2026.');
    });
});

describe('známé hranice chování (dokumentace, ne bug)', () => {
    test('redakce příjmení pohltí těsně přiléhající interpunkci', () => {
        // "Novák." → "[PŘÍJMENÍ]" (token vč. tečky se nahradí celý). Akceptováno.
        expect(anonymizeText('Žalobce Jan Novák.')).toBe('Žalobce [JMÉNO A PŘÍJMENÍ]');
    });
    test('holé telefonní číslo bez kontextu se záměrně neredaguje (proti přeredakci)', () => {
        expect(anonymizeText('Číslo 777123456 v textu')).toBe('Číslo 777123456 v textu');
    });
});
