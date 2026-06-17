const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary environment variables BEFORE loading the database
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_workflow_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const workflowEngine = require('../lib/workflow');

describe('Workflow Engine', () => {
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
        // Clear all collections before each test
        for (const key in db.collections) {
            db.collections[key] = [];
        }
        db.save();
    });

    it('should seed default rules when calling initDefaults with empty DB', () => {
        workflowEngine.initDefaults();
        const rules = db.get('workflows');
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.some(r => r.name === 'Hlídání lhůt z datových zpráv')).toBe(true);
    });

    it('should match a rule without conditionField (match-all)', async () => {
        db.insert('workflows', {
            name: "Match All Rule",
            triggerType: "test_event",
            actionTitle: "Test Action"
        });

        const alerts = await workflowEngine.triggerEvent('test_event', { anything: 'goes' });
        expect(alerts.length).toBe(1);
        expect(alerts[0].title).toBe("Test Action");
        expect(alerts[0].triggerRule).toBe("Match All Rule");
    });

    it('should match a rule with conditionField and conditionValue', async () => {
        db.insert('workflows', {
            name: "Specific Rule",
            triggerType: "test_event",
            conditionField: "status",
            conditionValue: "important",
            actionTitle: "Important Action"
        });

        const alerts = await workflowEngine.triggerEvent('test_event', { status: 'this is important news' });
        expect(alerts.length).toBe(1);
        expect(alerts[0].title).toBe("Important Action");
    });

    it('should match case-insensitively', async () => {
        db.insert('workflows', {
            name: "Case Rule",
            triggerType: "test_event",
            conditionField: "type",
            conditionValue: "Urgent",
            actionTitle: "Urgent Action"
        });

        const alerts = await workflowEngine.triggerEvent('test_event', { type: 'this is URGENT please' });
        expect(alerts.length).toBe(1);
        expect(alerts[0].title).toBe("Urgent Action");
    });

    it('should not match if conditionValue is not in payload field', async () => {
        db.insert('workflows', {
            name: "No Match Rule",
            triggerType: "test_event",
            conditionField: "type",
            conditionValue: "Urgent",
            actionTitle: "Urgent Action"
        });

        const alerts = await workflowEngine.triggerEvent('test_event', { type: 'this is normal' });
        expect(alerts.length).toBe(0);
    });

    it('should not match if conditionField is not in payload', async () => {
        db.insert('workflows', {
            name: "Missing Field Rule",
            triggerType: "test_event",
            conditionField: "priority",
            conditionValue: "high",
            actionTitle: "High Priority"
        });

        const alerts = await workflowEngine.triggerEvent('test_event', { type: 'this is normal' });
        expect(alerts.length).toBe(0);
    });

    it('should set the correct deadline (+15 days)', async () => {
        db.insert('workflows', {
            name: "Deadline Rule",
            triggerType: "test_event",
            actionTitle: "Check Deadline"
        });

        const before = new Date();
        const alerts = await workflowEngine.triggerEvent('test_event', {});
        expect(alerts.length).toBe(1);

        const after = new Date();

        const expectedDateMin = new Date(before);
        expectedDateMin.setDate(expectedDateMin.getDate() + 15);

        const expectedDateMax = new Date(after);
        expectedDateMax.setDate(expectedDateMax.getDate() + 15);

        const alertDeadline = new Date(alerts[0].deadline);

        expect(alertDeadline.getTime()).toBeGreaterThanOrEqual(expectedDateMin.getTime());
        expect(alertDeadline.getTime()).toBeLessThanOrEqual(expectedDateMax.getTime());
    });
});
