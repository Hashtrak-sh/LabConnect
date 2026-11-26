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
