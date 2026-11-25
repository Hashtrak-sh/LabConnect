import { describe, expect, it } from 'vitest';
import { OpenSearchConfigError, indexName, readOpenSearchConfig } from './opensearch-config.js';

describe('readOpenSearchConfig', () => {
  it('returns null without OPENSEARCH_URL: search runs on Postgres alone', () => {
    expect(readOpenSearchConfig({})).toBeNull();
    expect(readOpenSearchConfig({ OPENSEARCH_URL: '  ' })).toBeNull();
  });

  it('reads the local setup: no authentication, the alias lab_scope, version 1', () => {
    const config = readOpenSearchConfig({ OPENSEARCH_URL: 'http://localhost:9200' });
    expect(config).toEqual({
      node: 'http://localhost:9200',
      auth: { mode: 'none' },
      alias: 'lab_scope',
      version: 1,
      requestTimeoutMs: 1500,
    });
    expect(config && indexName(config)).toBe('lab_scope_v1');
  });

  it('reads basic authentication, an alias, a version and a timeout', () => {
    const config = readOpenSearchConfig({
      OPENSEARCH_URL: 'https://search.internal:9200',
      OPENSEARCH_AUTH_MODE: 'basic',
      OPENSEARCH_USERNAME: 'u',
      OPENSEARCH_PASSWORD: 'p',
      OPENSEARCH_INDEX_ALIAS: 'lab_scope_test',
      OPENSEARCH_INDEX_VERSION: '3',
      OPENSEARCH_TIMEOUT_MS: '800',
    });
    expect(config?.auth).toEqual({ mode: 'basic', username: 'u', password: 'p' });
    expect(config && indexName(config)).toBe('lab_scope_test_v3');
    expect(config?.requestTimeoutMs).toBe(800);
  });

  it('refuses a bad setting with a clear error, and AWS signing as not supported (OQ-156)', () => {
    const url = { OPENSEARCH_URL: 'http://localhost:9200' };
    const refuses = (extra: Record<string, string>, pattern: RegExp): void => {
      expect(() => readOpenSearchConfig({ ...url, ...extra })).toThrow(OpenSearchConfigError);
      expect(() => readOpenSearchConfig({ ...url, ...extra })).toThrow(pattern);
    };
    refuses({ OPENSEARCH_AUTH_MODE: 'aws' }, /not supported yet/);
    refuses({ OPENSEARCH_AUTH_MODE: 'basic' }, /USERNAME/);
    refuses({ OPENSEARCH_AUTH_MODE: 'kerberos' }, /none, basic or aws/);
    refuses({ OPENSEARCH_INDEX_ALIAS: 'Lab Scope' }, /ALIAS/);
    refuses({ OPENSEARCH_INDEX_VERSION: '0' }, /VERSION/);
    refuses({ OPENSEARCH_TIMEOUT_MS: 'fast' }, /TIMEOUT/);
    expect(() => readOpenSearchConfig({ OPENSEARCH_URL: 'not a url' })).toThrow(/valid URL/);
  });

  it('does not put the password in its errors', () => {
    try {
      readOpenSearchConfig({
        OPENSEARCH_URL: 'http://localhost:9200',
        OPENSEARCH_AUTH_MODE: 'basic',
        OPENSEARCH_USERNAME: 'u',
        OPENSEARCH_PASSWORD: 'hunter2',
        OPENSEARCH_INDEX_VERSION: '0',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});
