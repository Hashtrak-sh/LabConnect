import { Prisma, type PrismaClient } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import { withPublicReadContext } from '../platform/public-context.js';
import { SearchQueryError } from './errors.js';
import { MAX_TEXT_LENGTH } from './model.js';
import { TEXT_MATCH_THRESHOLD } from './postgres-index.js';
import { cleanText, expandTerms } from './query.js';
import type { SynonymSource } from './synonyms.js';
import { visibleLinesSql } from './visible-lines.js';

/** What a suggestion is (`SearchSuggestionKind`). */
export type SuggestionKind = 'PARAMETER' | 'PRODUCT' | 'METHOD' | 'LAB_SITE';

/** One typeahead suggestion (`SearchSuggestion`). */
export interface Suggestion {
  kind: SuggestionKind;
  label: string;
  /** The node code for `PARAMETER`, `PRODUCT` and `METHOD`; `null` for `LAB_SITE`. */
  code: string | null;
  /** The site for `LAB_SITE`; `null` otherwise. */
  labSiteId: string | null;
}

export const MAX_SUGGESTIONS = 10;
const MIN_FUZZY_LENGTH = 4;

export interface SuggestServiceDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
  synonyms: SynonymSource;
}

/**
 * Typeahead (`suggestSearch`, FR-DIS-01, I1-CUS-08): up to 10 parameters, products, methods and
 * lab sites, best first. Only values that occur on a public scope line are suggested, from the
 * same `visibleLinesSql` the search uses, so a suggestion never leads to an empty search. The text
 * is cleaned and expanded with the admin synonyms exactly as the search does; matching is the
 * search's rule (substring, or `word_similarity` >= 0.6 for four characters or more), and a match
 * at the start of the text ranks above a match inside it. Postgres only: no OpenSearch backend for
 * suggestions yet.
 */
export class SuggestService {
  constructor(private readonly deps: SuggestServiceDeps) {}

  async suggest(rawText: string): Promise<Suggestion[]> {
    const text = cleanText(rawText);
    if (text.length === 0) throw new SearchQueryError('q must not be empty.');
    if (text.length > MAX_TEXT_LENGTH) {
      throw new SearchQueryError(`q must be at most ${String(MAX_TEXT_LENGTH)} characters.`);
    }
    const terms = expandTerms(text, await this.deps.synonyms.load());
    const asOf = this.deps.clock.now();

    return withPublicReadContext(this.deps.prisma, async (tx) => {
      const rows = await tx.$queryRaw<
        { kind: SuggestionKind; label: string; code: string | null; lab_site_id: string | null }[]
      >(Prisma.sql`
        WITH v AS (${visibleLinesSql(asOf, { nextSlot: false })}),
        candidates AS (
          SELECT DISTINCT 'PARAMETER' AS kind, v.pa_name AS label, v.pa_code AS code,
                 NULL::text AS lab_site_id,
                 lower(concat_ws(' ', v.pa_name, array_to_string(v.pa_aliases, ' '))) AS blob
            FROM v
          UNION
          SELECT DISTINCT 'PRODUCT', v.p_name, v.p_code, NULL::text,
                 lower(concat_ws(' ', v.p_name, array_to_string(v.p_aliases, ' ')))
            FROM v WHERE v.p_code IS NOT NULL
          UNION
          SELECT DISTINCT 'METHOD', v.m_name, v.m_code, NULL::text,
                 lower(concat_ws(' ', v.m_name, v.m_standard_code))
            FROM v WHERE v.m_code IS NOT NULL
          UNION
          SELECT DISTINCT 'LAB_SITE', v.site_name, NULL::text, v.lab_site_id::text,
                 lower(v.site_name || ' ' || v.site_code)
            FROM v
        ),
        scored AS (
          SELECT c.kind, c.label, c.code, c.lab_site_id,
                 max(CASE WHEN c.blob LIKE t.term || '%' THEN 3.0
                          WHEN position(t.term IN c.blob) > 0 THEN 2.0
                          WHEN length(t.term) >= ${MIN_FUZZY_LENGTH}
                               THEN word_similarity(t.term, c.blob)
                          ELSE 0 END)::float8 AS score
            FROM candidates c
           CROSS JOIN unnest(${terms}::text[]) AS t(term)
           GROUP BY c.kind, c.label, c.code, c.lab_site_id
        )
        SELECT kind, label, code, lab_site_id
          FROM scored
         WHERE score >= ${TEXT_MATCH_THRESHOLD}
         ORDER BY score DESC, length(label), label, kind
         LIMIT ${MAX_SUGGESTIONS}`);
      return rows.map((row) => ({
        kind: row.kind,
        label: row.label,
        code: row.code,
        labSiteId: row.lab_site_id,
      }));
    });
  }
}
