'use server';

import { cookies } from 'next/headers';
import { cookieOptions } from '@/lib/session';
import { SEARCH_LOCATION_COOKIE } from './search-location-cookie';
import { parsePoint } from './search-params';

/**
 * The search location lives in a short-lived, HTTP-only cookie on the user's own browser, never in
 * a URL (CLAUDE.md §5) and never on the server (MAPS_AND_GEOCODING §3). It is rounded to about
 * 100 m and expires after 30 minutes or when the user clears it.
 */
const COOKIE = SEARCH_LOCATION_COOKIE;
const MAX_AGE_SECONDS = 30 * 60;

/** Saves the device location the browser reported (`LocationPicker`). Invalid input is ignored. */
export async function setSearchLocation(lat: number, lng: number): Promise<boolean> {
  const point = parsePoint(lat, lng);
  if (point === null) return false;
  (await cookies()).set(
    COOKIE,
    `${String(point.lat)},${String(point.lng)}`,
    cookieOptions(MAX_AGE_SECONDS),
  );
  return true;
}

/** Forgets the location ("Clear"). */
export async function clearSearchLocation(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
