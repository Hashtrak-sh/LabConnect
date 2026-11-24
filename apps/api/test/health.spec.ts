import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractRequest, undocumentedRequest } from './support/contract/index.js';
import { createTestApp } from './support/test-app.js';

describe('GET /v1/health', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ok under the /v1 prefix', async () => {
    const response = await contractRequest(app).get('/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('accepts and still answers with a caller-supplied X-Request-Id', async () => {
    const response = await contractRequest(app).get('/v1/health', {
      headers: { 'X-Request-Id': 'req-health-0001' },
    });
    expect(response.status).toBe(200);
  });

  it('does not serve routes outside the /v1 prefix', async () => {
    const response = await undocumentedRequest(app).get('/health');
    expect(response.status).toBe(404);
  });
});
