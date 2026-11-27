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
 * the same constants).
 *
 * A stored text becomes a string of its words, single-spaced, with a space at both ends:
 * " total hardness as caco3 ". A query word `q` is a whole word of it when " q " occurs in it, and
 * the beginning of a word when " q" does. Both are `position(... IN ...)`, a plain substring
 * search. Nothing builds a LIKE pattern or a regular expression from the user's text, so `%`, `_`,
 * `\`, `[`, `(` and `.*` in a search are only separators (the query is cut into words by
 * `word-match.ts` first) and cannot match everything or fail. The only regular expression is the
 * fixed separator class that cuts the stored text, passed as a bind parameter.
 */

/** The fixed regular expression that cuts a stored text into words (a bind parameter, never built from input). */
export const WORD_SEPARATOR_PATTERN = `[${WORD_SEPARATOR_CLASS}]+`;

const num = (value: number): Prisma.Sql => Prisma.raw(String(value));

/** The words of a text expression, lower-cased, single-spaced and with a space at each end: `text`. */
export function wordsSql(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(' ' || regexp_replace(lower(${text}), ${WORD_SEPARATOR_PATTERN}::text, ' ', 'g') || ' ')`;
}

/**
 * Score in [0, 1] of the best term against one line (or one site name): the SQL twin of
 * `bestTermScore`. `terms` are normalised terms (words separated by single spaces); `nameWords`
 * and `otherWords` are columns in scope made with `wordsSql`.
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
             WHEN position(' ' || qw.q || ' ' IN ${nameWords}) > 0 THEN ${num(GRADE_NAME_WORD)}
             WHEN length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                  AND position(' ' || qw.q IN ${nameWords}) > 0 THEN ${num(GRADE_NAME_PREFIX)}
             WHEN position(' ' || qw.q || ' ' IN ${otherWords}) > 0
                  OR (length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                      AND position(' ' || qw.q IN ${otherWords}) > 0) THEN ${num(GRADE_OTHER)}
             WHEN length(qw.q) >= ${num(MIN_FUZZY_LENGTH)}
                  -- cheap necessary condition first: no extent of the whole text is similar enough
                  AND word_similarity(qw.q, ${nameWords} || ${otherWords}) >= ${num(FUZZY_WORD_SIMILARITY)}
                  AND EXISTS (SELECT 1 FROM unnest(string_to_array(${nameWords} || ${otherWords}, ' ')) fw
                               WHERE fw <> '' AND word_similarity(qw.q, fw) >= ${num(FUZZY_WORD_SIMILARITY)})
               THEN ${num(GRADE_FUZZY)}
             ELSE ${num(GRADE_NONE)}
           END AS g
       ) wg
       GROUP BY t.term
    ) ts), 0)::float8`;
}
