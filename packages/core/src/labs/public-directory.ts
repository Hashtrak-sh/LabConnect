import { Prisma, type PrismaClient } from '@labconnect/database';
import { istDateKey } from '../platform/business-calendar.js';
import type { Clock } from '../platform/clock.js';
import { withPublicReadContext } from '../platform/public-context.js';
import { accreditationVerificationUrl } from './accreditation-url.js';
import { LabDirectoryQueryError } from './errors.js';
import type {
  PublicCodeName,
  PublicPageQuery,
  PublicPricePage,
  PublicScopeLineItem,
  PublicScopePage,
  PublicScopeQuery,
  PublicSiteAccreditation,
  PublicSiteAddress,
  PublicSiteLabCategory,
  PublicSiteListingStatus,
  PublicSiteProfile,
} from './model.js';

/*
 * The public read side of the lab directory (`LabDirectoryService`, MODULE_BOUNDARIES: the labs
 * module owns `lab_site`, `accreditation`, `scope_line` and `receiving_hours`). Every read runs
 * as an anonymous visitor (`withPublicReadContext`), so the database hands over public reference
 * data only.
 *
 * Which sites are public is the same rule as search's `visibleLinesSql` (SEARCH.md section 4):
 * a site is public when it is `LISTED` or `BOOKABLE` and `ACTIVE`, its organisation is an
 * `ACTIVE` lab, and it has at least one public line, which means an `ACTIVE` scope line in its
 * dates under an accreditation that is `VALID`, in date, and `TESTING` or `CALIBRATION` (BR-002,
 * BR-005). A site search cannot find therefore has no profile either (404). The database test
 * holds the two definitions to the same answer for every site of the search world; when search
 * moves onto this service (OQ-152) the copy goes away.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SiteRow {
  id: string;
  site_code: string;
  name: string;
  address: unknown;
  pincode: string;
  state_code: string;
  listing_status: string;
  rating_avg: number | null;
  rating_count: number;
  lat: number | null;
  lng: number | null;
}

interface AccreditationRow {
  certificate_no: string;
  body_code: string;
  body_name: string;
  verification_url_template: string | null;
  standard_code: string;
  standard_name: string;
  lab_category: string;
  valid_from: string;
  valid_to: string;
  status_as_of: string;
}

interface HoursRow {
  weekday: number;
  opens_at: string;
  closes_at: string;
  cutoff_at: string | null;
}

/** An accreditation in force today with at least one scope line in force today. */
function publicAccreditationSql(today: string): Prisma.Sql {
  return Prisma.sql`
    a.status = 'VALID'
    AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date
    AND a.lab_category IN ('TESTING', 'CALIBRATION')
    AND EXISTS (
      SELECT 1 FROM scope_line sl
       WHERE sl.accreditation_id = a.id AND sl.lab_site_id = a.lab_site_id
         AND sl.status = 'ACTIVE'
         AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
         AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date))`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** `lab_site.address` is `{line1, line2, city, district, state_code, pincode}` (SCHEMA_SPECIFICATION §5.1). */
function address(row: SiteRow): PublicSiteAddress {
  const raw =
    typeof row.address === 'object' && row.address !== null
      ? (row.address as Record<string, unknown>)
      : {};
  return {
    line1: text(raw.line1) ?? row.name,
    line2: text(raw.line2),
    city: text(raw.city) ?? '',
    district: text(raw.district),
    // The columns are authoritative for state and pincode (they carry the constraints).
    stateCode: row.state_code,
    pincode: row.pincode,
  };
}

function accreditation(row: AccreditationRow): PublicSiteAccreditation {
  return {
    certificateNo: row.certificate_no,
    bodyCode: row.body_code,
    bodyName: row.body_name,
    standardCode: row.standard_code,
    standardName: row.standard_name,
    labCategory: row.lab_category as PublicSiteLabCategory,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: 'VALID',
    statusAsOf: row.status_as_of,
    verificationUrl: accreditationVerificationUrl(
      row.verification_url_template,
      row.certificate_no,
    ),
  };
}

export interface LabDirectoryDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
}

