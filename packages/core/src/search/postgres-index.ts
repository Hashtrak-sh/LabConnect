import { Prisma, type PrismaClient } from '@labconnect/database';
import { decodeCursor, encodeCursor } from './cursor.js';
import type { SearchIndex, UpsertResult } from './index-port.js';
import {
  type LabSearchDocument,
  MAX_MATCHED_LINES,
  type MatchedLine,
  type PublicLabCategory,
  type PublicListingStatus,
  type ScopeSiteType,
  type SearchPage,
  type SearchQuery,
  type SiteAccreditation,
  type SiteDocuments,
  type SiteSearchResult,
} from './model.js';
import { withPublicReadContext } from '../platform/public-context.js';
import { nearWordsCte, termScoreSql, wordsSql } from './matching-sql.js';
import { visibleLinesSql } from './visible-lines.js';
import { FUZZY_WORD_SIMILARITY, normaliseTerm } from './word-match.js';

/**
 * Text matching (SEARCH.md section 3, "Matching"): by whole words and the beginning of words,
 * never the middle of a word, graded by where the words are found, with a typing mistake as the
 * weakest fallback. The rules and the score are in `word-match.ts`; `matching-sql.ts` is their
 * SQL. This is the `word_similarity` of a query word to a word of the text from which it counts
 * as a typing mistake: 0.6 tolerates a transposed or missing letter in a word ("strenght" finds
 * "strength") without matching unrelated words.
 */
export const TEXT_MATCH_THRESHOLD = FUZZY_WORD_SIMILARITY;
/** Sort position of a site that has no value for the sort (no pin, not priced): after all others. */
export const SORT_LAST = 1e18;
const METRES_PER_KM = 1000;

interface SiteRow {
  lab_site_id: string;
  site_code: string;
  site_name: string;
  city: string;
  state_code: string;
  pincode: string;
  lat: number | null;
  lon: number | null;
  listing_status: string;
  rating_avg: number | null;
  rating_count: number;
  matched_count: number;
  price_from: bigint | null;
  min_tat: number | null;
  distance_m: number | null;
  sort_key: number;
  /** Best text score of the site (0 without text): the tie-break after the sort key. */
  rel: number;
  total: number;
}

interface LineRow {
  lab_site_id: string;
  scope_line_id: string;
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
  pa_code: string;
  pa_name: string;
  m_code: string | null;
  m_name: string | null;
  method_text: string | null;
  range_text: string | null;
  site_type: string;
  temporarily_unavailable: boolean;
  price_paise: bigint | null;
  tat_days: number | null;
  next_slot_at: Date | null;
  line_score: number;
  matched: boolean;
}

