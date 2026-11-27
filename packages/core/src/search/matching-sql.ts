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
  WORD_SEPARATOR_CHARS,
} from './word-match.js';

/*
 * The SQL of word matching (see `word-match.ts` for the rules, which this file repeats in SQL with
 * the same constants).
 *
 * A stored text becomes a string of its words with a space at both ends: " total hardness as
 * caco3 " (separators are turned into spaces, so a run of them is a run of spaces). A query word
 * `q` is a whole word of it when " q " occurs in it, and the beginning of a word when " q" does.
 * Both are `position(... IN ...)`, a plain substring search. Nothing builds a LIKE pattern or a
 * regular expression from the user's text, so `%`, `_`, `\`, `[`, `(` and `.*` in a search are only
 * separators (the query is cut into words by `word-match.ts` first) and cannot match everything or
 * fail. The stored text is cut with `translate()` and fixed bind parameters.
 */

const num = (value: number): Prisma.Sql => Prisma.raw(String(value));

const SEPARATOR_BLANKS = ' '.repeat(WORD_SEPARATOR_CHARS.length);

/**
 * The words of a text expression, lower-cased, with every separator turned into a space and a
 * space at each end: `text`. Runs of separators stay runs of spaces, which the searches below
 * do not mind. `translate` over fixed bind parameters, not a regular expression: about ten times
 * faster, and nothing in it is built from the user's text.
 */
export function wordsSql(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(' ' || translate(lower(${text}), ${WORD_SEPARATOR_CHARS}::text, ${SEPARATOR_BLANKS}::text) || ' ')`;
}

/**
 * The `near` table the fuzzy grade reads: for each query word of four letters or more, the words
 * of the stored text (`source` gives text columns `w` of words as made by `wordsSql`) whose
 * `word_similarity` to it reaches `FUZZY_WORD_SIMILARITY`. Found once over the distinct words of
 * the data (a few thousand), so a line is checked against a handful of words, not by trigrams.
 */
export function nearWordsCte(terms: readonly string[], source: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`near AS MATERIALIZED (
      SELECT qw.q, array_agg(vw.w) AS words
        FROM (SELECT DISTINCT q
                FROM unnest(${terms}::text[]) AS t(term),
                     unnest(string_to_array(t.term, ' ')) AS q
               WHERE length(q) >= ${num(MIN_FUZZY_LENGTH)}) qw
        JOIN (SELECT DISTINCT u.word AS w
                FROM (${source}) s, unnest(string_to_array(s.w, ' ')) AS u(word)
               WHERE length(u.word) >= 3) vw
          ON word_similarity(qw.q, vw.w) >= ${num(FUZZY_WORD_SIMILARITY)}
       GROUP BY qw.q
    )`;
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
                  AND EXISTS (SELECT 1 FROM near n, unnest(n.words) nw
                               WHERE n.q = qw.q
                                 AND position(' ' || nw || ' ' IN ${nameWords} || ${otherWords}) > 0)
               THEN ${num(GRADE_FUZZY)}
             ELSE ${num(GRADE_NONE)}
           END AS g
       ) wg
       GROUP BY t.term
    ) ts), 0)::float8`;
}
