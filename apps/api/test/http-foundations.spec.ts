// Request ids and the problem-shape exception filter, over HTTP (P3-01). The real app has no
// route that fails on demand, so a testing module adds a throwaway controller. The real app's
// routes stay exactly those of the contract.
import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { DomainError } from '../src/common/domain-error.js';
import { getRequestContext } from '../src/common/request-context.js';
import { expectProblemResponse, undocumentedRequest } from './support/contract/index.js';
import { createTestApp } from './support/test-app.js';

const SECRET = 'db password is hunter2 at /srv/app/secret.ts';

@Controller('probe')
class ProbeController {
  @Get('context')
  context(): { requestId?: string; userAgent?: string } {
    const context = getRequestContext();
    return { requestId: context?.requestId, userAgent: context?.userAgent };
  }

  @Get('domain')
  domain(): never {
    throw new DomainError('INVALID_STATE_TRANSITION', {
      detail: 'Booking cannot be accepted from state PAID.',
      meta: { currentState: 'PAID' },
      errors: [{ path: 'lines[2].scopeLineId', code: 'SCOPE_LINE_NOT_BOOKABLE', message: 'No.' }],
    });
  }

  @Get('domain-5xx')
  domain5xx(): never {
    throw new DomainError('GATEWAY_UNAVAILABLE', { detail: SECRET });
  }

  @Get('http')
  http(): never {
    throw new HttpException('Teapot', 418);
  }

  @Get('unknown')
  unknown(): never {
    throw new Error(SECRET);
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('request ids and problem responses', () => {
  let app: INestApplication<Server>;
  let probe: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    probe = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(probe);
    await probe.init();
  });

  afterAll(async () => {
    await probe.close();
    await app.close();
  });

  describe('X-Request-Id', () => {
    it('echoes a valid caller id', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/context', {
        headers: { 'X-Request-Id': 'req-abc_1.2:3~x' },
      });
      expect(response.headers['x-request-id']).toBe('req-abc_1.2:3~x');
      expect(response.body).toMatchObject({ requestId: 'req-abc_1.2:3~x' });
    });

    it.each([
      ['an id with spaces', 'has space'],
      ['an id with a comma', 'a,b'],
      ['an id with non-token characters', 'id<script>'],
      ['an id over 128 characters', 'a'.repeat(129)],
    ])('replaces %s', async (_name, value) => {
      const response = await undocumentedRequest(probe).get('/v1/probe/context', {
        headers: { 'X-Request-Id': value },
      });
      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).not.toBe(value);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('accepts an id of exactly 128 characters', async () => {
      const value = 'a'.repeat(128);
      const response = await undocumentedRequest(probe).get('/v1/probe/context', {
        headers: { 'X-Request-Id': value },
      });
      expect(response.headers['x-request-id']).toBe(value);
    });

    it('makes the request context available to the handler', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/context', {
        headers: { 'User-Agent': 'probe-agent/1' },
      });
      expect(response.body).toEqual({
        requestId: response.headers['x-request-id'],
        userAgent: 'probe-agent/1',
      });
    });

    it('is on a 404 with the same id in the body', async () => {
      const response = await undocumentedRequest(app).get('/v1/no-such-route', {
        headers: { 'X-Request-Id': 'req-404' },
      });
      expect(response.status).toBe(404);
      expect(response.headers['x-request-id']).toBe('req-404');
      expect(response.body).toMatchObject({ requestId: 'req-404', code: 'NOT_FOUND' });
    });

    it('is on a 500 with the same id in the body', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/unknown', {
        headers: { 'X-Request-Id': 'req-500' },
      });
      expect(response.status).toBe(500);
      expect(response.headers['x-request-id']).toBe('req-500');
      expect(response.body).toMatchObject({ requestId: 'req-500' });
    });
  });

  describe('problem shape', () => {
    it('maps a DomainError to its catalogue status, code, meta and errors', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/domain');
      expectProblemResponse(response);
      expect(response.status).toBe(409);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(response.body).toEqual({
        type: 'https://labconnect/errors/invalid-state-transition',
        title: 'Invalid state transition',
        status: 409,
        code: 'INVALID_STATE_TRANSITION',
        detail: 'Booking cannot be accepted from state PAID.',
        requestId: response.headers['x-request-id'],
        errors: [{ path: 'lines[2].scopeLineId', code: 'SCOPE_LINE_NOT_BOOKABLE', message: 'No.' }],
        meta: { currentState: 'PAID' },
      });
    });

    it('does not show the detail of a 5xx DomainError', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/domain-5xx');
      expectProblemResponse(response);
      expect(response.status).toBe(503);
      expect(response.body).not.toHaveProperty('detail');
      expect(response.text).not.toContain('hunter2');
    });

    it('gives an unknown error 500 INTERNAL_ERROR without leaking its message or stack', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/unknown');
      expectProblemResponse(response);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
      expect(response.text).not.toContain('hunter2');
      expect(response.text).not.toContain('secret.ts');
      expect(response.text).not.toContain('at ');
    });

    it('maps an HttpException of the framework to the problem shape', async () => {
      const response = await undocumentedRequest(probe).get('/v1/probe/http');
      expectProblemResponse(response);
      expect(response.status).toBe(418);
    });

    it('answers an unknown route with the 404 problem', async () => {
      const response = await undocumentedRequest(app).get('/v1/no-such-route');
      expectProblemResponse(response);
      expect(response.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(response.text).not.toContain('Cannot GET');
    });

    it('answers a route outside /v1 with the 404 problem', async () => {
      const response = await undocumentedRequest(app).get('/health');
      expectProblemResponse(response);
      expect(response.status).toBe(404);
    });

    it('answers malformed JSON with the documented 400 problem', async () => {
      const response = await undocumentedRequest(probe).post('/v1/probe/echo', {
        headers: { 'Content-Type': 'application/json' },
        body: '{"broken":',
      });
      expectProblemResponse(response);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        status: 400,
        requestId: response.headers['x-request-id'],
      });
      expect(response.text).not.toContain('Unexpected');
    });

    it('answers an oversized body with a 413 problem', async () => {
      const response = await undocumentedRequest(probe).post('/v1/probe/echo', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blob: 'x'.repeat(200_000) }),
      });
      expectProblemResponse(response);
      expect(response.status).toBe(413);
    });
  });
});
