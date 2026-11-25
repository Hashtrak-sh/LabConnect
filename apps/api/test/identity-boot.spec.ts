import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractRequest } from './support/contract/index.js';
import { createTestApp } from './support/test-app.js';

// The identity module loads without a database and without keys (they are read on first use),
// and what needs no database still works. Nothing here needs Docker.

describe('identity module without a database or keys', () => {
  let app: INestApplication<Server>;
  const saved = { ...process.env };

  beforeAll(async () => {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('AUTH_') || name === 'API_DATABASE_URL' || name === 'SMTP_HOST') {
        Reflect.deleteProperty(process.env, name);
      }
    }
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  it('refuses a request without a token before touching anything', async () => {
    const response = await contractRequest(app).get('/v1/me', {
      headers: { 'X-Request-Id': 'req-boot-1' },
    });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', requestId: 'req-boot-1' });
  });

  it('answers a token it cannot check, for lack of a signing key, with a bare 500', async () => {
    const response = await contractRequest(app).get('/v1/me', {
      headers: { Authorization: 'Bearer abc.def.ghi' },
    });
    // No signing key is configured: a server fault, reported without naming the setting.
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('AUTH_JWT_PRIVATE_KEY');
  });

  it('answers a missing configuration with a bare 500, never with the setting or a stack', async () => {
    const response = await contractRequest(app).post('/v1/auth/otp/request', {
      headers: { 'Idempotency-Key': 'key-boot-1' },
      body: { email: 'someone@example.test', purpose: 'LOGIN' },
    });
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/API_DATABASE_URL|AUTH_|stack|at \w+/);
    expect(response.body).not.toHaveProperty('detail');
  });

  it('validates bodies before it needs any configuration', async () => {
    const response = await contractRequest(app).post('/v1/auth/otp/verify', {
      headers: { 'Idempotency-Key': 'key-boot-2' },
      body: { email: 'bad', code: '1' },
      invalidRequest: 'an invalid body on purpose',
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('checks the Origin of a refresh before it reads the cookie', async () => {
    const response = await contractRequest(app).post('/v1/auth/refresh', {
      headers: {
        'Idempotency-Key': 'key-boot-3',
        Cookie: 'lc_refresh=abc',
        Origin: 'https://evil.test',
      },
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
  });
});
