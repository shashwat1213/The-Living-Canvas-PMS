import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { app, authHeader, loginAsNewOwner } from './helpers.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('unmatched routes', () => {
  it('returns a JSON 404 rather than Express\'s default HTML page', async () => {
    const res = await request(createApp()).post('/helth');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('not_found');
    expect(typeof res.body.error.message).toBe('string');
  });

  // Under /api/v1 the routers' own `authenticate` middleware answers an
  // anonymous request with 401 before the catch-all is reached, so proving
  // the 404 for a typo'd API path requires a real caller.
  it('returns a JSON 404 for an authenticated request to an unknown API path', async () => {
    const { token } = await loginAsNewOwner('Unmatched Route Hotel');
    const res = await request(app).get('/api/v1/does-not-exist').set(...authHeader(token));

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('not_found');
  });
});
