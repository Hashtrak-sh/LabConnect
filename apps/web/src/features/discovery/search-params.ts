import { rupeesToPaise } from '@/lib/format';

/** The search page's own URL parameters (what the form submits). Prices are typed in rupees. */
export interface SearchForm {
  q: string;
  discipline: string;
  category: string;
  tat: string;
  maxPrice: string;
  radius: string;
  lat: string;
  lng: string;
}

/** The query of `GET /v1/public/search/labs` (`searchLabs`). Money is integer paise. */
export interface SearchLabsParams {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: 5 | 10 | 25 | 50 | 100;
  discipline?: string;
  tatMax?: number;
  priceMax?: number;
  category?: 'TESTING' | 'CALIBRATION';
  cursor?: string;
  limit?: number;
}

export const RADII = [5, 10, 25, 50, 100] as const;

type RawParams = Record<string, string | string[] | undefined>;

function first(raw: RawParams, name: string): string {
  const value = raw[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/** The form values echoed back into the inputs. */
export function readSearchForm(raw: RawParams): SearchForm {
  return {
    q: first(raw, 'q'),
    discipline: first(raw, 'discipline'),
    category: first(raw, 'category'),
    tat: first(raw, 'tat'),
    maxPrice: first(raw, 'maxPrice'),
    radius: first(raw, 'radius'),
    lat: first(raw, 'lat'),
    lng: first(raw, 'lng'),
  };
}

/** Whether the user asked for anything; an empty form shows no results yet. */
export function hasCriteria(form: SearchForm): boolean {
  return Object.values(form).some((value) => value !== '');
}

/**
 * The API query for a form. Values the API would refuse are dropped rather than sent, so a stray
 * character in a box never turns the page into an error: a radius only with a location, a
 * turnaround only as a whole number of days, a price only as rupees.
 */
export function toSearchLabsParams(
  form: SearchForm,
  cursor: string,
  limit: number,
): SearchLabsParams {
  const params: SearchLabsParams = { limit };
  if (form.q !== '') params.q = form.q.slice(0, 200);
  if (form.discipline !== '') params.discipline = form.discipline;
  if (form.category === 'TESTING' || form.category === 'CALIBRATION') {
    params.category = form.category;
  }
  if (/^\d{1,4}$/.test(form.tat) && Number(form.tat) >= 1) params.tatMax = Number(form.tat);
  const paise = form.maxPrice === '' ? null : rupeesToPaise(form.maxPrice);
  if (paise !== null) params.priceMax = paise;

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const located =
    form.lat !== '' &&
    form.lng !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  if (located) {
    params.lat = Math.round(lat * 1e5) / 1e5;
    params.lng = Math.round(lng * 1e5) / 1e5;
    const radius = Number(form.radius);
    if ((RADII as readonly number[]).includes(radius)) {
      params.radiusKm = radius as SearchLabsParams['radiusKm'];
    }
  }
  if (cursor !== '') params.cursor = cursor;
  return params;
}

/** The page URL for the next page: the same form plus the cursor. */
export function pageHref(form: SearchForm, cursor: string | null): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(form) as (keyof SearchForm)[]) {
    if (form[name] !== '') query.set(name, form[name]);
  }
  if (cursor !== null) query.set('cursor', cursor);
  return `/search?${query.toString()}`;
}

/** The search that found nothing, for a `NO_RESULT` lead: the API criteria without the location. */
export function leadCriteria(params: SearchLabsParams): Record<string, string | number> {
  const criteria: Record<string, string | number> = {};
  if (params.q !== undefined) criteria.q = params.q;
  if (params.radiusKm !== undefined) criteria.radiusKm = params.radiusKm;
  if (params.discipline !== undefined) criteria.discipline = params.discipline;
  if (params.tatMax !== undefined) criteria.tatMax = params.tatMax;
  if (params.priceMax !== undefined) criteria.priceMax = params.priceMax;
  if (params.category !== undefined) criteria.category = params.category;
  return criteria;
}
