import { describe, expect, it } from 'vitest';

import { CURRENCY, gstForLine, paiseFromJson, paiseToJson, sumPaise } from '../src/money.js';

describe('gstForLine', () => {
  it('is taxable × rate_bp / 10000, rounded half up', () => {
    expect(gstForLine(100_000n, 1800)).toBe(18_000n); // ₹1000 at 18%
    expect(gstForLine(25n, 2000)).toBe(5n); // exact
    expect(gstForLine(3n, 1800)).toBe(1n); // 0.54 → 1
    expect(gstForLine(1n, 1800)).toBe(0n); // 0.18 → 0
    expect(gstForLine(25n, 200)).toBe(1n); // 0.5 → 1 (half up)
    expect(gstForLine(75n, 200)).toBe(2n); // 1.5 → 2 (half up, not half even)
    expect(gstForLine(1249n, 1200)).toBe(150n); // 149.88 → 150
    expect(gstForLine(0n, 1800)).toBe(0n);
    expect(gstForLine(12_345n, 0)).toBe(0n);
  });

  it('stays exact beyond the range of a double', () => {
    const taxable = 2n ** 60n + 1n;
    expect(gstForLine(taxable, 10_000)).toBe(taxable);
  });

  it('refuses a negative amount or a rate that is not whole basis points', () => {
    expect(() => gstForLine(-1n, 1800)).toThrow(RangeError);
    expect(() => gstForLine(100n, -1)).toThrow(RangeError);
    expect(() => gstForLine(100n, 18.5)).toThrow(RangeError);
    expect(() => gstForLine(100n, Number.NaN)).toThrow(RangeError);
  });
});

describe('sumPaise', () => {
  it('adds amounts, and is 0 for none', () => {
    expect(sumPaise([gstForLine(3n, 1800), gstForLine(25n, 200), 7n])).toBe(9n);
    expect(sumPaise([])).toBe(0n);
  });
});

describe('JSON amountPaise', () => {
  it('round-trips safe integers', () => {
    for (const value of [0, 1, -1, 123_456_789, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(paiseToJson(paiseFromJson(value))).toBe(value);
    }
    expect(paiseFromJson(250)).toBe(250n);
  });

  it('refuses fractions, non-finite values and unsafe integers when reading', () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)]) {
      expect(() => paiseFromJson(value), String(value)).toThrow(RangeError);
    }
  });

  it('refuses amounts JSON cannot carry exactly when writing', () => {
    expect(() => paiseToJson(2n ** 53n)).toThrow(RangeError);
    expect(() => paiseToJson(-(2n ** 53n))).toThrow(RangeError);
  });

  it('uses INR', () => {
    expect(CURRENCY).toBe('INR');
  });
});
