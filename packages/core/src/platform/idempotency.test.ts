import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';
import {
  canonicalQuery,
  hashRequest,
  IDEMPOTENCY_HEARTBEAT_INTERVAL_MS,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_MAX_LEASE_MS,
  REQUEST_HASH_VERSION,
  type RequestParts,
} from './idempotency.js';

const ORG_A = '0192f0aa-0000-7000-8000-00000000000a';
const ORG_B = '0192f0aa-0000-7000-8000-00000000000b';
const MEMBERSHIP_A = '0192f0aa-0000-7000-8000-0000000000a1';
const MEMBERSHIP_B = '0192f0aa-0000-7000-8000-0000000000b1';

const base: RequestParts = {
  body: { name: 'x', n: 1 },
  organisationId: ORG_A,
  membershipId: MEMBERSHIP_A,
  query: 'a=1&b=2',
};
const hex = (parts: RequestParts) => hashRequest(parts).toString('hex');

describe('hashRequest', () => {
  it('differs when the organisation differs and everything else is the same', () => {
    expect(hex({ ...base, organisationId: ORG_B })).not.toBe(hex(base));
    expect(hex({ ...base, organisationId: null })).not.toBe(hex(base));
  });

  it('differs when the membership differs and everything else is the same', () => {
    expect(hex({ ...base, membershipId: MEMBERSHIP_B })).not.toBe(hex(base));
    expect(hex({ ...base, membershipId: null })).not.toBe(hex(base));
  });

  it('differs when the query differs and everything else is the same', () => {
    expect(hex({ ...base, query: 'a=1&b=3' })).not.toBe(hex(base));
    expect(hex({ ...base, query: 'a=1' })).not.toBe(hex(base));
    expect(hex({ ...base, query: '' })).not.toBe(hex(base));
  });

  it('differs when the body differs', () => {
    expect(hex({ ...base, body: { name: 'y', n: 1 } })).not.toBe(hex(base));
  });

  it('is the same for body keys in another order and query keys in another order', () => {
    expect(hex({ ...base, body: { n: 1, name: 'x' } })).toBe(hex(base));
    expect(hex({ ...base, query: 'b=2&a=1' })).toBe(hex(base));
    expect(hex({ ...base, query: '?b=2&a=1' })).toBe(hex(base));
  });

  it('keeps repeated query parameters in order', () => {
    expect(hex({ ...base, query: 'a=1&a=2' })).not.toBe(hex({ ...base, query: 'a=2&a=1' }));
    expect(hex({ ...base, query: 'a=1&b=9&a=2' })).toBe(hex({ ...base, query: 'b=9&a=1&a=2' }));
  });

  it('treats a missing body and {} as the same request', () => {
    expect(hex({ ...base, body: undefined })).toBe(hex({ ...base, body: {} }));
  });

  it('puts the version tag inside the hashed object', () => {
    const expected = createHash('sha256')
      .update(
        canonicalJson({
          v: REQUEST_HASH_VERSION,
          body: base.body,
          organisationId: ORG_A,
          membershipId: MEMBERSHIP_A,
          query: [
            ['a', '1'],
            ['b', '2'],
          ],
        }),
      )
      .digest('hex');
    expect(hex(base)).toBe(expected);
    const otherVersion = createHash('sha256')
      .update(
        canonicalJson({
          v: REQUEST_HASH_VERSION + 1,
          body: base.body,
          organisationId: ORG_A,
          membershipId: MEMBERSHIP_A,
          query: [
            ['a', '1'],
            ['b', '2'],
          ],
        }),
      )
      .digest('hex');
    expect(hex(base)).not.toBe(otherVersion);
  });

  it('is not the hash of the body alone', () => {
    const bodyOnly = createHash('sha256').update(canonicalJson(base.body)).digest('hex');
    expect(hex(base)).not.toBe(bodyOnly);
  });
});

describe('lease constants', () => {
  it('renews well inside the lock timeout, and caps the lease at 10 minutes', () => {
    expect(IDEMPOTENCY_HEARTBEAT_INTERVAL_MS).toBeLessThan(IDEMPOTENCY_LOCK_TIMEOUT_MS / 2);
    expect(IDEMPOTENCY_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    expect(IDEMPOTENCY_MAX_LEASE_MS).toBe(10 * 60_000);
    expect(IDEMPOTENCY_MAX_LEASE_MS).toBeGreaterThan(IDEMPOTENCY_LOCK_TIMEOUT_MS);
  });
});

describe('canonicalQuery', () => {
  it('decodes, sorts by name and keeps repeats in order', () => {
    expect(canonicalQuery('?z=1&a=%41&a=b&m')).toEqual([
      ['a', 'A'],
      ['a', 'b'],
      ['m', ''],
      ['z', '1'],
    ]);
    expect(canonicalQuery('')).toEqual([]);
  });
});
