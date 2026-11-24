// What the app does for every route today, held to the conventions the contract documents
// (API_CONVENTIONS.md §4, ERROR_HANDLING.md §1). `it.fails` marks a known gap: the test body
// states the contract and is expected to fail until the gap is closed. When it starts passing,
// Vitest reports it as a failure: then turn `it.fails` into `it`.
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

  // GAP (Phase 3): Nest's default 404 is `application/json` `{ message, error, statusCode }`,
  // not the problem shape. Closed by the global exception filter (ERROR_HANDLING.md) that the
  // Phase 3 platform work adds (nearest task: P3-01).
  it.fails('answers an unknown route with the shared problem shape', async () => {
    const response = await undocumentedRequest(app).get('/v1/no-such-route');
    expectProblemResponse(response);
  });

  // GAP (Phase 3): API_CONVENTIONS.md §4 says X-Request-Id is echoed or generated on every
  // response. The app sends none yet. The contract declares the header but not as `required`,
  // so contractRequest() alone does not catch this. Closed by the request-id middleware of the
  // Phase 3 platform work (nearest task: P3-01).
  it.fails('echoes the caller X-Request-Id', async () => {
    const response = await contractRequest(app).get('/v1/health', {
      headers: { 'X-Request-Id': 'req-generic-0001' },
    });
    expect(response.headers['x-request-id']).toBe('req-generic-0001');
  });

  it.fails('generates an X-Request-Id when the caller sends none', async () => {
    const response = await contractRequest(app).get('/v1/health');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });
});
