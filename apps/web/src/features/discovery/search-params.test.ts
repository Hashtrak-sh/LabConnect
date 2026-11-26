import { describe, expect, it } from 'vitest';
import {
  hasCriteria,
  leadCriteria,
  pageHref,
  parsePoint,
  readSearchForm,
  toSearchLabsParams,
} from './search-params';

describe('search page parameters', () => {
  it('maps the form to the API query, prices from rupees to paise', () => {
    const form = readSearchForm({
      q: ' tensile ',
      discipline: 'MECH',
      category: 'TESTING',
      tat: '7',
      maxPrice: '1,250.50',
    });
    expect(toSearchLabsParams(form, null, '', 20)).toEqual({
      q: 'tensile',
      discipline: 'MECH',
      category: 'TESTING',
      tatMax: 7,
      priceMax: 125_050,
      limit: 20,
    });
  });

  it('sends a radius only together with a location', () => {
    const form = readSearchForm({ radius: '25' });
    expect(toSearchLabsParams(form, null, '', 20)).toEqual({ limit: 20 });
    expect(toSearchLabsParams(form, parsePoint(28.6123456, 77.2), '', 20)).toEqual({
      lat: 28.612,
      lng: 77.2,
      radiusKm: 25,
      limit: 20,
    });
  });

  it('never puts a location into the URL, even when one is typed into it', () => {
    const form = readSearchForm({ q: 'cement', lat: '28.6', lng: '77.2' });
    expect(form).not.toHaveProperty('lat');
    expect(pageHref(form, 'pg1.abc')).toBe('/search?q=cement&cursor=pg1.abc');
  });

  it('accepts only real points, rounded to about 100 m', () => {
    expect(parsePoint('28.61234', '77.20987')).toEqual({ lat: 28.612, lng: 77.21 });
    expect(parsePoint('91', '0')).toBeNull();
    expect(parsePoint('x', '77')).toBeNull();
    expect(parsePoint('', '')).toBeNull();
  });

  it('drops values the API would refuse instead of failing the page', () => {
    const form = readSearchForm({
      tat: 'soon',
      maxPrice: 'cheap',
      category: 'MEDICAL',
      radius: '7',
      discipline: 'X'.repeat(101),
    });
    expect(toSearchLabsParams(form, null, '', 20)).toEqual({ limit: 20 });
  });

  it('knows an empty search; a saved location alone is a search', () => {
    expect(hasCriteria(readSearchForm({}), null)).toBe(false);
    expect(hasCriteria(readSearchForm({}), { lat: 28.6, lng: 77.2 })).toBe(true);
    expect(hasCriteria(readSearchForm({ q: 'cement' }), null)).toBe(true);
  });

  it('offers a no-result lead only when the search says what was wanted', () => {
    expect(leadCriteria({ q: 'cement', lat: 28.6, lng: 77.2, radiusKm: 25, limit: 20 })).toEqual({
      q: 'cement',
      radiusKm: 25,
    });
    expect(leadCriteria({ radiusKm: 25, lat: 28.6, lng: 77.2, limit: 20 })).toBeNull();
  });
});
