/**
 * Testy kalendářové dostupnosti a rezervace (deterministický engine + endpointy).
 *  • kolize s událostí a s DOPRAVNÍ rezervou (travelBufferMin),
 *  • pracovní hodiny,
 *  • FAIL-CLOSED rezervace: obsazený termín → 409 + alternativy, volný → 201.
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `lexis_test_cal_${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.API_TOKEN = 'tok-test';
process.env.WATCH_DIR = tmp;
process.env.LEXIS_KEY_DIR = tmp + '_key';

const request = require('supertest');
const app = require('../server');
const db = require('../lib/database');
const av = require('../lib/calendarAvailability');
const H = (r) => r.set('X-API-Token', 'tok-test');

describe('engine dostupnosti (deterministický)', () => {
    const events = [{ type: 'hearing', title: 'Soud', date: '2026-09-01', time: '10:00' }]; // 10:00–12:00
    test('slot uvnitř jednání koliduje', () => {
        const r = av.checkSlot(events, '2026-09-01', av._toMin('11:00'), 60, { travelBufferMin: 30 });
        expect(r.free).toBe(false);
        expect(r.conflicts.length).toBe(1);
    });
    test('slot těsně po jednání koliduje kvůli dopravě', () => {
        const r = av.checkSlot(events, '2026-09-01', av._toMin('12:15'), 60, { travelBufferMin: 30 });
        expect(r.free).toBe(false);
    });
    test('dostatečně vzdálený slot je volný', () => {
        const r = av.checkSlot(events, '2026-09-01', av._toMin('13:00'), 60, { travelBufferMin: 30 });
        expect(r.free).toBe(true);
    });
    test('mimo pracovní hodiny → nevolno', () => {
        const r = av.checkSlot(events, '2026-09-01', av._toMin('07:00'), 60, {});
        expect(r.free).toBe(false);
        expect(r.withinHours).toBe(false);
    });
    test('findFreeSlots nevrací sloty kolidující s jednáním', () => {
        const slots = av.findFreeSlots(events, '2026-09-01', 60, { travelBufferMin: 30 });
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.some(s => s.start >= '09:30' && s.start < '12:30')).toBe(false);
    });
});

describe('endpointy /api/calendar/availability a /book (fail-closed)', () => {
    beforeEach(() => { db.set('alerts', []); db.set('meetings', [{ id: 'm0', title: 'Porada', date: '2026-09-02', time: '10:00', durationMin: 60, status: 'scheduled' }]); });

    test('availability obsazeného slotu → free:false + suggestions', async () => {
        const r = await H(request(app).post('/api/calendar/availability')).send({ date: '2026-09-02', time: '10:30', durationMin: 60, travelBufferMin: 30 });
        expect(r.statusCode).toBe(200);
        expect(r.body.check.free).toBe(false);
        expect(r.body.suggestions.length).toBeGreaterThan(0);
    });

    test('book kolizní termín → 409 + alternativy (nic se nerezervuje)', async () => {
        const r = await H(request(app).post('/api/calendar/book')).send({ title: 'Klient A', date: '2026-09-02', time: '10:15', durationMin: 60, travelBufferMin: 30 });
        expect(r.statusCode).toBe(409);
        expect(r.body.suggestions.length).toBeGreaterThan(0);
    });

    test('book volný termín → 201 a uloží schůzku', async () => {
        const r = await H(request(app).post('/api/calendar/book')).send({ title: 'Klient B', date: '2026-09-02', time: '14:00', durationMin: 45, travelBufferMin: 30, location: 'Brno' });
        expect(r.statusCode).toBe(201);
        expect(r.body.meeting.time).toBe('14:00');
    });

    test('chybějící pole → 400', async () => {
        const r = await H(request(app).post('/api/calendar/book')).send({ title: 'X' });
        expect(r.statusCode).toBe(400);
    });
});
