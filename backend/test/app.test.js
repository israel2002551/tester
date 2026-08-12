import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const db = { $queryRaw: async () => [{ ok: 1 }] };
const app = createApp({ db });

test('health and readiness use the stable response envelope', async () => {
  const health = await request(app).get('/api/v1/health').expect(200);
  assert.equal(health.body.success, true);
  assert.equal(health.body.data.service, 'buysell-api');
  const ready = await request(app).get('/api/v1/ready').expect(200);
  assert.equal(ready.body.data.database, 'reachable');
});

test('protected route rejects anonymous users without touching domain data', async () => {
  const response = await request(app).get('/api/v1/sourcing').expect(401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
  assert.ok(response.body.requestId);
});

test('unknown routes are consistently reported', async () => {
  const response = await request(app).get('/api/v1/does-not-exist').expect(404);
  assert.equal(response.body.error.code, 'ROUTE_NOT_FOUND');
});

test('catalog compatibility routes are mounted without requiring authentication', async () => {
  const catalogDb = {
    ...db,
    product: { findMany: async () => [], count: async () => 0 },
  };
  const response = await request(createApp({ db: catalogDb })).get('/api/v1/catalog/search?q=phone').expect(200);
  assert.deepEqual(response.body.data, []);
  assert.equal(response.body.meta.total, 0);
});