/** `lines` and `flagged`: the visible lines with their text scores, filter flags and match flag. */
function flaggedLinesSql(query: SearchQuery, visible: Prisma.Sql): Prisma.Sql {
  const textOn = query.terms.length > 0;
  // A term without a word (only punctuation) matches nothing; so does a query made only of those.
  const terms = [...new Set(query.terms.map(normaliseTerm).filter((term) => term.length > 0))];

  const filters: Prisma.Sql[] = [];
  if (query.disciplineCode !== null) filters.push(Prisma.sql`v.d_code = ${query.disciplineCode}`);
  if (query.parameterCode !== null) filters.push(Prisma.sql`v.pa_code = ${query.parameterCode}`);
  if (query.methodCode !== null) filters.push(Prisma.sql`v.m_code = ${query.methodCode}`);
  if (query.tatMax !== null) {
    filters.push(Prisma.sql`(v.tat_days IS NOT NULL AND v.tat_days <= ${query.tatMax})`);
  }
  if (query.priceMaxPaise !== null) {
    filters.push(
      Prisma.sql`(v.price_paise IS NOT NULL AND v.price_paise <= ${query.priceMaxPaise}::bigint)`,
    );
  }
  if (query.category !== null) filters.push(Prisma.sql`v.lab_category = ${query.category}`);
  const hasFilters = filters.length > 0;
  const qualifies = hasFilters ? Prisma.join(filters, ' AND ') : Prisma.sql`TRUE`;
  const matched = textOn
    ? Prisma.sql`(l.qualifies AND l.line_score > 0)`
    : hasFilters
      ? Prisma.sql`l.qualifies`
      : Prisma.sql`FALSE`;

  // Without text there is nothing to score. With text, the words of each line are cut once (`vb`),
  // the words of the stored text that are a typing mistake away from a query word are found once
  // over the distinct words (`near`, see matching-sql.ts), and a site's name is scored once per
  // site (`sn`), not once per line. Each is MATERIALIZED: the planner would otherwise repeat them
  // for every row that uses them.
  const scored = textOn
    ? Prisma.sql`
    vt AS MATERIALIZED (
      SELECT v.*, v.pa_name AS t_name, coalesce(v.p_name, '') AS t_product,
             concat_ws(' | ', array_to_string(v.pa_aliases, ' '), array_to_string(v.p_aliases, ' '),
                       v.g_name, v.d_name, v.m_name, v.m_standard_code, v.method_text) AS t_other,
             v.site_name || ' ' || v.site_code AS t_site
        FROM v
    ),
    wt AS MATERIALIZED (
      SELECT u.t, ${wordsSql(Prisma.sql`u.t`)} AS w
        FROM (SELECT t_name AS t FROM vt UNION SELECT t_product FROM vt
              UNION SELECT t_other FROM vt UNION SELECT t_site FROM vt) u
    ),
    vb AS MATERIALIZED (
      SELECT vt.*, n.w AS name_words, p.w AS product_words, o.w AS other_words, s.w AS site_words
        FROM vt
        JOIN wt n ON n.t = vt.t_name
        JOIN wt p ON p.t = vt.t_product
        JOIN wt o ON o.t = vt.t_other
        JOIN wt s ON s.t = vt.t_site
    ),
    ${nearWordsCte(
      terms,
      Prisma.sql`SELECT name_words || product_words || other_words || site_words AS w FROM vb`,
    )},
    sn AS MATERIALIZED (
      SELECT d.lab_site_id,
             ${termScoreSql(terms, {
               name: Prisma.sql`d.site_words`,
               product: Prisma.sql`' '::text`,
               other: Prisma.sql`' '::text`,
             })} AS name_score
        FROM (SELECT DISTINCT ON (lab_site_id) lab_site_id, site_words
                FROM vb ORDER BY lab_site_id) d
    ),
    lines AS MATERIALIZED (
      SELECT v.*, ${qualifies} AS qualifies,
             ${termScoreSql(terms, {
               name: Prisma.sql`v.name_words`,
               product: Prisma.sql`v.product_words`,
               other: Prisma.sql`v.other_words`,
             })} AS line_score,
             sn.name_score AS name_score
        FROM vb v
        JOIN sn ON sn.lab_site_id = v.lab_site_id
    ),`
    : Prisma.sql`
    lines AS MATERIALIZED (
      SELECT v.*, ${qualifies} AS qualifies, 0::float8 AS line_score, 0::float8 AS name_score
        FROM v
    ),`;

  return Prisma.sql`
    v AS MATERIALIZED (${visible}),
    ${scored}
    flagged AS (
      SELECT l.*, (l.line_score > 0) AS line_hit, ${matched} AS matched
        FROM lines l
    )`;
}

function toMatchedLine(row: LineRow): MatchedLine {
  return {
    scopeLineId: row.scope_line_id,
    certificateNo: row.certificate_no,
    discipline: { code: row.d_code, name: row.d_name },
    group:
      row.g_code === null || row.g_name === null ? null : { code: row.g_code, name: row.g_name },
    product:
      row.p_code === null || row.p_name === null ? null : { code: row.p_code, name: row.p_name },
    parameter: { code: row.pa_code, name: row.pa_name },
    method:
      row.m_code === null || row.m_name === null ? null : { code: row.m_code, name: row.m_name },
    methodText: row.method_text,
    rangeText: row.range_text,
    siteType: row.site_type as ScopeSiteType,
    temporarilyUnavailable: row.temporarily_unavailable,
    pricePaise: row.price_paise,
    tatDays: row.tat_days,
  };
}

function toAccreditation(row: LineRow): SiteAccreditation {
  return {
    certificateNo: row.certificate_no,
    bodyCode: row.body_code,
    bodyName: row.body_name,
    standardCode: row.standard_code,
    standardName: row.standard_name,
    labCategory: row.lab_category as PublicLabCategory,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: 'VALID',
    statusAsOf: row.status_as_of,
    verificationUrlTemplate: row.verification_url_template,
  };
}

/**
 * The fallback and the MVP default (SEARCH.md section 3): searches the relational tables
 * directly, in an anonymous read-only transaction (`withPublicReadContext`), with the visibility
 * rules of `visibleLinesSql`. Nothing is indexed: `ensureIndex` and the writing methods do
 * nothing, and the sync has no effect on its answers because it always reads current state.
 *
 * Two queries per page: the sites of the page (ranked and counted in SQL), then the lines to
 * show for those sites only.
 */
export class PostgresSearchIndex implements SearchIndex {
  readonly backend = 'postgres' as const;

  constructor(private readonly prisma: Pick<PrismaClient, '$transaction'>) {}

