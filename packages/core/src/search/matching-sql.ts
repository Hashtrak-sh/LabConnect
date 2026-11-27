import { Prisma } from '@labconnect/database';
import {
  FUZZY_WORD_SIMILARITY,
  GRADE_FUZZY,
  GRADE_NAME_PREFIX,
  GRADE_NAME_WORD,
  GRADE_NONE,
  GRADE_OTHER,
  MIN_FUZZY_LENGTH,
  MIN_PREFIX_LENGTH,
  WORD_SEPARATOR_CLASS,
} from './word-match.js';

/*
 * The SQL of word matching (see `word-match.ts` for the rules, which this file repeats in SQL with
 * the same constants). Nothing here builds a pattern from the user's text: the query words are
 * compared with `=` and `starts_with`, never with LIKE or a regular expression, so `%`, `_`, `\`,
 * `[`, `(` and `.*` in a search are only separators and cannot match everything or fail. The only
 * regular expression is the fixed separator class, which cuts the stored text into words.
 */

/** The fixed regular expression that cuts a stored text into words (a bind parameter, never built from input). */
export const WORD_SEPARATOR_PATTERN = `[${WORD_SEPARATOR_CLASS}]+`;

const num = (value: number): Prisma.Sql => Prisma.raw(String(value));

/** Lower-cased words of a text expression, as `text[]`. */
export function wordsSql(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`regexp_split_to_array(lower(${text}), ${WORD_SEPARATOR_PATTERN}::text)`;
}

/**
 * Score in [0, 1] of the best term against one line (or one site name): the SQL twin of
 * `bestTermScore`. `terms` are normalised terms (words separated by single spaces);
 * `nameWords` and `otherWords` are SQL expressions for `text[]` columns in scope.
 */
export function termScoreSql(
  terms: readonly string[],
  nameWords: Prisma.Sql,
  otherWords: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`COALESCE((
    SELECT max(ts.score) FROM (
      SELECT CASE
          WHEN min(wg.g) = ${num(GRADE_NONE)} THEN 0
          WHEN min(wg.g) = ${num(GRADE_FUZZY)} THEN 0.25 * avg(wg.g) / 4
          ELSE 0.4 + 0.6 * (0.7 * (min(wg.g) - 2) / 2.0 + 0.3 * (avg(wg.g) - 2) / 2.0)
        END AS score
        FROM unnest(${terms}::text[]) AS t(term)
       CROSS JOIN LATERAL unnest(string_to_array(t.term, ' ')) AS qw(q)
       CROSS JOIN LATERAL (
         SELECT CASE
             WHEN qw.q = ANY(${nameWords}) THEN ${num(GRADE_NAME_WORD)}
             WHEN length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                  AND EXISTS (SELECT 1 FROM unnest(${nameWords}) nw WHERE starts_with(nw, qw.q))
               THEN ${num(GRADE_NAME_PREFIX)}
             WHEN qw.q = ANY(${otherWords})
                  OR (length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                      AND EXISTS (SELECT 1 FROM unnest(${otherWords}) ow WHERE starts_with(ow, qw.q)))
               THEN ${num(GRADE_OTHER)}
             WHEN length(qw.q) >= ${num(MIN_FUZZY_LENGTH)}
                  AND EXISTS (SELECT 1 FROM unnest(${nameWords} || ${otherWords}) fw
                               WHERE word_similarity(qw.q, fw) >= ${num(FUZZY_WORD_SIMILARITY)})
               THEN ${num(GRADE_FUZZY)}
             ELSE ${num(GRADE_NONE)}
           END AS g
       ) wg
       GROUP BY t.term
    ) ts), 0)::float8`;
}
