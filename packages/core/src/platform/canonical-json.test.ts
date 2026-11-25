import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts keys at every depth and writes no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('gives the same bytes whatever the key order', () => {
    expect(canonicalJson({ x: 1, y: 2, z: { m: 1, n: 2 } })).toBe(
      canonicalJson({ z: { n: 2, m: 1 }, y: 2, x: 1 }),
    );
  });

  it('writes a bigint as its digits, beyond the safe integer range too', () => {
    expect(canonicalJson({ amount: 9_007_199_254_740_993n })).toBe('{"amount":9007199254740993}');
    expect(canonicalJson(-5n)).toBe('-5');
  });

  it('writes a Date as an ISO string in UTC with milliseconds', () => {
    expect(canonicalJson(new Date('2026-11-25T10:00:00Z'))).toBe('"2026-11-25T10:00:00.000Z"');
  });

  it('writes -0 as 0 and rejects NaN and Infinity', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('keeps null, drops undefined members and nulls undefined array items', () => {
    expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
  });

  it('escapes strings as JSON does', () => {
    expect(canonicalJson('a"b\né')).toBe('"a\\"b\\né"');
  });

  it('refuses values that are not plain JSON', () => {
    expect(() => canonicalJson(new Map())).toThrow();
    expect(() => canonicalJson(Buffer.from('x'))).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(Symbol('s'))).toThrow();
    expect(() => canonicalJson(new Date('nope'))).toThrow();
  });

  it('refuses a circular structure but allows the same object twice', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(/circular/);
    const shared = { v: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"v":1},{"v":1}]');
  });

  it('accepts objects with a null prototype', () => {
    const bare = Object.assign(Object.create(null) as object, { k: 1 });
    expect(canonicalJson(bare)).toBe('{"k":1}');
  });
});
