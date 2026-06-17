const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup temporary environment variables BEFORE loading the database
const tempWatchDir = path.join(os.tmpdir(), `lexis_test_managerial_${Date.now()}`);
process.env.WATCH_DIR = tempWatchDir;

const db = require('../lib/database');
const managerial = require('../lib/managerial');

describe('Managerial Intelligence', () => {
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

    describe('getCapacityAllocation', () => {
        it('should return default underloaded staff when there are no alerts', () => {
            const result = managerial.getCapacityAllocation();

            expect(result.staff.length).toBe(3);
            expect(result.totalAlertsCount).toBe(0);

            result.staff.forEach(member => {
                expect(member.load).toBe(0);
                expect(member.status).toBe('underloaded');
            });
        });

        it('should assign load correctly for Advokat (odvolání/rozsudek)', () => {
            db.insert('alerts', { title: 'Nové odvolání v případu', status: 'pending' });
            db.insert('alerts', { title: 'Přišel rozsudek KS', status: 'pending' });

            const result = managerial.getCapacityAllocation();

            const advokat = result.staff.find(s => s.id === 'advokat');
            expect(advokat.load).toBe(3.0); // 1.5 + 1.5
            expect(advokat.status).toBe('optimal'); // 3.0 is not > 3.0

            // Others should be 0
            expect(result.staff.find(s => s.id === 'koncipient_a').load).toBe(0);
        });

        it('should assign load correctly for Koncipient A (smlouva/lustrace)', () => {
            db.insert('alerts', { title: 'Příprava smlouva o dílo', status: 'pending' });
            db.insert('alerts', { title: 'Lustrace klienta', status: 'pending' });

            const result = managerial.getCapacityAllocation();

            const koncipientA = result.staff.find(s => s.id === 'koncipient_a');
            expect(koncipientA.load).toBe(2.0); // 1.0 + 1.0
            expect(koncipientA.status).toBe('optimal');
        });

        it('should assign load correctly for Koncipient B (other tasks)', () => {
            db.insert('alerts', { title: 'Běžný úkol', status: 'pending' });

            const result = managerial.getCapacityAllocation();

            const koncipientB = result.staff.find(s => s.id === 'koncipient_b');
            expect(koncipientB.load).toBe(0.8);
            expect(koncipientB.status).toBe('underloaded'); // 0.8 < 1.0
        });

        it('should ignore alerts that are not pending', () => {
            db.insert('alerts', { title: 'smlouva hotová', status: 'resolved' });
            db.insert('alerts', { title: 'odvolání podáno', status: 'dismissed' });

            const result = managerial.getCapacityAllocation();

            expect(result.totalAlertsCount).toBe(0);
            result.staff.forEach(member => {
                expect(member.load).toBe(0);
            });
        });

        it('should mark staff as overloaded if load > 3.0', () => {
            db.insert('alerts', { title: 'odvolání 1', status: 'pending' });
            db.insert('alerts', { title: 'odvolání 2', status: 'pending' });
            db.insert('alerts', { title: 'odvolání 3', status: 'pending' });

            const result = managerial.getCapacityAllocation();

            const advokat = result.staff.find(s => s.id === 'advokat');
            expect(advokat.load).toBe(4.5); // 1.5 * 3
            expect(advokat.status).toBe('overloaded');
        });
    });
});
