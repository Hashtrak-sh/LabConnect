import { describe, expect, it } from 'vitest';
import { formIdempotencyKey, idempotencyKeyAfter } from './idempotency';

const KEY = '0198f3a2-1b2c-7d3e-8f40-123456789abc';

describe('Idempotency-Key of the web forms', () => {
  it('uses the key the form sent, and makes a new one for a missing or malformed key', () => {
    const form = new FormData();
    form.set('idempotencyKey', KEY);
    expect(formIdempotencyKey(form)).toBe(KEY);
    const bad = new FormData();
    bad.set('idempotencyKey', 'fixed-key');
    expect(formIdempotencyKey(bad)).not.toBe('fixed-key');
    expect(formIdempotencyKey(new FormData())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the key after 409 and 5xx (the work may be done), and changes it after a stored answer', () => {
    for (const status of [409, 500, 502, 503, 504])
      expect(idempotencyKeyAfter(status, KEY)).toBe(KEY);
    for (const status of [400, 401, 403, 404, 422])
      expect(idempotencyKeyAfter(status, KEY)).not.toBe(KEY);
  });
});
