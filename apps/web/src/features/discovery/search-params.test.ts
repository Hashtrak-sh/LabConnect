import { describe, expect, it } from 'vitest';
import { hasCriteria, pageHref, readSearchForm, toSearchLabsParams } from './search-params';

describe('search page parameters', () => {
  it('maps the form to the API query, prices from rupees to paise', () => {
    const form = readSearchForm({
      q: ' tensile ',
      discipline: 'MECH',
      category: 'TESTING',
      tat: '7',
      maxPrice: '1,250.50',
    });
    expect(toSearchLabsParams(form, '', 20)).toEqual({
      q: 'tensile',
      discipline: 'MECH',
      category: 'TESTING',
      tatMax: 7,
      priceMax: 125_050,
      limit: 20,
    });
  });

  it('sends a radius only together with a location', () => {
    expect(toSearchLabsParams(readSearchForm({ radius: '25' }), '', 20)).toEqual({ limit: 20 });
    expect(
      toSearchLabsParams(readSearchForm({ radius: '25', lat: '28.6123456', lng: '77.2' }), '', 20),
    ).toEqual({ lat: 28.61235, lng: 77.2, radiusKm: 25, limit: 20 });
  });

  it('drops values the API would refuse instead of failing the page', () => {
    const form = readSearchForm({
      tat: 'soon',
      maxPrice: 'cheap',
      category: 'MEDICAL',
      radius: '7',
      lat: 'x',
    });
    expect(toSearchLabsParams(form, '', 20)).toEqual({ limit: 20 });
  });

  it('knows an empty form and builds the next-page link', () => {
    expect(hasCriteria(readSearchForm({}))).toBe(false);
    const form = readSearchForm({ q: 'cement' });
    expect(hasCriteria(form)).toBe(true);
    expect(pageHref(form, 'pg1.abc')).toBe('/search?q=cement&cursor=pg1.abc');
  });
});
