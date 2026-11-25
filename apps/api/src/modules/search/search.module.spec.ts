import 'reflect-metadata';
import { FixedClock, LazySearchService, SearchQueryError } from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CLOCK } from '../platform/platform.providers.js';
import { SearchModule } from './search.module.js';

describe('SearchModule', () => {
  it('boots with no database and no OpenSearch, and has no controller', async () => {
    const previous = { ...process.env };
    delete process.env.OPENSEARCH_URL;
    delete process.env.API_DATABASE_URL;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [SearchModule] }).compile();
      const service = moduleRef.get(LazySearchService);
      expect(service).toBeInstanceOf(LazySearchService);
      expect(service.circuit()).toBe('closed');
      expect(Reflect.getMetadata('controllers', SearchModule) as unknown).toBeUndefined();
      await moduleRef.close();
    } finally {
      process.env = previous;
    }
  });

  it('refuses a bad request before it touches a database or a cluster', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SearchModule] })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock('2026-11-25T10:00:00Z'))
      .compile();
    const service = moduleRef.get(LazySearchService);
    await expect(service.search({ lat: 12 })).rejects.toBeInstanceOf(SearchQueryError);
    await moduleRef.close();
  });

  it('reports a bad OPENSEARCH_* setting at the first search, not at start', async () => {
    const previous = process.env.OPENSEARCH_AUTH_MODE;
    process.env.OPENSEARCH_URL = 'http://localhost:9200';
    process.env.OPENSEARCH_AUTH_MODE = 'aws';
    try {
      const moduleRef = await Test.createTestingModule({ imports: [SearchModule] }).compile();
      await expect(moduleRef.get(LazySearchService).search({})).rejects.toThrow(/not supported/);
      await moduleRef.close();
    } finally {
      delete process.env.OPENSEARCH_URL;
      if (previous === undefined) delete process.env.OPENSEARCH_AUTH_MODE;
      else process.env.OPENSEARCH_AUTH_MODE = previous;
    }
  });
});