  ensureIndex(): Promise<void> {
    return Promise.resolve();
  }

  upsertDocuments(documents: LabSearchDocument[]): Promise<UpsertResult> {
    return Promise.resolve({ written: documents.length, failed: [] });
  }

  deleteDocuments(): Promise<void> {
    return Promise.resolve();
  }

  replaceSites(sites: SiteDocuments[]): Promise<UpsertResult> {
    return Promise.resolve({
      written: sites.reduce((sum, site) => sum + site.documents.length, 0),
      failed: [],
    });
  }

  listSiteIds(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await withPublicReadContext(this.prisma, (tx) => tx.$queryRaw`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  async search(query: SearchQuery): Promise<SearchPage> {
    const position = query.cursor === null ? null : decodeCursor('postgres', query.cursor);
    return await withPublicReadContext(this.prisma, async (tx) => {
      const sites = await this.pageOfSites(tx, query, position);
      const hasMore = sites.length > query.limit;
      const pageSites = hasMore ? sites.slice(0, query.limit) : sites;
      const total = sites[0]?.total ?? (position === null ? 0 : await this.total(tx, query));
      const lines = await this.linesOf(
        tx,
        query,
        pageSites.map((site) => site.lab_site_id),
      );
      const items = pageSites.map((site) => this.toResult(site, lines.get(site.lab_site_id) ?? []));
      const last = pageSites.at(-1);
      return {
        items,
        total,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor('postgres', { k: last.sort_key, id: last.lab_site_id, r: last.rel })
            : null,
      };
    });
  }

  private async pageOfSites(
    tx: Prisma.TransactionClient,
    query: SearchQuery,
    position: { k: number; id: string; r?: number } | null,
  ): Promise<SiteRow[]> {
    const textOn = query.terms.length > 0;
    const hasFilters =
      query.disciplineCode !== null ||
      query.parameterCode !== null ||
      query.methodCode !== null ||
      query.tatMax !== null ||
      query.priceMaxPaise !== null ||
      query.category !== null;
    const where: Prisma.Sql[] = [];
    if (hasFilters) where.push(Prisma.sql`s.any_qualifying`);
    if (textOn) {
      where.push(Prisma.sql`(s.name_score > 0 OR s.any_line_hit)`);
    }
    if (query.radiusKm !== null) {
      where.push(
        Prisma.sql`(s.distance_m IS NOT NULL AND s.distance_m <= ${query.radiusKm * METRES_PER_KM})`,
      );
    }
    const eligible = where.length > 0 ? Prisma.join(where, ' AND ') : Prisma.sql`TRUE`;
    const sortKey = {
      relevance: Prisma.sql`-GREATEST(COALESCE(s.best_line, 0), s.name_score)`,
      distance: Prisma.sql`COALESCE(s.distance_m, ${SORT_LAST})`,
      price: Prisma.sql`COALESCE(s.price_from::float8, ${SORT_LAST})`,
      tat: Prisma.sql`COALESCE(s.min_tat::float8, ${SORT_LAST})`,
    }[query.sort];
    const distance =
      query.location === null
        ? Prisma.sql`NULL::float8`
        : Prisma.sql`CASE WHEN g.lat IS NULL THEN NULL ELSE ST_Distance(
            ST_SetSRID(ST_MakePoint(g.lon, g.lat), 4326)::geography,
            ST_SetSRID(ST_MakePoint(${query.location.lng}, ${query.location.lat}), 4326)::geography
          ) END`;
    const after =
      position === null
        ? Prisma.sql`TRUE`
        : position.r === undefined
          ? Prisma.sql`(r.sort_key > ${position.k}::float8
                        OR (r.sort_key = ${position.k}::float8 AND r.lab_site_id > ${position.id}::uuid))`
          : Prisma.sql`(r.sort_key > ${position.k}::float8
                        OR (r.sort_key = ${position.k}::float8
                            AND (r.rel < ${position.r}::float8
                                 OR (r.rel = ${position.r}::float8 AND r.lab_site_id > ${position.id}::uuid))))`;

    return tx.$queryRaw<SiteRow[]>`
      WITH ${flaggedLinesSql(query, visibleLinesSql(query.asOf, { nextSlot: false }))},
      g AS (
        SELECT lab_site_id, site_code, site_name, city, state_code, pincode, lat, lon, listing_status,
               rating_avg, rating_count,
               count(*) FILTER (WHERE matched)::int AS matched_count,
               bool_or(qualifies) AS any_qualifying,
               bool_or(qualifies AND line_hit) AS any_line_hit,
               max(CASE WHEN qualifies THEN line_score END) AS best_line,
               max(name_score) AS name_score,
               CASE WHEN count(*) FILTER (WHERE matched) > 0
                    THEN min(price_paise) FILTER (WHERE matched) ELSE min(price_paise) END AS price_from,
               CASE WHEN count(*) FILTER (WHERE matched) > 0
                    THEN min(tat_days) FILTER (WHERE matched) ELSE min(tat_days) END AS min_tat
          FROM flagged
         GROUP BY lab_site_id, site_code, site_name, city, state_code, pincode, lat, lon,
                  listing_status, rating_avg, rating_count
      ),
      s AS (SELECT g.*, ${distance} AS distance_m FROM g),
      r AS (
        SELECT s.lab_site_id, s.site_code, s.site_name, s.city, s.state_code, s.pincode, s.lat, s.lon,
               s.listing_status, s.rating_avg, s.rating_count, s.matched_count, s.price_from,
               s.min_tat, s.distance_m, (${sortKey})::float8 AS sort_key,
               GREATEST(COALESCE(s.best_line, 0), s.name_score)::float8 AS rel,
               (count(*) OVER ())::int AS total
          FROM s
         WHERE ${eligible}
      )
      SELECT r.* FROM r
       WHERE ${after}
       ORDER BY r.sort_key, r.rel DESC, r.lab_site_id
       LIMIT ${query.limit + 1}`;
  }

  /** Only reached when a cursor points past the last site, so the page is empty. */
  private async total(tx: Prisma.TransactionClient, query: SearchQuery): Promise<number> {
    const first = await this.pageOfSites(tx, { ...query, limit: 1, cursor: null }, null);
    return first[0]?.total ?? 0;
  }

  private async linesOf(
    tx: Prisma.TransactionClient,
    query: SearchQuery,
    siteIds: string[],
  ): Promise<Map<string, LineRow[]>> {
    const bySite = new Map<string, LineRow[]>();
    if (siteIds.length === 0) return bySite;
    const visible = Prisma.sql`SELECT x.* FROM (${visibleLinesSql(query.asOf, { nextSlot: true })}) x
                                WHERE x.lab_site_id = ANY(${siteIds}::uuid[])`;
    const rows = await tx.$queryRaw<LineRow[]>`
      WITH ${flaggedLinesSql(query, visible)},
      ranked AS (
        SELECT f.*, (count(*) FILTER (WHERE f.matched) OVER (PARTITION BY f.lab_site_id)) AS site_matched
          FROM flagged f WHERE f.qualifies
      ),
      pick AS (
        SELECT ranked.*,
               row_number() OVER (PARTITION BY lab_site_id ORDER BY line_score DESC, scope_line_id) AS rn,
               row_number() OVER (PARTITION BY lab_site_id, body_code, certificate_no
                                  ORDER BY matched DESC, line_score DESC, scope_line_id) AS rn_acc
          FROM ranked WHERE matched OR site_matched = 0
      )
      SELECT * FROM pick
       WHERE (matched AND rn <= ${MAX_MATCHED_LINES}) OR rn_acc = 1
       ORDER BY lab_site_id, line_score DESC, scope_line_id`;
    for (const row of rows) {
      const list = bySite.get(row.lab_site_id) ?? [];
      list.push(row);
      bySite.set(row.lab_site_id, list);
    }
    return bySite;
  }

  private toResult(site: SiteRow, rows: LineRow[]): SiteSearchResult {
    const matched = rows.filter((row) => row.matched).slice(0, MAX_MATCHED_LINES);
    const accreditations = new Map<string, SiteAccreditation>();
    for (const row of rows) {
      const key = `${row.body_code}\u0000${row.certificate_no}`;
      if (!accreditations.has(key)) accreditations.set(key, toAccreditation(row));
    }
    const nextSlot = rows.find((row) => row.next_slot_at !== null)?.next_slot_at ?? null;
    return {
      site: {
        labSiteId: site.lab_site_id,
        siteCode: site.site_code,
        name: site.site_name,
        city: site.city,
        stateCode: site.state_code,
        pincode: site.pincode,
        location: site.lat === null || site.lon === null ? null : { lat: site.lat, lng: site.lon },
        listingStatus: site.listing_status as PublicListingStatus,
        ratingAverage: site.rating_avg,
        ratingCount: site.rating_count,
        accreditations: [...accreditations.values()],
      },
      distanceKm: site.distance_m === null ? null : Math.round(site.distance_m) / METRES_PER_KM,
      priceFromPaise: site.price_from,
      minTatDays: site.min_tat,
      nextSlotAt: nextSlot === null ? null : nextSlot.toISOString(),
      matchedLines: matched.map(toMatchedLine),
      matchedLineCount: site.matched_count,
    };
  }
}
