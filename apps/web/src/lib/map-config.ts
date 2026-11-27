/**
 * Map tiles (MAPS_AND_GEOCODING, ADR-013, ADR-021). The URL is configuration, never code:
 * production tiles are an open question (OQ-17); on a developer machine the public OpenStreetMap
 * tiles are fine for light use. Read on the server and passed to the client map.
 */
export function mapTileUrl(): string {
  return process.env.MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}
