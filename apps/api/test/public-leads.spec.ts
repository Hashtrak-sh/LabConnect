import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CoreError, type LeadInput, LeadService } from '@labconnect/core';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { contractRequest } from './support/contract/index.js';

// I1-CUS-07: `POST /v1/public/leads` over the HTTP stack, every exchange held to the contract.
// The service is a stub; its insert is tested in packages/core/test/db/customers-leads.test.ts.

const LISTED = '0190d6a2-7c4e-7a1b-9c3d-0123456789ab';
const NOT_LISTED = '0190d6a2-7c4e-7a1b-9c3d-0123456789ff';
const KEY = { 'Idempotency-Key': '0190d6a2-7c4e-7a1b-9c3d-00000000aaaa' };

class StubLeads {
  readonly created: LeadInput[] = [];
  createLead(input: LeadInput): Promise<void> {
    if (input.kind === 'REQUEST_LAB' && input.labSiteId === NOT_LISTED) {
      return Promise.reject(new CoreError('VALIDATION_FAILED'));
    }
    this.created.push(input);
    return Promise.resolve();
  }
}

describe('POST /v1/public/leads', () => {
  let app: INestApplication<Server>;
  const leads = new StubLeads();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LeadService)
      .useValue(leads)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    leads.created.length = 0;
  });

  it('records a "request this lab" lead anonymously and returns nothing', async () => {
    const response = await contractRequest(app).post('/v1/public/leads', {
      headers: KEY,
      body: { kind: 'REQUEST_LAB', labSiteId: LISTED, contactEmail: 'me@example.test' },
    });
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(leads.created).toEqual([
      { kind: 'REQUEST_LAB', labSiteId: LISTED, query: null, contactEmail: 'me@example.test' },
    ]);
  });

  it('records a no-result lead with its search criteria', async () => {
    const response = await contractRequest(app).post('/v1/public/leads', {
      headers: KEY,
      body: { kind: 'NO_RESULT', query: { q: '  chromatography ', radiusKm: 25, priceMax: 50000 } },
    });
    expect(response.status).toBe(204);
    expect(leads.created).toEqual([
      {
        kind: 'NO_RESULT',
        query: { q: 'chromatography', radiusKm: 25, priceMax: 50000 },
        contactEmail: null,
      },
    ]);
  });

  it('answers a lab site that is not listed with 422', async () => {
    const response = await contractRequest(app).post('/v1/public/leads', {
      headers: KEY,
      body: { kind: 'REQUEST_LAB', labSiteId: NOT_LISTED },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses a body that breaks the kind rules, a location, or a bad email', async () => {
    const cases: { body: object; path: string }[] = [
      { body: { kind: 'REQUEST_LAB' }, path: 'labSiteId' },
      { body: { kind: 'NO_RESULT' }, path: 'query' },
      { body: { kind: 'NO_RESULT', query: {}, labSiteId: LISTED }, path: 'labSiteId' },
      { body: { kind: 'NO_RESULT', query: { lat: 28.6, lng: 77.2 } }, path: 'query.lat' },
      {
        body: { kind: 'NO_RESULT', query: {}, contactEmail: 'not-an-email' },
        path: 'contactEmail',
      },
      { body: { kind: 'SOMETHING' }, path: 'kind' },
    ];
    for (const { body, path } of cases) {
      const response = await contractRequest(app).post('/v1/public/leads', {
        headers: KEY,
        body,
        invalidRequest: `${path} breaks LeadCreate and must give 422`,
      });
      expect(response.status, path).toBe(422);
      const paths = (response.body as { errors: { path: string }[] }).errors.map((e) => e.path);
      expect(paths, path).toContain(path);
    }
    expect(leads.created).toEqual([]);
  });
});
