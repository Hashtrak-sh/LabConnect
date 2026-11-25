import { describe, expect, it } from 'vitest';
import { SearchQueryError } from './errors.js';
import { expandTerms, normaliseSearchQuery } from './query.js';

const at = new Date('2026-11-25T10:00:00Z');
const bad = (request: Parameters<typeof normaliseSearchQuery>[0]) => () =>
  normaliseSearchQuery(request, at);

describe('normaliseSearchQuery', () => {
  it('turns an empty request into the first page of everything, sorted by relevance', () => {
    expect(normaliseSearchQuery({}, at)).toEqual({
      text: null,
      terms: [],
      location: null,
      radiusKm: null,
      disciplineCode: null,
      parameterCode: null,
      methodCode: null,
      tatMax: null,
      priceMaxPaise: null,
      category: null,
      sort: 'relevance',
      limit: 25,
      cursor: null,
      asOf: at,
    });
  });

  it('cleans the text and keeps the lower-cased form for matching', () => {
    const query = normaliseSearchQuery({ q: '  Tensile \t  Strength ' }, at);
    expect(query.text).toBe('Tensile Strength');
    expect(query.terms).toEqual(['tensile strength']);
    // compatibility forms are folded (full-width letters)
    expect(normaliseSearchQuery({ q: 'ＩＳ １７８６' }, at).text).toBe('IS 1786');
  });

  it('sorts by distance when there is a location, and accepts every documented radius', () => {
    const query = normaliseSearchQuery({ lat: 28.6, lng: 77.2, radiusKm: 25 }, at);
    expect(query.sort).toBe('distance');
    expect(query.radiusKm).toBe(25);
    for (const radiusKm of [5, 10, 25, 50, 100]) {
      expect(normaliseSearchQuery({ lat: 1, lng: 1, radiusKm }, at).radiusKm).toBe(radiusKm);
    }
  });

  it('converts money to bigint paise and keeps the filters', () => {
    const query = normaliseSearchQuery(
      {
        priceMax: 250_000,
        tatMax: 7,
        category: 'CALIBRATION',
        discipline: ' MECH ',
        parameter: 'P',
        method: 'M',
      },
      at,
    );
    expect(query).toMatchObject({
      priceMaxPaise: 250_000n,
      tatMax: 7,
      category: 'CALIBRATION',
      disciplineCode: 'MECH',
      parameterCode: 'P',
      methodCode: 'M',
    });
    expect(normaliseSearchQuery({ priceMax: 9_007_199_254_740_993n }, at).priceMaxPaise).toBe(
      9_007_199_254_740_993n,
    );
  });

  it.each([
    ['lat without lng', { lat: 1 }],
    ['lng without lat', { lng: 1 }],
    ['latitude out of range', { lat: 91, lng: 0 }],
    ['longitude out of range', { lat: 0, lng: -181 }],
    ['a radius without a location', { radiusKm: 10 }],
    ['an unknown radius', { lat: 1, lng: 1, radiusKm: 7 }],
    ['empty text', { q: '   ' }],
    ['text over 200 characters', { q: 'x'.repeat(201) }],
    ['control characters', { q: 'a\u0000b' }],
    ['tatMax of zero', { tatMax: 0 }],
    ['a fractional tatMax', { tatMax: 1.5 }],
    ['a negative price', { priceMax: -1 }],
    ['a fractional price', { priceMax: 1.5 }],
    ['the medical category', { category: 'MEDICAL' }],
    ['sorting by distance without a location', { sort: 'distance' as const }],
    ['a limit of zero', { limit: 0 }],
    ['a limit over 100', { limit: 101 }],
    ['an empty cursor', { cursor: '' }],
    ['an empty code', { discipline: ' ' }],
  ])('refuses %s with VALIDATION_FAILED', (_name, request) => {
    expect(bad(request)).toThrow(SearchQueryError);
    try {
      bad(request)();
    } catch (error) {
      expect((error as SearchQueryError).code).toBe('VALIDATION_FAILED');
      expect((error as SearchQueryError).status).toBe(422);
    }
  });

  it('does not put the text in the error (the text is search input, never logged)', () => {
    try {
      bad({ q: `secret-token ${'x'.repeat(300)}` })();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-token');
    }
  });
});

describe('expandTerms', () => {
  const synonyms = new Map<string, string[]>([
    ['ts', ['tensile strength']],
    ['is 1786', ['TMT bars', 'rebar']],
  ]);

  it('returns the text alone without synonyms', () => {
    expect(expandTerms('Tensile Strength', new Map())).toEqual(['tensile strength']);
  });

  it('adds the expansion of a word or a phrase, the original first', () => {
    expect(expandTerms('TS', synonyms)).toEqual(['ts', 'tensile strength']);
    expect(expandTerms('IS 1786', synonyms)).toEqual(['is 1786', 'tmt bars', 'rebar']);
    expect(expandTerms('ts of steel', synonyms)).toEqual([
      'ts of steel',
      'tensile strength of steel',
    ]);
  });

  it('leaves text with no synonym alone and never repeats a term', () => {
    expect(expandTerms('hardness', synonyms)).toEqual(['hardness']);
    expect(expandTerms('ts', new Map([['ts', ['ts', 'tensile strength']]]))).toEqual([
      'ts',
      'tensile strength',
    ]);
  });

  it('stops at eight terms', () => {
    const many = new Map([['a', Array.from({ length: 20 }, (_, i) => `expansion ${String(i)}`)]]);
    expect(expandTerms('a', many)).toHaveLength(8);
  });
});
