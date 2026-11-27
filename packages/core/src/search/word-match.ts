/**
 * Word matching and line scoring (SEARCH.md section 3, "Matching"). This file is the executable
 * statement of the rules: the in-memory index uses it as it is, `PostgresSearchIndex` computes the
 * same grades and the same score in SQL (`matching-sql.ts`, with the same constants), and the
 * OpenSearch query (`opensearch-dsl.ts`) approximates it with clauses of graded weight.
 *
 * What a word is. Text is lower-cased and cut at every separator: white space, ASCII punctuation
 * and symbols (so brackets, hyphens, slashes, full stops and underscores separate words), the
 * Latin-1 punctuation and symbols, the general punctuation block, CJK punctuation and the
 * Devanagari danda. Letters, digits and combining marks of every script stay inside a word. So
 * "Tensile strength (UTS)" has the words tensile, strength, uts; "UTS/YS ratio" has uts, ys, ratio;
 * "E. coli" has e, coli; "IS 3025 (Part 11)" has is, 3025, part, 11; "Total hardness (as CaCO3)" has
 * total, hardness, as, caco3.
 *
 * How a query word matches. A word of at most `MIN_PREFIX_LENGTH - 1` characters matches only a
 * whole word. A longer one matches a whole word or the beginning of a word. Never the middle or the
 * end of a word. A word of `MIN_FUZZY_LENGTH` characters or more is also forgiven a typing mistake,
 * which is the weakest kind of match.
 */

/** The characters that separate words, as ranges of code points. */
export const WORD_SEPARATOR_RANGES: readonly (readonly [number, number])[] = [
  [0x01, 0x2f],
  [0x3a, 0x40],
  [0x5b, 0x60],
  [0x7b, 0xbf],
  [0xd7, 0xd7],
  [0xf7, 0xf7],
  [0x2000, 0x206f],
  [0x3000, 0x303f],
  [0x964, 0x965],
];

const hex = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;
/** The separators as a regular expression (`[...]+`), JavaScript and PostgreSQL alike (`\\uXXXX` escapes). */
export const WORD_SEPARATOR_REGEX_SOURCE = `[${WORD_SEPARATOR_RANGES.map(
  ([from, to]) => `${hex(from)}-${hex(to)}`,
).join('')}]+`;

const SEPARATORS = new RegExp(WORD_SEPARATOR_REGEX_SOURCE, 'u');

/** A query word shorter than this matches only a whole word. */
export const MIN_PREFIX_LENGTH = 4;
/** A query word at least this long is forgiven a typing mistake. */
export const MIN_FUZZY_LENGTH = 4;
/** `word_similarity` of a query word to a word of the text from which Postgres calls it a typing mistake. */
export const FUZZY_WORD_SIMILARITY = 0.6;

/** Grade of one query word against one line, best first. 0 is no match. */
export const GRADE_NONE = 0;
export const GRADE_FUZZY = 1;
export const GRADE_OTHER = 2;
export const GRADE_PRODUCT = 3;
export const GRADE_NAME_PREFIX = 4;
export const GRADE_NAME_WORD = 5;
/** The best grade; the scores below are relative to it. */
export const GRADE_MAX = GRADE_NAME_WORD;

/** The words of a text: lower-cased, cut at the separators, no empty words. */
export function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(SEPARATORS)
    .filter((word) => word.length > 0);
}

/** The words of a term (a query text or one of its synonym expansions). */
export const termWords = splitWords;

/** A term as the backends receive it: its words, single-spaced. Empty when it has no word. */
export function normaliseTerm(term: string): string {
  return splitWords(term).join(' ');
}

/** The terms of a query as lists of words; a term without a word (only punctuation) is dropped. */
export function queryWordLists(terms: readonly string[]): string[][] {
  return terms.map(splitWords).filter((words) => words.length > 0);
}

/** Edit distance between two words (insertions, deletions, substitutions). */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * Whether a word of at least `MIN_FUZZY_LENGTH` letters is a typing mistake of a word of the text:
 * the same first letter (so a word is never found by its tail: "loride" is not "chloride"), and
 * one edit away, two for words of eight letters or more. Postgres uses trigram similarity with
 * the same first letter and a length within two; the two agree on clear cases.
 */
function isNear(word: string, candidate: string): boolean {
  const allowed = word.length >= 8 ? 2 : 1;
  return word[0] === candidate[0] && editDistance(word, candidate) <= allowed;
}

/**
 * Grade of one query word against the words of a line, from the best: 5 whole word of the
 * parameter name, 4 beginning of a word of the parameter name, 3 whole word or beginning of a word
 * of the product's name, 2 whole word or beginning of a word of any other text of the line
 * (aliases, group, discipline, method, standard, method text), 1 a typing mistake against any word,
 * 0 nothing. The product's name stands above the rest of the third tier of SEARCH.md section 3 so
 * that "cement" lists a test of a cement product before "Slump", whose product only has the alias
 * "cement concrete".
 */
export function gradeWord(
  word: string,
  nameWords: readonly string[],
  otherWords: readonly string[],
  productWords: readonly string[] = [],
): number {
  const prefixes = word.length >= MIN_PREFIX_LENGTH;
  const found = (words: readonly string[]): boolean =>
    words.includes(word) || (prefixes && words.some((candidate) => candidate.startsWith(word)));
  if (nameWords.includes(word)) return GRADE_NAME_WORD;
  if (prefixes && nameWords.some((candidate) => candidate.startsWith(word))) {
    return GRADE_NAME_PREFIX;
  }
  if (found(productWords)) return GRADE_PRODUCT;
  if (found(otherWords)) return GRADE_OTHER;
  if (
    word.length >= MIN_FUZZY_LENGTH &&
    [...nameWords, ...productWords, ...otherWords].some((candidate) => isNear(word, candidate))
  ) {
    return GRADE_FUZZY;
  }
  return GRADE_NONE;
}

/**
 * Score of a term from the grades of its words, in [0, 1]; 0 when any word has no match (every
 * word of the query must match the line). Real matches (every grade `GRADE_OTHER` or more) score
 * from 0.4 to 1: the weakest grade counts most (70 %), the average the rest, so a line that matches
 * every word in the parameter name beats one that matches in the name only partly. A term in which
 * any word is only a typing mistake scores below 0.25 whatever the other words do, so it is always
 * below a real match. `matching-sql.ts` has the same formula.
 */
export function scoreGrades(grades: readonly number[]): number {
  if (grades.length === 0) return 0;
  const lowest = Math.min(...grades);
  if (lowest === GRADE_NONE) return 0;
  const average = grades.reduce((sum, grade) => sum + grade, 0) / grades.length;
  if (lowest === GRADE_FUZZY) return (0.25 * average) / GRADE_MAX;
  const span = GRADE_MAX - GRADE_OTHER;
  // 70 % of the weakest grade and 30 % of the average, as whole numbers so that the best is exactly 1
  return 0.4 + (0.6 * (7 * (lowest - GRADE_OTHER) + 3 * (average - GRADE_OTHER))) / (10 * span);
}

/** Best score of the terms (a text and its synonym expansions) against one line's words. */
export function bestTermScore(
  terms: readonly (readonly string[])[],
  nameWords: readonly string[],
  otherWords: readonly string[],
  productWords: readonly string[] = [],
): number {
  let best = 0;
  for (const words of terms) {
    const score = scoreGrades(
      words.map((word) => gradeWord(word, nameWords, otherWords, productWords)),
    );
    if (score > best) best = score;
  }
  return best;
}
