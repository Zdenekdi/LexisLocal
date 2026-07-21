/**
 * Testy SMTP maileru (backend/lib/mailer.js) přes MOCK transport — bez reálného
 * nodemaileru i SMTP serveru. Ověřují validaci nastavení, sestavení zprávy vč.
 * příloh a že se odeslání zavolá se správnými poli.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const mailer = require('../lib/mailer');

const SMTP = {
    smtp_host: 'smtp.example.cz',
    smtp_port: '465',
    smtp_user: 'advokat@example.cz',
    smtp_pass: 'tajne-heslo',
    smtp_ssl: true
};

describe('mailer.validateSmtp', () => {
    test('kompletní nastavení projde', () => {
        expect(mailer.validateSmtp(SMTP)).toEqual([]);
    });
    test('chybějící pole se vypíšou', () => {
        expect(mailer.validateSmtp({ smtp_host: 'x' })).toEqual(['smtp_port', 'smtp_user', 'smtp_pass']);
        expect(mailer.validateSmtp(null)).toContain('smtp_host');
    });
});

describe('mailer.buildMessage', () => {
    test('sestaví from/to/subject/text', () => {
        const m = mailer.buildMessage({ from: 'a@x.cz', to: 'b@y.cz', subject: 'Věc', body: 'Text' });
        expect(m).toMatchObject({ from: 'a@x.cz', to: 'b@y.cz', subject: 'Věc', text: 'Text' });
        expect(m.attachments).toBeUndefined();
    });

    test('přílohy se přidají jako {filename, path}', () => {
        const tmp = path.join(os.tmpdir(), 'mailer_test_' + process.pid + '.txt');
        fs.writeFileSync(tmp, 'x');
        try {
            const m = mailer.buildMessage({ to: 'b@y.cz', attachmentPaths: [tmp] });
            expect(m.attachments).toHaveLength(1);
            expect(m.attachments[0].path).toBe(tmp);
            expect(m.attachments[0].filename).toBe(path.basename(tmp));
        } finally { fs.unlinkSync(tmp); }
    });

    test('neexistující příloha → chyba NO_ATTACHMENT', () => {
        expect(() => mailer.buildMessage({ to: 'b@y.cz', attachmentPaths: ['/nope/missing.pdf'] }))
            .toThrow(/nebyla nalezena/);
    });
});

describe('mailer.sendMail (mock transport)', () => {
    test('odešle přes injektovaný transport se správnými poli', async () => {
        const sent = [];
        const mock = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'ok' }; } };
        const res = await mailer.sendMail(SMTP, { to: 'klient@x.cz', subject: 'Předvolání', body: 'Dobrý den' }, mock);
        expect(res.messageId).toBe('ok');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ from: 'advokat@example.cz', to: 'klient@x.cz', subject: 'Předvolání', text: 'Dobrý den' });
    });

    test('bez SMTP nastavení → chyba SMTP_CONFIG (neodešle)', async () => {
        const mock = { sendMail: async () => { throw new Error('nemělo se volat'); } };
        await expect(mailer.sendMail({}, { to: 'x@y.cz' }, mock)).rejects.toThrow(/Chybí SMTP nastavení/);
    });

    test('bez příjemce → chyba NO_RECIPIENT', async () => {
        const mock = { sendMail: async () => ({}) };
        await expect(mailer.sendMail(SMTP, { to: '' }, mock)).rejects.toThrow(/příjemce/);
    });
});
