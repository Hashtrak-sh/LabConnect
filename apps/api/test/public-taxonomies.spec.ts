import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CoreError,
  type PublicTaxonomyPage,
  type PublicTaxonomyQuery,
  TaxonomyDirectory,
} from '@labconnect/core';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { contractRequest } from './support/contract/index.js';

// I1-CUS-06: `GET /v1/public/taxonomies/{code}/nodes` over the HTTP stack, every exchange held to
// the contract. The directory is a stub; its SQL is tested in
// packages/core/test/db/masterdata-public-taxonomy.test.ts.

const TOP: PublicTaxonomyPage = {
  nodes: [
    { code: 'CHEM', name: 'Chemical', nodeType: 'DISCIPLINE', parentCode: null },
    { code: 'MECH', name: 'Mechanical', nodeType: 'DISCIPLINE', parentCode: null },
  ],
  nextCursor: 'tx1.next',
};

class StubTaxonomies {
  readonly asked: { code: string; query: PublicTaxonomyQuery }[] = [];
  listPublicNodes(code: string, query: PublicTaxonomyQuery): Promise<PublicTaxonomyPage | null> {
    this.asked.push({ code, query });
    if (query.cursor === 'bad') return Promise.reject(new CoreError('VALIDATION_FAILED'));
    if (code !== 'SCOPE' || (query.parent !== null && query.parent !== 'MECH')) {
      return Promise.resolve(null);
    }
    return Promise.resolve(TOP);
  }
}

describe('GET /v1/public/taxonomies/{code}/nodes', () => {
  let app: INestApplication<Server>;
  const taxonomies = new StubTaxonomies();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TaxonomyDirectory)
      .useValue(taxonomies)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    taxonomies.asked.length = 0;
  });

  it('lists the top level, anonymously', async () => {
    const response = await contractRequest(app).get('/v1/public/taxonomies/SCOPE/nodes');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: TOP.nodes,
      page: { nextCursor: 'tx1.next', limit: 25 },
    });
    expect(taxonomies.asked).toEqual([
      { code: 'SCOPE', query: { parent: null, cursor: null, limit: 25 } },
    ]);
  });

  it('passes parent, cursor and limit through', async () => {
    const response = await contractRequest(app).get(
      '/v1/public/taxonomies/SCOPE/nodes?parent=MECH&cursor=tx1.x&limit=10',
    );
    expect(response.status).toBe(200);
    expect(taxonomies.asked[0]?.query).toEqual({ parent: 'MECH', cursor: 'tx1.x', limit: 10 });
  });

  it('answers an unknown taxonomy or parent with 404', async () => {
    const unknown = await contractRequest(app).get('/v1/public/taxonomies/NOPE/nodes');
    expect(unknown.status).toBe(404);
    const parent = await contractRequest(app).get('/v1/public/taxonomies/SCOPE/nodes?parent=X');
    expect(parent.status).toBe(404);
  });

  it('refuses a malformed code, unknown parameters and a bad cursor with 422', async () => {
    const code = await contractRequest(app).get('/v1/public/taxonomies/scope/nodes', {
      invalidRequest: 'a lower-case taxonomy code must give 422',
    });
    expect(code.status).toBe(422);
    const extra = await contractRequest(app).get('/v1/public/taxonomies/SCOPE/nodes?q=x', {
      invalidRequest: 'q is not a parameter and must give 422',
    });
    expect(extra.status).toBe(422);
    expect(extra.body).toMatchObject({ errors: [{ path: 'q', code: 'UNKNOWN_FIELD' }] });
    const cursor = await contractRequest(app).get('/v1/public/taxonomies/SCOPE/nodes?cursor=bad');
    expect(cursor.status).toBe(422);
  });
});
