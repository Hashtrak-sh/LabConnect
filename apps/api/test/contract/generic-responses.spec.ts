// What the app does for every route, held to the conventions the contract documents
// (API_CONVENTIONS.md §4, ERROR_HANDLING.md §1).
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contractRequest,
  expectProblemResponse,
  undocumentedRequest,
} from '../support/contract/index.js';
import { createTestApp } from '../support/test-app.js';

describe('responses for every route', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown route under /v1 with 404', async () => {
    const response = await undocumentedRequest(app).get('/v1/no-such-route');
    expect(response.status).toBe(404);
  });

  it('answers an unknown route with the shared problem shape', async () => {
    const response = await undocumentedRequest(app).get('/v1/no-such-route');
    expectProblemResponse(response);
  });

  it('echoes the caller X-Request-Id', async () => {
    const response = await contractRequest(app).get('/v1/health', {
      headers: { 'X-Request-Id': 'req-generic-0001' },
    });
    expect(response.headers['x-request-id']).toBe('req-generic-0001');
  });

  it('generates an X-Request-Id when the caller sends none', async () => {
    const response = await contractRequest(app).get('/v1/health');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });
});
