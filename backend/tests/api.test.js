const path = require('path');
const os = require('os');

// Auth je nově vyžadována VŽDY → nastavíme token PŘED načtením serveru.
const TEST_TOKEN = 'test-api-token';
process.env.API_TOKEN = TEST_TOKEN;
// Izolace dat/klíče do temp (server přes require inicializuje database singleton).
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_api_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_api_key_${Date.now()}`);

const request = require('supertest');
const app = require('../server');

describe('API Smoke Tests', () => {
  it('should return HTML for the root path (bez auth)', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('should reject API access without a token (401)', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.statusCode).toEqual(401);
  });

  it('should reject API access with a wrong token (401)', async () => {
    const res = await request(app).get('/api/agents').set('X-API-Token', 'spatny');
    expect(res.statusCode).toEqual(401);
  });

  it('should return available agents (s tokenem)', async () => {
    const res = await request(app).get('/api/agents').set('X-API-Token', TEST_TOKEN);
    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(res.body.agents).toBeDefined();
    expect(Array.isArray(Object.values(res.body.agents))).toBe(true);
  });

  it('should accept the token via Authorization: Bearer too', async () => {
    const res = await request(app).get('/api/agents').set('Authorization', `Bearer ${TEST_TOKEN}`);
    expect(res.statusCode).toEqual(200);
  });

  it('should return system green metrics (s tokenem)', async () => {
    const res = await request(app).get('/api/system/green-metrics').set('X-API-Token', TEST_TOKEN);
    expect(res.statusCode).toEqual(200);
    expect(res.body.hardware).toBeDefined();
    expect(res.body.totalEnergyWh).toBeDefined();
  });

  it('should export all system data for portability (s tokenem)', async () => {
    const res = await request(app).get('/api/system/export').set('X-API-Token', TEST_TOKEN);
    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.metadata).toBeDefined();
    expect(res.body.database).toBeDefined();
    expect(res.body.inbox).toBeDefined();
  });
});
