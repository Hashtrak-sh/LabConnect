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
const SEPARATORS = new RegExp(
  `[${WORD_SEPARATOR_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join('')}]+`,
  'u',
);

/** Every separator character, for `translate()` in SQL (the same set as the ranges above). */
export const WORD_SEPARATOR_CHARS = WORD_SEPARATOR_RANGES.map(([from, to]) =>
  Array.from({ length: to - from + 1 }, (_, index) => String.fromCodePoint(from + index)).join(''),
).join('');

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
export const GRADE_NAME_PREFIX = 3;
export const GRADE_NAME_WORD = 4;

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

/** Whether a word of at least `MIN_FUZZY_LENGTH` letters is one mistake away from a word of the text. */
function isNear(word: string, candidate: string): boolean {
  const allowed = word.length >= 8 ? 2 : 1;
  return editDistance(word, candidate) <= allowed;
}

/**
 * Grade of one query word against the words of a line: 4 whole word of the parameter name, 3
 * beginning of a word of the parameter name, 2 whole word or beginning of a word of any other text
 * of the line (aliases, product, group, discipline, method, standard, method text), 1 a typing
 * mistake against any word, 0 nothing.
 */
export function gradeWord(
  word: string,
  nameWords: readonly string[],
  otherWords: readonly string[],
): number {
  const prefixes = word.length >= MIN_PREFIX_LENGTH;
  if (nameWords.includes(word)) return GRADE_NAME_WORD;
  if (prefixes && nameWords.some((candidate) => candidate.startsWith(word))) {
    return GRADE_NAME_PREFIX;
  }
  if (
    otherWords.includes(word) ||
    (prefixes && otherWords.some((candidate) => candidate.startsWith(word)))
  ) {
    return GRADE_OTHER;
  }
  if (
    word.length >= MIN_FUZZY_LENGTH &&
    [...nameWords, ...otherWords].some((candidate) => isNear(word, candidate))
  ) {
    return GRADE_FUZZY;
  }
  return GRADE_NONE;
}

/**
 * Score of a term from the grades of its words, in [0, 1]; 0 when any word has no match (every
 * word of the query must match the line). Real matches (every grade 2 or more) score from 0.4 to
 * 1: the weakest grade counts most (70 %), the average the rest, so a line that matches every word
 * in the parameter name beats one that matches in the name only partly. A term in which any word
 * is only a typing mistake scores below 0.25 whatever the other words do, so it is always below
 * a real match. `matching-sql.ts` has the same formula.
 */
export function scoreGrades(grades: readonly number[]): number {
  if (grades.length === 0) return 0;
  const lowest = Math.min(...grades);
  if (lowest === GRADE_NONE) return 0;
  const average = grades.reduce((sum, grade) => sum + grade, 0) / grades.length;
  if (lowest === GRADE_FUZZY) return (0.25 * average) / 4;
  return 0.4 + 0.6 * ((0.7 * (lowest - 2)) / 2 + (0.3 * (average - 2)) / 2);
}

/** Best score of the terms (a text and its synonym expansions) against one line's words. */
export function bestTermScore(
  terms: readonly (readonly string[])[],
  nameWords: readonly string[],
  otherWords: readonly string[],
): number {
  let best = 0;
  for (const words of terms) {
    const score = scoreGrades(words.map((word) => gradeWord(word, nameWords, otherWords)));
    if (score > best) best = score;
  }
  return best;
}
