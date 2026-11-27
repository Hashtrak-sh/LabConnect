import { decodeCursor, encodeCursor } from './cursor.js';
import type { SearchIndex, UpsertResult } from './index-port.js';
import {
  type LabSearchDocument,
  MAX_MATCHED_LINES,
  type SearchPage,
  type SearchQuery,
  type SiteAccreditation,
  type SiteDocuments,
  type SiteSearchResult,
} from './model.js';
import {
  accreditationKey,
  documentToAccreditation,
  documentToMatchedLine,
  documentToSite,
  haversineMetres,
} from './result-mapping.js';
import { istDateString } from './visible-lines.js';
import { bestTermScore, queryWordLists, splitWords } from './word-match.js';

const SORT_LAST = 1e18;

/** The words of a line: the parameter name, and every other text that makes the line findable. */
export function lineWords(doc: LabSearchDocument): { name: string[]; other: string[] } {
  const other = [
    doc.parameter.aliases.join(' '),
    doc.product?.name,
    doc.product?.aliases.join(' '),
    doc.group?.name,
    doc.discipline.name,
    doc.method?.name,
    doc.method?.standardCode,
    doc.methodText,
  ].filter((part): part is string => part !== undefined && part !== null && part.length > 0);
  return { name: splitWords(doc.parameter.name), other: splitWords(other.join(' | ')) };
}

/** Score of the terms against one line, `word-match.ts` (the SQL twin is in `matching-sql.ts`). */
export function memoryLineScore(terms: readonly string[], doc: LabSearchDocument): number {
  const { name, other } = lineWords(doc);
  return bestTermScore(queryWordLists(terms), name, other);
}

/** Score of the terms against the name and code of a site. */
export function memorySiteScore(terms: readonly string[], doc: LabSearchDocument): number {
  return bestTermScore(queryWordLists(terms), splitWords(`${doc.siteName} ${doc.siteCode}`), []);
}

interface Scored {
  doc: LabSearchDocument;
  qualifies: boolean;
  lineScore: number;
  nameScore: number;
  matched: boolean;
}

/**
 * An index in memory: the fake of the tests and the executable statement of the query semantics
 * that every adapter has to give. Same visibility at query time (accreditation dates), same
 * matching rules, same sort keys and paging as `PostgresSearchIndex`.
 */
export class InMemorySearchIndex implements SearchIndex {
  readonly backend = 'memory' as const;
  private readonly documents = new Map<string, LabSearchDocument>();

  get size(): number {
    return this.documents.size;
  }

  all(): LabSearchDocument[] {
    return [...this.documents.values()];
  }

  ensureIndex(): Promise<void> {
    return Promise.resolve();
  }

  isHealthy(): Promise<boolean> {
    return Promise.resolve(true);
  }

  upsertDocuments(documents: LabSearchDocument[]): Promise<UpsertResult> {
    let written = 0;
    for (const document of documents) {
      const stored = this.documents.get(document.scopeLineId);
      // An older projection never replaces a newer one (the external version of OpenSearch).
      if (stored !== undefined && stored.projectedAt > document.projectedAt) continue;
      this.documents.set(document.scopeLineId, structuredClone(document));
      written += 1;
    }
    return Promise.resolve({ written, failed: [] });
  }

  deleteDocuments(scopeLineIds: string[]): Promise<void> {
    for (const id of scopeLineIds) this.documents.delete(id);
    return Promise.resolve();
  }

  async replaceSites(sites: SiteDocuments[]): Promise<UpsertResult> {
    let written = 0;
    for (const site of sites) {
      const keep = new Set(site.documents.map((document) => document.scopeLineId));
      for (const [id, stored] of this.documents) {
        if (stored.labSiteId === site.labSiteId && !keep.has(id)) this.documents.delete(id);
      }
      written += (await this.upsertDocuments(site.documents)).written;
    }
    return { written, failed: [] };
  }

  listSiteIds(after: string | null, limit: number): Promise<string[]> {
    const ids = [...new Set(this.all().map((document) => document.labSiteId))]
      .filter((id) => after === null || id > after)
      .sort();
    return Promise.resolve(ids.slice(0, limit));
  }

