# Search

**Status:** DRAFT for gate G2.

## 1. Index design (OpenSearch)
Index `lab_scope_v{n}` (alias `lab_scope`). **One document per active scope line** at a listed site, denormalised:
```
scope_line_id, lab_site_id, lab_org_id, site_name, site_code, city, state_code, pincode,
location (geo_point), listing_status, is_bookable, lab_category, accreditation_status, accreditation_valid_to,
discipline{code,name}, group{…}, product{…,aliases}, parameter{…,aliases}, method{code,name,standard_code},
range_text, site_type, price_paise (nullable), tat_days, temporarily_unavailable,
rating_avg, rating_count, responsiveness_score, next_slot_at, searchable_attributes{...}
```
- Analysers: standard + lowercase + ASCII folding, an edge n-gram sub-field for typeahead, a **synonym graph** filter fed from `search_synonym` (e.g. `TS ⇒ tensile strength`, `IS 1786 ⇒ TMT bars`), and fuzziness `AUTO` on the main query.
- Queries use `collapse` on `lab_site_id`, with `inner_hits` returning the matched scope lines (the "why this lab matched" view, FR-DIS-05), a `geo_distance` filter, and a sort by distance or relevance.
- Only public reference data is indexed (TENANT_ISOLATION §4).

## 2. Sync
- Event-driven: `masterdata.published`, `pricelist.published`, `lab_site.bookability_changed`, `slot.capacity_changed` (debounced), `rating.updated` → `lc-search-sync` → upsert or delete by `scope_line_id` / `lab_site_id`.
- Nightly full rebuild into a new index version, then the alias is swapped (backstop and reindex path).
- Freshness target: < 60 s from publication to search (AC-MDM-03, AC-DIS-05).

## 3. Fallback
`SearchService` has a Postgres implementation (`pg_trgm` + PostGIS) for local development, tests and degraded mode. Search is behind an interface, so OpenSearch adoption can be revisited (ADR-007) if Phase 3 benchmarks show Postgres meets NFR-03 at year-1 scale.
