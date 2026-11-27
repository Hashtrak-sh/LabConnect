import { rupeesToPaise } from '@/lib/format';

/**
 * The search page's own URL parameters (what the form submits). Prices are typed in rupees. The
 * device location is deliberately NOT one of them: personal data never goes into a URL
 * (CLAUDE.md §5). It travels in a short-lived cookie instead (`search-location.ts`).
 */
export interface SearchForm {
  q: string;
  discipline: string;
  category: string;
  tat: string;
  maxPrice: string;
  radius: string;
}

/** A search location, already validated and rounded. */
export interface SearchPoint {
  lat: number;
  lng: number;
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

/** Longest node code the API accepts (`NodeCode`). */
const MAX_CODE_LENGTH = 100;

type RawParams = Record<string, string | string[] | undefined>;

function first(raw: RawParams, name: string): string {
  const value = raw[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/** The form values echoed back into the inputs. Any `lat`/`lng` in the URL is ignored. */
export function readSearchForm(raw: RawParams): SearchForm {
  return {
    q: first(raw, 'q'),
    discipline: first(raw, 'discipline'),
    category: first(raw, 'category'),
    tat: first(raw, 'tat'),
    maxPrice: first(raw, 'maxPrice'),
    radius: first(raw, 'radius'),
  };
}

/**
 * A location from untrusted input (the cookie, or the browser via the server action), rounded to
 * 3 decimals (about 100 m: enough for distance and radius, less precise than the device gives).
 * `null` when it is not a point on Earth.
 */
export function parsePoint(lat: unknown, lng: unknown): SearchPoint | null {
  const a = typeof lat === 'number' ? lat : Number(lat);
  const b = typeof lng === 'number' ? lng : Number(lng);
  if (lat === '' || lng === '' || lat === null || lng === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    return null;
  }
  return { lat: Math.round(a * 1e3) / 1e3, lng: Math.round(b * 1e3) / 1e3 };
}

/** Whether the user asked for anything; an empty form shows no results yet. */
export function hasCriteria(form: SearchForm, point: SearchPoint | null): boolean {
  return point !== null || Object.values(form).some((value) => value !== '');
}

/**
 * The API query for a form. Values the API would refuse are dropped rather than sent, so a stray
 * character in a box never turns the page into an error: a radius only with a location, a
 * turnaround only as a whole number of days, a price only as rupees, a discipline only as a code.
 */
export function toSearchLabsParams(
  form: SearchForm,
  point: SearchPoint | null,
  cursor: string,
  limit: number,
): SearchLabsParams {
  const params: SearchLabsParams = { limit };
  if (form.q !== '') params.q = form.q.slice(0, 200);
  if (form.discipline !== '' && form.discipline.length <= MAX_CODE_LENGTH) {
    params.discipline = form.discipline;
  }
  if (form.category === 'TESTING' || form.category === 'CALIBRATION') {
    params.category = form.category;
  }
  if (/^\d{1,4}$/.test(form.tat) && Number(form.tat) >= 1) params.tatMax = Number(form.tat);
  const paise = form.maxPrice === '' ? null : rupeesToPaise(form.maxPrice);
  if (paise !== null) params.priceMax = paise;

  if (point !== null) {
    params.lat = point.lat;
    params.lng = point.lng;
    const radius = Number(form.radius);
    if ((RADII as readonly number[]).includes(radius)) {
      params.radiusKm = radius as SearchLabsParams['radiusKm'];
    }
  }
  if (cursor !== '') params.cursor = cursor;
  return params;
}

/** The page URL for another page: the same form plus the cursor, never the location. */
export function pageHref(form: SearchForm, cursor: string | null): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(form) as (keyof SearchForm)[]) {
    if (form[name] !== '') query.set(name, form[name]);
  }
  if (cursor !== null) query.set('cursor', cursor);
  return `/search?${query.toString()}`;
}

/**
 * The search that found nothing, for a `NO_RESULT` lead: the API criteria without the location.
 * `null` when nothing is left to describe the search (for example a radius alone), so no empty
 * lead is offered.
 */
export function leadCriteria(params: SearchLabsParams): Record<string, string | number> | null {
  const criteria: Record<string, string | number> = {};
  if (params.q !== undefined) criteria.q = params.q;
  if (params.radiusKm !== undefined) criteria.radiusKm = params.radiusKm;
  if (params.discipline !== undefined) criteria.discipline = params.discipline;
  if (params.tatMax !== undefined) criteria.tatMax = params.tatMax;
  if (params.priceMax !== undefined) criteria.priceMax = params.priceMax;
  if (params.category !== undefined) criteria.category = params.category;
  const describing = ['q', 'discipline', 'tatMax', 'priceMax', 'category'];
  return describing.some((name) => name in criteria) ? criteria : null;
}
