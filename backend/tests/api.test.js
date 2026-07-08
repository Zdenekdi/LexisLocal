const request = require('supertest');
const app = require('../server');

describe('API Smoke Tests', () => {
  it('should return HTML for the root path', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('should return available agents', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agents).toBeDefined();
    expect(Array.isArray(Object.values(res.body.agents))).toBe(true);
  });

  it('should return system green metrics', async () => {
    const res = await request(app).get('/api/system/green-metrics');
    expect(res.statusCode).toEqual(200);
    expect(res.body.hardware).toBeDefined();
    expect(res.body.totalEnergyWh).toBeDefined();
  });

  it('should export all system data for portability', async () => {
    const res = await request(app).get('/api/system/export');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.metadata).toBeDefined();
    expect(res.body.database).toBeDefined();
    expect(res.body.inbox).toBeDefined();
  });
});
