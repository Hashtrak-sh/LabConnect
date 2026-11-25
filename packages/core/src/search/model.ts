/**
 * The search models (docs/05-integrations/SEARCH.md section 1, API_CONTRACTS section 2,
 * `public-search.yaml`). Everything in this file is public reference data only
 * (TENANT_ISOLATION.md section 1 and 4): no tenant ids, no contact details, no capacity
 * counts, no internal scores. A test (`deny-list.test.ts`) holds every field name to the
 * deny-list of the public boundary.
 */

export type PublicListingStatus = 'LISTED' | 'BOOKABLE';
export type PublicLabCategory = 'TESTING' | 'CALIBRATION';
export type ScopeSiteType = 'PERMANENT' | 'SITE' | 'MOBILE';
export const SEARCH_RADII_KM = [5, 10, 25, 50, 100] as const;
export type SearchRadiusKm = (typeof SEARCH_RADII_KM)[number];

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CodeName {
  code: string;
  name: string;
}

/** A taxonomy value with the aliases that make it findable (`md_node.aliases`). */
export interface AliasedCodeName extends CodeName {
  aliases: string[];
}

export interface DocumentAccreditation {
  certificateNo: string;
  bodyCode: string;
  bodyName: string;
  standardCode: string;
  standardName: string;
  /** `YYYY-MM-DD`. */
  validFrom: string;
  /** `YYYY-MM-DD`. */
  validTo: string;
  /** `YYYY-MM-DD`. */
  statusAsOf: string;
  /** `accreditation_body.verification_url_template`: public reference data. */
  verificationUrlTemplate: string | null;
}

/**
 * One document per active scope line of a listed site (SEARCH.md section 1), denormalised.
 * `scopeLineId` is the document id.
 *
 * Left out on purpose, although SEARCH.md section 1 lists them: `lab_org_id` (internal tenant
 * id) and `responsiveness_score` (internal ranking input). Both are on the deny-list of the
 * public boundary (OQ-150).
 */
export interface LabSearchDocument {
  scopeLineId: string;
  labSiteId: string;
  siteCode: string;
  siteName: string;
  city: string;
  stateCode: string;
  pincode: string;
  /** The Ops-approved pin only (BR-004); `null` otherwise, and the site is never found by distance. */
  location: GeoPoint | null;
  listingStatus: PublicListingStatus;
  /** Bookable at projection time (BR-001, as far as public data shows it). */
  isBookable: boolean;
  labCategory: PublicLabCategory;
  /** Always `VALID` in a document: a line under any other status is not indexed (BR-002). */
  accreditationStatus: 'VALID';
  accreditation: DocumentAccreditation;
  discipline: CodeName;
  group: CodeName | null;
  product: AliasedCodeName | null;
  parameter: AliasedCodeName;
  method: (CodeName & { standardCode: string | null }) | null;
  methodText: string | null;
  rangeText: string | null;
  siteType: ScopeSiteType;
  temporarilyUnavailable: boolean;
  /** Price of the line in the effective published price list. `null` unless the site is bookable. */
  pricePaise: bigint | null;
  /** Turnaround from the same price item. `null` when `pricePaise` is. */
  tatDays: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  /** Start of the earliest open slot with capacity; no count is ever indexed. */
  nextSlotAt: string | null;
  /** When the projector built this document (ISO 8601, UTC). Also the external version. */
  projectedAt: string;
}

export type SearchSort = 'relevance' | 'distance' | 'price' | 'tat';

export const SEARCH_DEFAULT_PAGE_SIZE = 25;
export const SEARCH_MAX_PAGE_SIZE = 100;
export const MAX_MATCHED_LINES = 10;
export const MAX_TEXT_LENGTH = 200;
export const MAX_TERMS = 8;

/** What a caller asks for, before validation (the query parameters of `searchLabs`). */
export interface SearchRequest {
  q?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  radiusKm?: number | undefined;
  discipline?: string | undefined;
  parameter?: string | undefined;
  method?: string | undefined;
  tatMax?: number | undefined;
  priceMax?: bigint | number | undefined;
  category?: string | undefined;
  /** Not in the contract (OQ-151): `price` and `tat` sort by the cheapest or fastest matched line. */
  sort?: SearchSort | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** A validated query. Build it with `normaliseSearchQuery`. */
export interface SearchQuery {
  /** The text as the user typed it, trimmed and with white space collapsed. */
  text: string | null;
  /**
   * What the text searches for: the lower-cased text first, then its synonym expansions
   * (`expandTerms`). Empty when there is no text.
   */
  terms: string[];
  location: GeoPoint | null;
  radiusKm: SearchRadiusKm | null;
  disciplineCode: string | null;
  parameterCode: string | null;
  methodCode: string | null;
  tatMax: number | null;
  priceMaxPaise: bigint | null;
  category: PublicLabCategory | null;
  sort: SearchSort;
  limit: number;
  cursor: string | null;
  /** The instant the query is answered for: accreditation validity and price lists are judged at it. */
  asOf: Date;
}

export interface MatchedLine {
  scopeLineId: string;
  certificateNo: string;
  discipline: CodeName;
  group: CodeName | null;
  product: CodeName | null;
  parameter: CodeName;
  method: CodeName | null;
  methodText: string | null;
  rangeText: string | null;
  siteType: ScopeSiteType;
  temporarilyUnavailable: boolean;
  pricePaise: bigint | null;
  tatDays: number | null;
}

export interface SiteAccreditation {
  certificateNo: string;
  bodyCode: string;
  bodyName: string;
  standardCode: string;
  standardName: string;
  labCategory: PublicLabCategory;
  validFrom: string;
  validTo: string;
  status: 'VALID';
  statusAsOf: string;
  verificationUrlTemplate: string | null;
}

export interface SiteSummary {
  labSiteId: string;
  siteCode: string;
  name: string;
  city: string;
  stateCode: string;
  pincode: string;
  location: GeoPoint | null;
  listingStatus: PublicListingStatus;
  ratingAverage: number | null;
  ratingCount: number;
  /** The site's accreditations that have a matching scope line (contract `PublicLabSiteSummary`). */
  accreditations: SiteAccreditation[];
}

/** One site of a result page, shaped for `LabSearchResult` of the contract. */
export interface SiteSearchResult {
  site: SiteSummary;
  /** Kilometres from the query location to the approved pin; `null` without either. */
  distanceKm: number | null;
  /** Lowest price among the matched lines (all priced lines when none matched); `null` unless bookable. */
  priceFromPaise: bigint | null;
  minTatDays: number | null;
  nextSlotAt: string | null;
  /** At most `MAX_MATCHED_LINES`, best first. Empty without line criteria or on a name-only match. */
  matchedLines: MatchedLine[];
  matchedLineCount: number;
}

export interface SearchPage {
  items: SiteSearchResult[];
  /** Sites matching the query, over all pages. May be approximate on OpenSearch. */
  total: number;
  nextCursor: string | null;
}

/** Which backend answered. For logs, metrics and tests; never for the response. */
export type SearchBackend = 'postgres' | 'opensearch' | 'memory';

/** Public reference data of one site's projection: what the sync writes and the index replaces. */
export interface SiteDocuments {
  labSiteId: string;
  documents: LabSearchDocument[];
}
