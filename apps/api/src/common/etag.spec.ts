import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error.js';
import { assertIfMatch, formatEtag, parseIfMatch } from './etag.js';

describe('formatEtag', () => {
  it('quotes the lock version', () => {
    expect(formatEtag(0)).toBe('"0"');
    expect(formatEtag(42)).toBe('"42"');
  });

  it('refuses a value that is not a lock version', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatEtag(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('parseIfMatch', () => {
  it('reads one strong ETag of the contract form', () => {
    expect(parseIfMatch('"0"')).toBe(0);
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch(' "12" ')).toBe(12);
  });

  it('answers 400 for a missing, malformed, weak, wildcard or repeated header', () => {
    for (const bad of [
      undefined,
      '',
      '*',
      '3',
      '"3',
      '"-1"',
      '"01"',
      '"3.5"',
      '"abc"',
      'W/"3"',
      '"1", "2"',
      '"99999999999"',
      ['"1"', '"2"'],
    ]) {
      expect(() => parseIfMatch(bad), String(bad)).toThrow(BadRequestException);
    }
  });

  it('round-trips with formatEtag', () => {
    expect(parseIfMatch(formatEtag(9))).toBe(9);
  });
});

describe('assertIfMatch', () => {
  it('passes when the versions are equal', () => {
    expect(() => {
      assertIfMatch(3, 3);
    }).not.toThrow();
  });

  it('answers 412 CONCURRENT_MODIFICATION when they differ, in either direction', () => {
    for (const [asked, current] of [
      [2, 3],
      [4, 3],
    ] as const) {
      try {
        assertIfMatch(asked, current);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        expect(error).toMatchObject({ code: 'CONCURRENT_MODIFICATION', status: 412 });
      }
    }
  });
});
