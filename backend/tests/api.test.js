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
});
