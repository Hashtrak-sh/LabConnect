import { cookies } from 'next/headers';
import { parsePoint, type SearchPoint } from './search-params';

/** Name of the short-lived cookie that holds the search location (see `search-location.ts`). */
export const SEARCH_LOCATION_COOKIE = 'lc_search_location';

/** The saved search location for this request, or `null`. Server components only. */
export async function readSearchLocation(): Promise<SearchPoint | null> {
  const value = (await cookies()).get(SEARCH_LOCATION_COOKIE)?.value;
  if (value === undefined) return null;
  const [lat, lng] = value.split(',');
  return parsePoint(lat ?? '', lng ?? '');
}
