# Maps and geocoding

**Status:** DRAFT. Decision: OpenStreetMap initially, behind interfaces (CD-34, ADR-013).

## 1. Interfaces
```ts
interface Geocoder { geocode(addr: Address): Promise<{ point?: {lat:number; lng:number}; confidence: number; provider: string }>;
                     reverse?(p: LatLng): Promise<Address | null>; }
interface PincodeLocator { centroid(pincode: string): Promise<LatLng | null>; }   // for "search by pincode"
```
Web: a `MapView` component wrapping **MapLibre GL JS** (or Leaflet, decided in the design phase) with a configurable tile URL.

## 2. Providers (to confirm usage terms, OQ-17)
- **Tiles:** the public OSM tile servers **can't** be used for production traffic under the OSM Tile Usage Policy. Options: a commercial OSM-based tile provider, or self-hosted tiles (e.g. a Protomaps PMTiles file on S3 + CloudFront). Recommendation: self-hosted PMTiles of India, to avoid third-party limits and keep data in-region.
- **Geocoding:** batch geocoding of the NABL dataset through a self-hosted Nominatim (India extract) or a commercial OSM geocoder. The public Nominatim API's usage policy forbids bulk use.
- **Pincode centroids:** a seeded table from an openly licensed pincode dataset (licence to verify), stored in `md` reference data.
- Attribution "© OpenStreetMap contributors" is displayed on every map.

## 3. Rules
- Search radius queries use `lab_site.geo_point` (approved only) with PostGIS `ST_DWithin` in Postgres and `geo_distance` in OpenSearch.
- Low-confidence geocodes (< 0.7) go to the Ops pin queue. Labs propose corrections through the change-set workflow (EC-04).
- Customer device location is used only in the browser for the query and is never stored.
- No routing, dispatch or tracking (FS A.7).
