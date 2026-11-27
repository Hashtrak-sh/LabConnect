import { Prisma } from '@labconnect/database';
import {
  FUZZY_WORD_SIMILARITY,
  GRADE_FUZZY,
  GRADE_MAX,
  GRADE_NAME_PREFIX,
  GRADE_NAME_WORD,
  GRADE_NONE,
  GRADE_OTHER,
  GRADE_PRODUCT,
  MIN_FUZZY_LENGTH,
  MIN_PREFIX_LENGTH,
  WORD_SEPARATOR_REGEX_SOURCE,
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
 * fail. Only the stored texts are cut by a regular expression, a fixed one.
 */

const num = (value: number): Prisma.Sql => Prisma.raw(String(value));

/** The regular expression that cuts a stored text at its separators (fixed: nothing in it comes from a request). */
export const WORD_SEPARATOR_PATTERN = WORD_SEPARATOR_REGEX_SOURCE;

/**
 * The words of a text expression, lower-cased, with every run of separators turned into one space
 * and a space at each end: `text`. A fixed regular expression passed as a bind parameter (the same
 * ranges as `splitWords`), applied to the stored texts only, never to the user's text, and only to
 * each distinct text once (`wt` in `postgres-index.ts`).
 */
export function wordsSql(text: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(' ' || regexp_replace(lower(${text}), ${WORD_SEPARATOR_PATTERN}::text, ' ', 'g') || ' ')`;
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
          ON left(vw.w, 1) = left(qw.q, 1)
         AND abs(length(vw.w) - length(qw.q)) <= 2
         AND word_similarity(qw.q, vw.w) >= ${num(FUZZY_WORD_SIMILARITY)}
       GROUP BY qw.q
    )`;
}

/** The three texts a line is matched against, as columns made with `wordsSql`. */
export interface WordColumns {
  /** The parameter's name. */
  name: Prisma.Sql;
  /** The product's name. */
  product: Prisma.Sql;
  /** Every other text of the line. */
  other: Prisma.Sql;
}

/**
 * Score in [0, 1] of the best term against one line (or one site name): the SQL twin of
 * `bestTermScore`. `terms` are normalised terms (words separated by single spaces).
 */
export function termScoreSql(terms: readonly string[], columns: WordColumns): Prisma.Sql {
  const { name, product, other } = columns;
  const span = GRADE_MAX - GRADE_OTHER;
  return Prisma.sql`COALESCE((
    SELECT max(ts.score) FROM (
      SELECT CASE
          WHEN min(wg.g) = ${num(GRADE_NONE)} THEN 0
          WHEN min(wg.g) = ${num(GRADE_FUZZY)} THEN 0.25 * avg(wg.g) / ${num(GRADE_MAX)}
          ELSE 0.4 + 0.6 * (7 * (min(wg.g) - ${num(GRADE_OTHER)})
                            + 3 * (avg(wg.g) - ${num(GRADE_OTHER)})) / (10 * ${num(span)}.0)
        END AS score
        FROM unnest(${terms}::text[]) AS t(term)
       CROSS JOIN LATERAL unnest(string_to_array(t.term, ' ')) AS qw(q)
       CROSS JOIN LATERAL (
         SELECT CASE
             WHEN position(' ' || qw.q || ' ' IN ${name}) > 0 THEN ${num(GRADE_NAME_WORD)}
             WHEN length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                  AND position(' ' || qw.q IN ${name}) > 0 THEN ${num(GRADE_NAME_PREFIX)}
             WHEN position(' ' || qw.q || ' ' IN ${product}) > 0
                  OR (length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                      AND position(' ' || qw.q IN ${product}) > 0) THEN ${num(GRADE_PRODUCT)}
             WHEN position(' ' || qw.q || ' ' IN ${other}) > 0
                  OR (length(qw.q) >= ${num(MIN_PREFIX_LENGTH)}
                      AND position(' ' || qw.q IN ${other}) > 0) THEN ${num(GRADE_OTHER)}
             WHEN length(qw.q) >= ${num(MIN_FUZZY_LENGTH)}
                  AND EXISTS (SELECT 1 FROM near n, unnest(n.words) nw
                               WHERE n.q = qw.q
                                 AND position(' ' || nw || ' ' IN ${name} || ${product} || ${other}) > 0)
               THEN ${num(GRADE_FUZZY)}
             ELSE ${num(GRADE_NONE)}
           END AS g
       ) wg
       GROUP BY t.term
    ) ts), 0)::float8`;
}
