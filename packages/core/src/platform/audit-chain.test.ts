import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chainHash, type ChainRow, normaliseMonth } from './audit-chain.js';
import { canonicalJson } from './canonical-json.js';

const row: ChainRow = {
  id: '0193a000-0000-7000-8000-000000000001',
  occurred_at: '2026-11-25T10:00:00.000000Z',
  actor_user_id: null,
  actor_membership_id: null,
  actor_role: null,
  actor_org_id: null,
  action: 'booking.transition',
  entity_type: 'booking',
  entity_id: '0193a000-0000-7000-8000-0000000000b1',
  before: { status: 'REQUESTED' },
  after: { status: 'ACCEPTED' },
  reason: null,
  request_id: null,
  ip_address: null,
  user_agent: null,
};

describe('chainHash', () => {
  it('is SHA-256 of the previous hash followed by the canonical JSON of the row', () => {
    const prev = createHash('sha256').update('previous').digest();
    const expected = createHash('sha256')
      .update(Buffer.concat([prev, Buffer.from(canonicalJson(row), 'utf8')]))
      .digest();
    expect(chainHash(prev, row).equals(expected)).toBe(true);
  });

  it('hashes only the row for the first entry of a chain', () => {
    const expected = createHash('sha256').update(canonicalJson(row), 'utf8').digest();
    expect(chainHash(null, row).equals(expected)).toBe(true);
  });

  it('depends on the previous hash and on every column of the row', () => {
    const prev = Buffer.alloc(32, 1);
    const base = chainHash(prev, row);
    expect(chainHash(Buffer.alloc(32, 2), row).equals(base)).toBe(false);
    expect(chainHash(null, row).equals(base)).toBe(false);
    for (const key of Object.keys(row) as (keyof ChainRow)[]) {
      const changed = { ...row, [key]: key === 'before' || key === 'after' ? { x: 1 } : 'changed' };
      expect(chainHash(prev, changed).equals(base)).toBe(false);
    }
  });

  it('does not depend on the key order of the JSON columns', () => {
    const a = chainHash(null, { ...row, after: { a: 1, b: 2 } });
    const b = chainHash(null, { ...row, after: { b: 2, a: 1 } });
    expect(a.equals(b)).toBe(true);
  });
});

describe('normaliseMonth', () => {
  it('accepts YYYY-MM, YYYY-MM-01 and a Date (UTC)', () => {
    expect(normaliseMonth('2026-11')).toBe('2026-11-01');
    expect(normaliseMonth('2026-11-01')).toBe('2026-11-01');
    expect(normaliseMonth(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11-01');
  });

  it('rejects anything else', () => {
    expect(() => normaliseMonth('2026-11-15')).toThrow(RangeError);
    expect(() => normaliseMonth('November')).toThrow(RangeError);
  });
});