  search(query: SearchQuery): Promise<SearchPage> {
    try {
      return Promise.resolve(this.searchNow(query));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private searchNow(query: SearchQuery): SearchPage {
    const position = query.cursor === null ? null : decodeCursor('memory', query.cursor);
    const today = istDateString(query.asOf);
    const textOn = query.terms.length > 0;
    const hasFilters =
      query.disciplineCode !== null ||
      query.parameterCode !== null ||
      query.methodCode !== null ||
      query.tatMax !== null ||
      query.priceMaxPaise !== null ||
      query.category !== null;

    const bySite = new Map<string, Scored[]>();
    for (const doc of this.documents.values()) {
      if (doc.accreditation.validFrom > today || doc.accreditation.validTo < today) continue;
      const qualifies =
        (query.disciplineCode === null || doc.discipline.code === query.disciplineCode) &&
        (query.parameterCode === null || doc.parameter.code === query.parameterCode) &&
        (query.methodCode === null || doc.method?.code === query.methodCode) &&
        (query.tatMax === null || (doc.tatDays !== null && doc.tatDays <= query.tatMax)) &&
        (query.priceMaxPaise === null ||
          (doc.pricePaise !== null && doc.pricePaise <= query.priceMaxPaise)) &&
        (query.category === null || doc.labCategory === query.category);
      const lineScore = textOn ? memoryLineScore(query.terms, doc) : 0;
      const nameScore = textOn ? memorySiteScore(query.terms, doc) : 0;
      const matched = textOn
        ? qualifies && lineScore > 0
        : hasFilters
          ? qualifies
          : false;
      const list = bySite.get(doc.labSiteId) ?? [];
      list.push({ doc, qualifies, lineScore, nameScore, matched });
      bySite.set(doc.labSiteId, list);
    }

    interface Ranked {
      siteId: string;
      rows: Scored[];
      matchedCount: number;
      priceFrom: bigint | null;
      minTat: number | null;
      distanceM: number | null;
      sortKey: number;
      /** Best text score of the site: the tie-break after the sort key. */
      rel: number;
    }
    const ranked: Ranked[] = [];
    for (const [siteId, rows] of bySite) {
      const first = rows[0]?.doc;
      if (first === undefined) continue;
      const matchedRows = rows.filter((row) => row.matched);
      const anyQualifying = rows.some((row) => row.qualifies);
      const anyLineHit = rows.some((row) => row.qualifies && row.lineScore > 0);
      const nameScore = Math.max(...rows.map((row) => row.nameScore));
      const bestLine = Math.max(
        0,
        ...rows.filter((row) => row.qualifies).map((row) => row.lineScore),
      );
      if (hasFilters && !anyQualifying) continue;
      if (textOn && !(nameScore > 0 || anyLineHit)) continue;
      const distanceM =
        query.location === null || first.location === null
          ? null
          : haversineMetres(query.location, first.location);
      if (query.radiusKm !== null && (distanceM === null || distanceM > query.radiusKm * 1000)) {
        continue;
      }
      const pool = matchedRows.length > 0 ? matchedRows : rows;
      const prices = pool.map((row) => row.doc.pricePaise).filter((p): p is bigint => p !== null);
      const tats = pool.map((row) => row.doc.tatDays).filter((t): t is number => t !== null);
      const priceFrom = prices.length === 0 ? null : prices.reduce((a, b) => (b < a ? b : a));
      const minTat = tats.length === 0 ? null : Math.min(...tats);
      const sortKey = {
        relevance: -Math.max(bestLine, nameScore),
        distance: distanceM ?? SORT_LAST,
        price: priceFrom === null ? SORT_LAST : Number(priceFrom),
        tat: minTat ?? SORT_LAST,
      }[query.sort];
      ranked.push({
        siteId,
        rows,
        matchedCount: matchedRows.length,
        priceFrom,
        minTat,
        distanceM,
        sortKey,
        rel: Math.max(bestLine, nameScore),
      });
    }
    ranked.sort(
      (a, b) => a.sortKey - b.sortKey || b.rel - a.rel || (a.siteId < b.siteId ? -1 : 1),
    );
    const after =
      position === null
        ? ranked
        : ranked.filter((site) => {
            if (site.sortKey !== position.k) return site.sortKey > position.k;
            if (position.r !== undefined && site.rel !== position.r) return site.rel < position.r;
            return site.siteId > position.id;
          });
    const page = after.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = after.length > query.limit;
    return {
      items: page.map((site) => this.toResult(site)),
      total: ranked.length,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor('memory', { k: last.sortKey, id: last.siteId, r: last.rel })
          : null,
    };
  }

  private toResult(site: {
    rows: Scored[];
    matchedCount: number;
    priceFrom: bigint | null;
    minTat: number | null;
    distanceM: number | null;
  }): SiteSearchResult {
    const first = site.rows[0]?.doc;
    if (first === undefined) throw new Error('unreachable: a site has a row');
    const byScore = (a: Scored, b: Scored): number =>
      b.lineScore - a.lineScore || (a.doc.scopeLineId < b.doc.scopeLineId ? -1 : 1);
    const qualifying = site.rows.filter((row) => row.qualifies);
    const pickable = qualifying.filter((row) => row.matched || site.matchedCount === 0);
    const matched = pickable
      .filter((row) => row.matched)
      .sort(byScore)
      .slice(0, MAX_MATCHED_LINES);
    // One representative per accreditation: matched first, then best score, then id.
    const representatives = new Map<string, Scored>();
    for (const row of [...pickable].sort(
      (a, b) => Number(b.matched) - Number(a.matched) || byScore(a, b),
    )) {
      const key = accreditationKey(row.doc.accreditation);
      if (!representatives.has(key)) representatives.set(key, row);
    }
    const ordered = [...new Set([...matched, ...representatives.values()])].sort(byScore);
    const accreditations = new Map<string, SiteAccreditation>();
    for (const row of ordered) {
      const key = accreditationKey(row.doc.accreditation);
      if (!accreditations.has(key)) accreditations.set(key, documentToAccreditation(row.doc));
    }
    return {
      site: documentToSite(first, [...accreditations.values()]),
      distanceKm: site.distanceM === null ? null : Math.round(site.distanceM) / 1000,
      priceFromPaise: site.priceFrom,
      minTatDays: site.minTat,
      nextSlotAt: ordered.find((row) => row.doc.nextSlotAt !== null)?.doc.nextSlotAt ?? null,
      matchedLines: matched.map(({ doc }) => documentToMatchedLine(doc)),
      matchedLineCount: site.matchedCount,
    };
  }
}
