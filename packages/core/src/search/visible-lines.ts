import { Prisma } from '@labconnect/database';
import type {
  AliasedCodeName,
  CodeName,
  LabSearchDocument,
  PublicLabCategory,
  PublicListingStatus,
  ScopeSiteType,
} from './model.js';

/*
 * The one place where the search module reads the tables of other modules (labs, masterdata,
 * identity). MODULE_BOUNDARIES.md says search is an event consumer that reads through the owning
 * modules' services, but `LabDirectoryService`, `PricingService`, `CapacityService` and
 * `TaxonomyService` do not exist yet (only the tables do), so this file reads public reference
 * columns directly, as an anonymous visitor (`withPublicReadContext`), and nowhere else does
 * search touch another module's table. When those services exist, replace this file by calls to
 * them and keep `rowToDocument` (OQ-152).
 *
 * `visibleLinesSql` is the single definition of which scope lines are public. Both the
 * projector (index documents) and `PostgresSearchIndex` (live queries) select from it, so the
 * two cannot disagree about visibility.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The calendar date in India of an instant, `YYYY-MM-DD`. */
export function istDateString(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface VisibleLinesOptions {
  /** Also compute `next_slot_at` (one lookup per site). Off for queries that do not return it. */
  nextSlot: boolean;
}

/**
 * One row per public scope line. A line is public when ALL of these hold:
 *
 * - its site is `LISTED` or `BOOKABLE` (`HIDDEN` never; API_CONTRACTS section 2) and `ACTIVE`;
 * - the lab organisation is `ACTIVE` (a suspended or closed organisation is not shown: OQ-155);
 * - the line is `ACTIVE` and inside its own effective dates;
 * - its accreditation is `VALID` and in date on `asOf` (BR-002, EC-01) and its category is
 *   `TESTING` or `CALIBRATION` (`MEDICAL` and `OTHER` are never shown: BR-005, CD-03).
 *
 * `price_paise`, `tat_days` and `next_slot_at` are filled only when the site is bookable at
 * `asOf` (BR-001, as far as public data can show it): the flag `lab_site.is_bookable` and
 * `listing_status = 'BOOKABLE'` (kept equal by C-61), the organisation claimed and KYC
 * verified, a `TESTING` accreditation in date, and a PUBLISHED price list in effect. The line's
 * own price item must be available, and its accreditation `TESTING` (BR-003). Bank
 * verification and the Maker/Checker pair (the rest of BR-001) are not public data; they are
 * in `lab_site.is_bookable`, which is therefore also required.
 */
export function visibleLinesSql(asOf: Date, options: VisibleLinesOptions): Prisma.Sql {
  const today = istDateString(asOf);
  const nextSlot = options.nextSlot
    ? Prisma.sql`(
        SELECT min(sx.starts_at) FROM slot sx
         WHERE bk.bookable AND sx.lab_site_id = s.id AND sx.status = 'OPEN'
           AND sx.starts_at > ${asOf}::timestamptz
           AND sx.capacity > sx.held_count + sx.booked_count)`
    : Prisma.sql`NULL::timestamptz`;
  return Prisma.sql`
    SELECT
      sl.id AS scope_line_id,
      s.id AS lab_site_id,
      s.site_code,
      s.name AS site_name,
      COALESCE(s.address->>'city', '') AS city,
      s.state_code,
      s.pincode::text AS pincode,
      CASE WHEN approved.pin IS NULL THEN NULL ELSE ST_Y(approved.pin::geometry) END AS lat,
      CASE WHEN approved.pin IS NULL THEN NULL ELSE ST_X(approved.pin::geometry) END AS lon,
      s.listing_status::text AS listing_status,
      bk.bookable AS is_bookable,
      s.rating_avg::float8 AS rating_avg,
      s.rating_count,
      a.certificate_no,
      a.valid_from::text AS valid_from,
      a.valid_to::text AS valid_to,
      a.status_as_of::text AS status_as_of,
      a.lab_category::text AS lab_category,
      b.code AS body_code,
      b.name AS body_name,
      b.verification_url_template,
      st.code AS standard_code,
      st.name AS standard_name,
      d.code AS d_code, d.name AS d_name,
      g.code AS g_code, g.name AS g_name,
      p.code AS p_code, p.name AS p_name, p.aliases AS p_aliases,
      pa.code AS pa_code, pa.name AS pa_name, pa.aliases AS pa_aliases,
      m.code AS m_code, m.name AS m_name, m.attributes->>'standard_code' AS m_standard_code,
      sl.method_text,
      sl.range_text,
      sl.site_type::text AS site_type,
      sl.temporarily_unavailable,
      CASE WHEN bk.bookable AND a.lab_category = 'TESTING' THEN pi.price_paise END AS price_paise,
      CASE WHEN bk.bookable AND a.lab_category = 'TESTING' AND pi.price_paise IS NOT NULL
           THEN pi.tat_days END AS tat_days,
      ${nextSlot} AS next_slot_at
    FROM scope_line sl
    JOIN lab_site s ON s.id = sl.lab_site_id
    JOIN organisation o ON o.id = s.organisation_id
    JOIN accreditation a ON a.id = sl.accreditation_id
    JOIN accreditation_body b ON b.id = a.accreditation_body_id
    JOIN accreditation_standard st ON st.id = a.standard_id
    JOIN md_node d ON d.id = sl.discipline_node_id
    JOIN md_node pa ON pa.id = sl.parameter_node_id
    LEFT JOIN md_node g ON g.id = sl.group_node_id
    LEFT JOIN md_node p ON p.id = sl.product_node_id
    LEFT JOIN md_node m ON m.id = sl.method_node_id
    LEFT JOIN price_list pl
      ON pl.lab_site_id = s.id AND pl.status = 'PUBLISHED' AND pl.effective_from IS NOT NULL
     AND pl.effective_from <= ${asOf}::timestamptz
     AND (pl.effective_to IS NULL OR pl.effective_to > ${asOf}::timestamptz)
    LEFT JOIN price_item pi
      ON pi.price_list_id = pl.id AND pi.scope_line_id = sl.id AND pi.is_available
    CROSS JOIN LATERAL (
      SELECT CASE WHEN s.geo_point IS NOT NULL AND s.geocode_status IN ('AUTO_OK', 'MANUAL_APPROVED')
                  THEN s.geo_point END AS pin
    ) approved
    CROSS JOIN LATERAL (
      SELECT (s.is_bookable AND s.listing_status = 'BOOKABLE'
              AND o.claim_status = 'CLAIMED' AND o.kyc_status = 'VERIFIED'
              AND pl.id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM accreditation ta
                 WHERE ta.lab_site_id = s.id AND ta.status = 'VALID' AND ta.lab_category = 'TESTING'
                   AND ta.valid_from <= ${today}::date AND ta.valid_to >= ${today}::date)
             ) AS bookable
    ) bk
    WHERE s.listing_status IN ('LISTED', 'BOOKABLE')
      AND s.status = 'ACTIVE'
      AND o.org_type = 'LAB' AND o.status = 'ACTIVE'
      AND sl.status = 'ACTIVE'
      AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
      AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date)
      AND a.status = 'VALID'
      AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date
      AND a.lab_category IN ('TESTING', 'CALIBRATION')`;
}

/** What `visibleLinesSql` returns, as Prisma's raw queries hand it back. */
export interface VisibleLineRow {
  scope_line_id: string;
  lab_site_id: string;
  site_code: string;
  site_name: string;
  city: string;
  state_code: string;
  pincode: string;
  lat: number | null;
  lon: number | null;
  listing_status: string;
  is_bookable: boolean;
  rating_avg: number | null;
  rating_count: number;
  certificate_no: string;
  valid_from: string;
  valid_to: string;
  status_as_of: string;
  lab_category: string;
  body_code: string;
  body_name: string;
  verification_url_template: string | null;
  standard_code: string;
  standard_name: string;
  d_code: string;
  d_name: string;
  g_code: string | null;
  g_name: string | null;
  p_code: string | null;
  p_name: string | null;
  p_aliases: string[] | null;
  pa_code: string;
  pa_name: string;
  pa_aliases: string[] | null;
  m_code: string | null;
  m_name: string | null;
  m_standard_code: string | null;
  method_text: string | null;
  range_text: string | null;
  site_type: string;
  temporarily_unavailable: boolean;
  price_paise: bigint | null;
  tat_days: number | null;
  next_slot_at: Date | null;
}

const pair = (code: string | null, name: string | null): CodeName | null =>
  code === null || name === null ? null : { code, name };

/** A document from a row. `projectedAt` is when the projection ran. */
export function rowToDocument(row: VisibleLineRow, projectedAt: Date): LabSearchDocument {
  const product: AliasedCodeName | null =
    row.p_code === null || row.p_name === null
      ? null
      : { code: row.p_code, name: row.p_name, aliases: row.p_aliases ?? [] };
  const method = pair(row.m_code, row.m_name);
  return {
    scopeLineId: row.scope_line_id,
    labSiteId: row.lab_site_id,
    siteCode: row.site_code,
    siteName: row.site_name,
    city: row.city,
    stateCode: row.state_code,
    pincode: row.pincode,
    location: row.lat === null || row.lon === null ? null : { lat: row.lat, lng: row.lon },
    listingStatus: row.listing_status as PublicListingStatus,
    isBookable: row.is_bookable,
    labCategory: row.lab_category as PublicLabCategory,
    accreditationStatus: 'VALID',
    accreditation: {
      certificateNo: row.certificate_no,
      bodyCode: row.body_code,
      bodyName: row.body_name,
      standardCode: row.standard_code,
      standardName: row.standard_name,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      statusAsOf: row.status_as_of,
      verificationUrlTemplate: row.verification_url_template,
    },
    discipline: { code: row.d_code, name: row.d_name },
    group: pair(row.g_code, row.g_name),
    product,
    parameter: { code: row.pa_code, name: row.pa_name, aliases: row.pa_aliases ?? [] },
    method: method === null ? null : { ...method, standardCode: row.m_standard_code },
    methodText: row.method_text,
    rangeText: row.range_text,
    siteType: row.site_type as ScopeSiteType,
    temporarilyUnavailable: row.temporarily_unavailable,
    pricePaise: row.price_paise,
    tatDays: row.tat_days,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    nextSlotAt: row.next_slot_at === null ? null : row.next_slot_at.toISOString(),
    projectedAt: projectedAt.toISOString(),
  };
}
