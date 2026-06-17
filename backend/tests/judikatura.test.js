const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary environment variables BEFORE loading the database
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_judikatura_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const judikaturaWatcher = require('../lib/judikatura');

describe('JudikaturaWatcher Compliance Checks', () => {
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
        // Clear collections before each test
        for (const key in db.collections) {
            db.collections[key] = [];
        }
        db.save();
    });

    it('should return success and compliant for empty content', () => {
        const result = judikaturaWatcher.checkTemplateCompliance('');
        expect(result.success).toBe(true);
        expect(result.compliant).toBe(true);
        expect(result.alerts).toEqual([]);
    });

    it('should mark content without trigger keywords as compliant and log it', () => {
        const content = 'Tato smlouva neobsahuje žádné problematické termíny.';
        const result = judikaturaWatcher.checkTemplateCompliance(content, 'BezpecnaSmlouva.docx');

        expect(result.success).toBe(true);
        expect(result.compliant).toBe(true);
        expect(result.alerts.length).toBe(0);

        const logs = db.get('compliance_logs');
        expect(logs.length).toBe(1);
        expect(logs[0].documentName).toBe('BezpecnaSmlouva.docx');
        expect(logs[0].alertsCount).toBe(0);
    });

    it('should be compliant if trigger keyword is present but phrasing is valid', () => {
        // "smluvní pokuta" is a trigger keyword, but "0.05 % z dlužné částky za každý den prodlení" is valid
        const content = 'Smluvní pokuta ve výši 0.05 % z dlužné částky za každý den prodlení.';
        const result = judikaturaWatcher.checkTemplateCompliance(content, 'ValidniSmlouva.docx');

        expect(result.success).toBe(true);
        expect(result.compliant).toBe(true);
        expect(result.alerts.length).toBe(0);

        const logs = db.get('compliance_logs');
        expect(logs[0].alertsCount).toBe(0);
    });

    it('should detect non-compliant text, return false for compliant, and log alerts', () => {
        const content = 'Smluvní pokuta ve výši 0.5 % denně za prodlení.';
        const result = judikaturaWatcher.checkTemplateCompliance(content, 'RizikovaSmlouva.docx');

        expect(result.success).toBe(true);
        expect(result.compliant).toBe(false);
        expect(result.alerts.length).toBe(1);
        expect(result.alerts[0].topic).toBe('Neplatnost smluvní pokuty v obchodních vztazích');
        expect(result.alerts[0].severity).toBe('high');

        // Check if alert was inserted into transactional DB
        const alerts = db.get('alerts');
        expect(alerts.length).toBe(1);
        expect(alerts[0].title).toContain('RizikovaSmlouva.docx');

        // Check if compliance log was updated
        const logs = db.get('compliance_logs');
        expect(logs.length).toBe(1);
        expect(logs[0].alertsCount).toBe(1);
    });

    it('should trigger multiple alerts for a document with multiple distinct violations', () => {
        const content = `
            Tyto osobní údaje: Souhlasím se zpracováním všech osobních údajů.
            Zároveň se sjednává úrok z prodlení ve výši 25%.
        `;
        const result = judikaturaWatcher.checkTemplateCompliance(content, 'KombinovanaSmlouva.docx');

        expect(result.success).toBe(true);
        expect(result.compliant).toBe(false);
        expect(result.alerts.length).toBe(2);

        // Check if alerts were inserted into transactional DB
        const alerts = db.get('alerts');
        expect(alerts.length).toBe(2);

        // Check if compliance log was updated
        const logs = db.get('compliance_logs');
        expect(logs.length).toBe(1);
        expect(logs[0].alertsCount).toBe(2);
    });
});