export class LabDirectoryService {
  constructor(private readonly deps: LabDirectoryDeps) {}

  /**
   * The public profile of a site (FR-DIS-06), or `null` when the site does not exist or is not
   * public (`HIDDEN`, inactive, organisation not active, or no accreditation in force). The
   * caller answers `null` with 404, so a hidden site and a missing one look the same.
   */
  async getPublicSite(siteId: string): Promise<PublicSiteProfile | null> {
    if (!UUID.test(siteId)) return null;
    const today = istDateKey(this.deps.clock.now());

    return withPublicReadContext(this.deps.prisma, async (tx) => {
      const sites = await tx.$queryRaw<SiteRow[]>(Prisma.sql`
        SELECT s.id, s.site_code, s.name, s.address, s.pincode::text AS pincode, s.state_code,
               s.listing_status::text AS listing_status,
               s.rating_avg::float8 AS rating_avg, s.rating_count,
               CASE WHEN s.geo_point IS NOT NULL AND s.geocode_status IN ('AUTO_OK', 'MANUAL_APPROVED')
                    THEN ST_Y(s.geo_point::geometry) END AS lat,
               CASE WHEN s.geo_point IS NOT NULL AND s.geocode_status IN ('AUTO_OK', 'MANUAL_APPROVED')
                    THEN ST_X(s.geo_point::geometry) END AS lng
          FROM lab_site s
          JOIN organisation o ON o.id = s.organisation_id
         WHERE s.id = ${siteId}::uuid
           AND s.listing_status IN ('LISTED', 'BOOKABLE')
           AND s.status = 'ACTIVE'
           AND o.org_type = 'LAB' AND o.status = 'ACTIVE'`);
      const site = sites[0];
      if (!site) return null;

      const accreditations = await tx.$queryRaw<AccreditationRow[]>(Prisma.sql`
        SELECT a.certificate_no, b.code AS body_code, b.name AS body_name,
               b.verification_url_template, st.code AS standard_code, st.name AS standard_name,
               a.lab_category::text AS lab_category,
               a.valid_from::text AS valid_from, a.valid_to::text AS valid_to,
               a.status_as_of::text AS status_as_of
          FROM accreditation a
          JOIN accreditation_body b ON b.id = a.accreditation_body_id
          JOIN accreditation_standard st ON st.id = a.standard_id
         WHERE a.lab_site_id = ${siteId}::uuid AND ${publicAccreditationSql(today)}
         ORDER BY a.lab_category, a.certificate_no`);
      if (accreditations.length === 0) return null;

      const hours = await tx.$queryRaw<HoursRow[]>(Prisma.sql`
        SELECT weekday::int AS weekday,
               to_char(opens_at, 'HH24:MI') AS opens_at,
               to_char(closes_at, 'HH24:MI') AS closes_at,
               to_char(cutoff_at, 'HH24:MI') AS cutoff_at
          FROM receiving_hours
         WHERE lab_site_id = ${siteId}::uuid
         ORDER BY weekday, opens_at`);

      return {
        labSiteId: site.id,
        siteCode: site.site_code,
        name: site.name,
        address: address(site),
        location: site.lat === null || site.lng === null ? null : { lat: site.lat, lng: site.lng },
        listingStatus: site.listing_status as PublicSiteListingStatus,
        ratingAverage: site.rating_avg,
        ratingCount: site.rating_count,
        accreditations: accreditations.map(accreditation),
        receivingHours: hours.map((row) => ({
          weekday: row.weekday,
          opensAt: row.opens_at,
          closesAt: row.closes_at,
          cutoffAt: row.cutoff_at,
        })),
      };
    });
  }

