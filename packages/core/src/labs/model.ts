/** Listing statuses a visitor can see. `HIDDEN` sites are never public. */
export type PublicSiteListingStatus = 'LISTED' | 'BOOKABLE';

/** Accreditation categories a visitor can see (BR-005, CD-03: never `MEDICAL` or `OTHER`). */
export type PublicSiteLabCategory = 'TESTING' | 'CALIBRATION';

export interface PublicSiteAddress {
  line1: string;
  line2: string | null;
  city: string;
  district: string | null;
  stateCode: string;
  pincode: string;
}

export interface PublicSiteAccreditation {
  certificateNo: string;
  bodyCode: string;
  bodyName: string;
  standardCode: string;
  standardName: string;
  labCategory: PublicSiteLabCategory;
  /** `YYYY-MM-DD`. */
  validFrom: string;
  /** `YYYY-MM-DD`. */
  validTo: string;
  /** Always `VALID`: only accreditations in force are public (BR-002). */
  status: 'VALID';
  /** `YYYY-MM-DD`. */
  statusAsOf: string;
  /** Filled from the body's template; `null` when the body has none (OQ-159). */
  verificationUrl: string | null;
}

export interface PublicSiteReceivingHours {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** `HH:MM`, IST. */
  opensAt: string;
  closesAt: string;
  cutoffAt: string | null;
}

/**
 * A lab site's public profile (FR-DIS-06): only public reference data. No contact details
 * (`lab_site_private`), bookability reasons, capacity or tenant data.
 */
export interface PublicSiteProfile {
  labSiteId: string;
  siteCode: string;
  name: string;
  address: PublicSiteAddress;
  /** The approved pin only (BR-004); `null` while there is none. */
  location: { lat: number; lng: number } | null;
  listingStatus: PublicSiteListingStatus;
  ratingAverage: number | null;
  ratingCount: number;
  /** Ordered by category, then certificate number. Never empty. */
  accreditations: PublicSiteAccreditation[];
  /** Ordered by weekday, then opening time. */
  receivingHours: PublicSiteReceivingHours[];
}

export interface PublicCodeName {
  code: string;
  name: string;
}

/** One public line of a site's scope of accreditation (`PublicScopeLine`, FR-DAT-02). */
export interface PublicScopeLineItem {
  /** What a booking line references. */
  scopeLineId: string;
  certificateNo: string;
  discipline: PublicCodeName;
  group: PublicCodeName | null;
  product: PublicCodeName | null;
  parameter: PublicCodeName;
  method: PublicCodeName | null;
  methodText: string | null;
  rangeText: string | null;
  siteType: string;
  temporarilyUnavailable: boolean;
}

export interface PublicScopeQuery {
  /** Text to search inside the scope, already cleaned by the caller; `null` for the whole scope. */
  text: string | null;
  /** The `nextCursor` of the previous page. */
  cursor: string | null;
  /** 1 to 100. */
  limit: number;
}

export interface PublicScopePage {
  lines: PublicScopeLineItem[];
  nextCursor: string | null;
}

/** One item of a bookable site's effective published price list (`PublicPriceItem`, CD-06). */
export interface PublicPriceItemView {
  scopeLine: PublicScopeLineItem;
  pricePaise: bigint;
  samplePrepPaise: bigint;
  /** 1800 = 18.00 %. */
  gstRateBp: number;
  sampleQty: number;
  sampleUnit: PublicCodeName;
  packagingInstructions: string | null;
  tatDays: number;
  isAvailable: boolean;
}

export interface PublicPricePage {
  priceList: { versionNo: number; effectiveFrom: Date };
  items: PublicPriceItemView[];
  nextCursor: string | null;
}

export interface PublicPageQuery {
  cursor: string | null;
  /** 1 to 100. */
  limit: number;
}