  /**
   * A page of the site's public scope lines (FR-DIS-06, `listPublicScopeLines`), ordered along the
   * scope tree by name (discipline, group, product, parameter, method), then by line id, or `null`
   * when the site is not public (404, as for the profile).
   *
   * `text` keeps the lines whose text matches it with the lab search's rule (SEARCH.md section 3):
   * a substring, or for four characters or more a `word_similarity` of at least 0.6, against the
   * same fields (parameter, product, group, discipline, method and standard, and their aliases).
   * Admin synonyms are not applied here yet: they live in `search`, which `labs` may not import
   * (OQ-198). The order stays the tree order; matches are not ranked.
   */
  async listPublicScope(siteId: string, query: PublicScopeQuery): Promise<PublicScopePage | null> {
    if (!UUID.test(siteId)) return null;
    const today = istDateKey(this.deps.clock.now());
    const after = query.cursor === null ? null : decodeScopeCursor(query.cursor);
    const term = query.text === null ? null : query.text.toLowerCase();

    return withPublicReadContext(this.deps.prisma, async (tx) => {
      const visible = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT s.id
          FROM lab_site s
          JOIN organisation o ON o.id = s.organisation_id
         WHERE s.id = ${siteId}::uuid
           AND s.listing_status IN ('LISTED', 'BOOKABLE')
           AND s.status = 'ACTIVE'
           AND o.org_type = 'LAB' AND o.status = 'ACTIVE'
           AND EXISTS (SELECT 1 FROM accreditation a
                        WHERE a.lab_site_id = s.id AND ${publicAccreditationSql(today)})`);
      if (visible.length === 0) return null;

      const textFilter =
        term === null
          ? Prisma.sql`TRUE`
          : Prisma.sql`(position(${term} IN x.blob) > 0
                        OR (length(${term}) >= ${MIN_FUZZY_LENGTH}
                            AND word_similarity(${term}, x.blob) >= ${TEXT_MATCH_THRESHOLD}))`;
      const afterFilter =
        after === null
          ? Prisma.sql`TRUE`
          : Prisma.sql`(x.k1, x.k2, x.k3, x.k4, x.k5, x.id::text)
                        > (${after[0]}, ${after[1]}, ${after[2]}, ${after[3]}, ${after[4]}, ${after[5]})`;

      const rows = await tx.$queryRaw<ScopeRow[]>(Prisma.sql`
        SELECT x.* FROM (
          SELECT sl.id, a.certificate_no,
                 d.code AS d_code, d.name AS d_name, g.code AS g_code, g.name AS g_name,
                 p.code AS p_code, p.name AS p_name, pa.code AS pa_code, pa.name AS pa_name,
                 m.code AS m_code, m.name AS m_name,
                 sl.method_text, sl.range_text, sl.site_type::text AS site_type,
                 sl.temporarily_unavailable,
                 d.name AS k1, COALESCE(g.name, '') AS k2, COALESCE(p.name, '') AS k3,
                 pa.name AS k4, COALESCE(m.name, sl.method_text, '') AS k5,
                 lower(concat_ws(' | ', pa.name, array_to_string(pa.aliases, ' '), p.name,
                                 array_to_string(p.aliases, ' '), g.name, d.name, m.name,
                                 m.attributes->>'standard_code', sl.method_text)) AS blob
            FROM scope_line sl
            JOIN accreditation a ON a.id = sl.accreditation_id
            JOIN md_node d ON d.id = sl.discipline_node_id
            JOIN md_node pa ON pa.id = sl.parameter_node_id
            LEFT JOIN md_node g ON g.id = sl.group_node_id
            LEFT JOIN md_node p ON p.id = sl.product_node_id
            LEFT JOIN md_node m ON m.id = sl.method_node_id
           WHERE sl.lab_site_id = ${siteId}::uuid
             AND sl.status = 'ACTIVE'
             AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
             AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date)
             AND a.status = 'VALID'
             AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date
             AND a.lab_category IN ('TESTING', 'CALIBRATION')
        ) x
         WHERE ${textFilter} AND ${afterFilter}
         ORDER BY x.k1, x.k2, x.k3, x.k4, x.k5, x.id::text
         LIMIT ${query.limit + 1}`);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        lines: page.map(scopeLine),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeScopeCursor([last.k1, last.k2, last.k3, last.k4, last.k5, last.id])
            : null,
      };
    });
  }

  /**
   * A page of a bookable site's effective published price list with sample requirements
   * (FR-DIS-06, CD-06, `getPublicPriceList`), in the scope's tree order, or `null` when the site
   * is not public or not bookable (404, API_CONTRACTS section 2). Drafts are never read.
   *
   * Bookable is the rule search uses for prices (SEARCH.md section 4, `visibleLinesSql`): the
   * site's flag and `BOOKABLE` listing, organisation claimed with KYC verified, a `TESTING`
   * accreditation in date and a `PUBLISHED` price list in effect now. Only items of public
   * `TESTING` lines are listed (BR-003); an item the lab marked unavailable is listed with
   * `isAvailable: false`.
   */
  async listPublicPrices(siteId: string, query: PublicPageQuery): Promise<PublicPricePage | null> {
    if (!UUID.test(siteId)) return null;
    const now = this.deps.clock.now();
    const today = istDateKey(now);
    const after =
      query.cursor === null ? null : decodeScopeCursor(query.cursor, PRICE_CURSOR_PREFIX);

    return withPublicReadContext(this.deps.prisma, async (tx) => {
      const lists = await tx.$queryRaw<{ id: string; version_no: number; effective_from: Date }[]>(
        Prisma.sql`
        SELECT pl.id, pl.version_no, pl.effective_from
          FROM lab_site s
          JOIN organisation o ON o.id = s.organisation_id
          JOIN price_list pl
            ON pl.lab_site_id = s.id AND pl.status = 'PUBLISHED' AND pl.effective_from IS NOT NULL
           AND pl.effective_from <= ${now}::timestamptz
           AND (pl.effective_to IS NULL OR pl.effective_to > ${now}::timestamptz)
         WHERE s.id = ${siteId}::uuid
           AND s.status = 'ACTIVE' AND s.is_bookable AND s.listing_status = 'BOOKABLE'
           AND o.org_type = 'LAB' AND o.status = 'ACTIVE'
           AND o.claim_status = 'CLAIMED' AND o.kyc_status = 'VERIFIED'
           AND EXISTS (SELECT 1 FROM accreditation a
                        WHERE a.lab_site_id = s.id AND a.lab_category = 'TESTING'
                          AND ${publicAccreditationSql(today)})`,
      );
      const list = lists[0];
      if (!list) return null;

      const afterFilter =
        after === null
          ? Prisma.sql`TRUE`
          : Prisma.sql`(x.k1, x.k2, x.k3, x.k4, x.k5, x.id::text)
                        > (${after[0]}, ${after[1]}, ${after[2]}, ${after[3]}, ${after[4]}, ${after[5]})`;

      const rows = await tx.$queryRaw<PriceRow[]>(Prisma.sql`
        SELECT x.* FROM (
          SELECT sl.id, a.certificate_no,
                 d.code AS d_code, d.name AS d_name, g.code AS g_code, g.name AS g_name,
                 p.code AS p_code, p.name AS p_name, pa.code AS pa_code, pa.name AS pa_name,
                 m.code AS m_code, m.name AS m_name,
                 sl.method_text, sl.range_text, sl.site_type::text AS site_type,
                 sl.temporarily_unavailable,
                 pi.price_paise, pi.sample_prep_paise, pi.gst_rate_bp,
                 pi.sample_qty::float8 AS sample_qty, u.code AS u_code, u.name AS u_name,
                 pi.packaging_instructions, pi.tat_days, pi.is_available,
                 d.name AS k1, COALESCE(g.name, '') AS k2, COALESCE(p.name, '') AS k3,
                 pa.name AS k4, COALESCE(m.name, sl.method_text, '') AS k5
            FROM price_item pi
            JOIN scope_line sl ON sl.id = pi.scope_line_id AND sl.lab_site_id = ${siteId}::uuid
            JOIN accreditation a ON a.id = sl.accreditation_id
            JOIN md_node u ON u.id = pi.sample_unit_node_id
            JOIN md_node d ON d.id = sl.discipline_node_id
            JOIN md_node pa ON pa.id = sl.parameter_node_id
            LEFT JOIN md_node g ON g.id = sl.group_node_id
            LEFT JOIN md_node p ON p.id = sl.product_node_id
            LEFT JOIN md_node m ON m.id = sl.method_node_id
           WHERE pi.price_list_id = ${list.id}::uuid
             AND sl.status = 'ACTIVE'
             AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
             AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date)
             AND a.status = 'VALID' AND a.lab_category = 'TESTING'
             AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date
        ) x
         WHERE ${afterFilter}
         ORDER BY x.k1, x.k2, x.k3, x.k4, x.k5, x.id::text
         LIMIT ${query.limit + 1}`);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        priceList: { versionNo: list.version_no, effectiveFrom: list.effective_from },
        items: page.map((row) => ({
          scopeLine: scopeLine(row),
          pricePaise: row.price_paise,
          samplePrepPaise: row.sample_prep_paise,
          gstRateBp: row.gst_rate_bp,
          sampleQty: row.sample_qty,
          sampleUnit: { code: row.u_code, name: row.u_name },
          packagingInstructions: row.packaging_instructions,
          tatDays: row.tat_days,
          isAvailable: row.is_available,
        })),
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeScopeCursor(
                [last.k1, last.k2, last.k3, last.k4, last.k5, last.id],
                PRICE_CURSOR_PREFIX,
              )
            : null,
      };
    });
  }
}

const PRICE_CURSOR_PREFIX = 'pr1.';

interface PriceRow extends ScopeRow {
  price_paise: bigint;
  sample_prep_paise: bigint;
  gst_rate_bp: number;
  sample_qty: number;
  u_code: string;
  u_name: string;
  packaging_instructions: string | null;
  tat_days: number;
  is_available: boolean;
}

/** The lab search's text rule (SEARCH.md section 3), kept equal to search's `TEXT_MATCH_THRESHOLD`. */
const TEXT_MATCH_THRESHOLD = 0.6;
const MIN_FUZZY_LENGTH = 4;

interface ScopeRow {
  id: string;
  certificate_no: string;
  d_code: string;
  d_name: string;
  g_code: string | null;
  g_name: string | null;
  p_code: string | null;
  p_name: string | null;
  pa_code: string;
  pa_name: string;
  m_code: string | null;
  m_name: string | null;
  method_text: string | null;
  range_text: string | null;
  site_type: string;
  temporarily_unavailable: boolean;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  k5: string;
}

const pair = (code: string | null, name: string | null): PublicCodeName | null =>
  code === null || name === null ? null : { code, name };

function scopeLine(row: ScopeRow): PublicScopeLineItem {
  return {
    scopeLineId: row.id,
    certificateNo: row.certificate_no,
    discipline: { code: row.d_code, name: row.d_name },
    group: pair(row.g_code, row.g_name),
    product: pair(row.p_code, row.p_name),
    parameter: { code: row.pa_code, name: row.pa_name },
    method: pair(row.m_code, row.m_name),
    methodText: row.method_text,
    rangeText: row.range_text,
    siteType: row.site_type,
    temporarilyUnavailable: row.temporarily_unavailable,
  };
}

/**
 * Cursors are opaque to the client (API_CONVENTIONS §3): base64url JSON of the last line's tree
 * position (public taxonomy names) and its id, behind a version prefix. No search text.
 */
type ScopePosition = [string, string, string, string, string, string];
const SCOPE_CURSOR_PREFIX = 'sc1.';

function encodeScopeCursor(position: ScopePosition, prefix = SCOPE_CURSOR_PREFIX): string {
  return prefix + Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

function decodeScopeCursor(cursor: string, prefix = SCOPE_CURSOR_PREFIX): ScopePosition {
  const invalid = new LabDirectoryQueryError(
    'The cursor is not valid. Start again from the first page.',
  );
  if (!cursor.startsWith(prefix)) throw invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor.slice(prefix.length), 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 6 ||
    !parsed.every((value) => typeof value === 'string' && value.length <= 500) ||
    !UUID.test(parsed[5] as string)
  ) {
    throw invalid;
  }
  return parsed as ScopePosition;
}
