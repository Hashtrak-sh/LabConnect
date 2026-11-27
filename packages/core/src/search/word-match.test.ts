import { describe, expect, it } from 'vitest';
import {
  GRADE_FUZZY,
  GRADE_NAME_PREFIX,
  GRADE_NAME_WORD,
  GRADE_NONE,
  GRADE_OTHER,
  bestTermScore,
  gradeWord,
  normaliseTerm,
  queryWordLists,
  scoreGrades,
  splitWords,
} from './word-match.js';

describe('what a word is', () => {
  it.each([
    ['pH value', ['ph', 'value']],
    ['Tensile strength (UTS)', ['tensile', 'strength', 'uts']],
    ['UTS/YS ratio', ['uts', 'ys', 'ratio']],
    ['Total hardness (as CaCO3)', ['total', 'hardness', 'as', 'caco3']],
    ['E. coli', ['e', 'coli']],
    ['IS 3025 (Part 11)', ['is', '3025', 'part', '11']],
    ['Biochemical oxygen demand (BOD, 3 days at 27 °C)', [
      'biochemical',
      'oxygen',
      'demand',
      'bod',
      '3',
      'days',
      'at',
      '27',
      'c',
    ]],
    ['re-bend test', ['re', 'bend', 'test']],
    ['  TENSILE   strength  ', ['tensile', 'strength']],
    ['a_b', ['a', 'b']],
    ['50%', ['50']],
    ['[x]', ['x']],
    ['.*', []],
    ['\\', []],
    ['(((', []],
    ['', []],
    // letters and combining marks of other scripts stay inside a word
    ['प्रमाणित प्रयोगशाला', ['प्रमाणित', 'प्रयोगशाला']],
    ['जल। परीक्षण', ['जल', 'परीक्षण']],
    ['Café été', ['café', 'été']],
  ])('%s', (text, words) => {
    expect(splitWords(text)).toEqual(words);
  });

  it('normalises a term to its words, single-spaced', () => {
    expect(normaliseTerm('IS 3025 (Part 11)')).toBe('is 3025 part 11');
    expect(normaliseTerm('...')).toBe('');
    expect(queryWordLists(['ph', '(((', 'tensile strength'])).toEqual([
      ['ph'],
      ['tensile', 'strength'],
    ]);
  });
});

describe('the grade of a query word', () => {
  const name = splitWords('Tensile strength (UTS)');
  const other = splitWords('TMT reinforcement bars | Mechanical | IS 1608 | Phosphorus');

  it('whole word of the parameter name', () => {
    expect(gradeWord('tensile', name, other)).toBe(GRADE_NAME_WORD);
    expect(gradeWord('uts', name, other)).toBe(GRADE_NAME_WORD);
  });
  it('beginning of a word of the parameter name, for words of four letters or more', () => {
    expect(gradeWord('tens', name, other)).toBe(GRADE_NAME_PREFIX);
    expect(gradeWord('stre', name, other)).toBe(GRADE_NAME_PREFIX);
  });
  it('whole word or beginning of a word of any other text', () => {
    expect(gradeWord('tmt', name, other)).toBe(GRADE_OTHER);
    expect(gradeWord('reinf', other, name)).toBe(GRADE_NAME_PREFIX);
    expect(gradeWord('reinf', name, other)).toBe(GRADE_OTHER);
  });
  it('a short word matches a whole word only: pH is not Phosphorus, LED is not filled', () => {
    expect(gradeWord('ph', splitWords('Phosphorus (P)'), [])).toBe(GRADE_NONE);
    expect(gradeWord('ph', splitWords('pH value'), [])).toBe(GRADE_NAME_WORD);
    expect(gradeWord('led', splitWords('Filled volume'), splitWords('scheduled'))).toBe(GRADE_NONE);
    expect(gradeWord('led', splitWords('Colour of LED lamps'), [])).toBe(GRADE_NAME_WORD);
    expect(gradeWord('ts', splitWords('Tensile strength'), [])).toBe(GRADE_NONE);
    expect(gradeWord('mad', splitWords('Narmada'), [])).toBe(GRADE_NONE);
    // three letters is short, four is long
    expect(gradeWord('nar', splitWords('Narmada'), [])).toBe(GRADE_NONE);
    expect(gradeWord('narm', splitWords('Narmada'), [])).toBe(GRADE_NAME_PREFIX);
  });
  it('never the middle or the end of a word', () => {
    expect(gradeWord('sile', name, other)).toBe(GRADE_NONE);
    expect(gradeWord('ength', name, other)).toBe(GRADE_NONE);
    expect(gradeWord('phorus', name, splitWords('Phosphorus'))).toBe(GRADE_NONE);
    expect(gradeWord('sulph', splitWords('Sulphuric anhydride'), [])).toBe(GRADE_NAME_PREFIX);
  });
  it('a typing mistake only from four letters, and the weakest match', () => {
    expect(gradeWord('strenght', name, other)).toBe(GRADE_FUZZY);
    expect(gradeWord('tensil', name, other)).toBe(GRADE_NAME_PREFIX); // a prefix, not a mistake
    expect(gradeWord('pg', splitWords('pH'), [])).toBe(GRADE_NONE); // one edit away, but short
    expect(gradeWord('phh', splitWords('pH value'), [])).toBe(GRADE_NONE);
  });
});

describe('the score of a line', () => {
  const score = (term: string, name: string, other = ''): number =>
    bestTermScore([splitWords(term)], splitWords(name), splitWords(other));

  it('orders: name word, name prefix, other text, typing mistake', () => {
    const nameWord = score('hardness', 'Total hardness (as CaCO3)');
    const namePrefix = score('hard', 'Total hardness (as CaCO3)');
    const other = score('hardness', 'Brinell', 'Hardness of steel');
    const mistake = score('hardnes', 'Brinell', 'Hardness of steel') /* prefix */;
    const typo = score('hardnass', 'Total hardness (as CaCO3)');
    expect(nameWord).toBe(1);
    expect(nameWord).toBeGreaterThan(namePrefix);
    expect(namePrefix).toBeGreaterThan(other);
    expect(other).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
    expect(mistake).toBe(other);
  });

  it('a typing mistake is always below any real match, whatever the other words do', () => {
    const weakestReal = score('abcd efgh', 'x', 'abcd efgh'); // every word in other text
    const strongestTypo = score('tensile strenght', 'Tensile strength'); // one word exact, one a typo
    expect(strongestTypo).toBeGreaterThan(0);
    expect(strongestTypo).toBeLessThan(weakestReal);
    expect(scoreGrades([GRADE_NAME_WORD, GRADE_NAME_WORD, GRADE_FUZZY])).toBeLessThan(0.25);
    expect(scoreGrades([GRADE_OTHER])).toBe(0.4);
  });

  it('every word of the query must match: strength alone is not tensile strength', () => {
    expect(score('tensile strength', 'Compressive strength', 'Ordinary Portland cement')).toBe(0);
    expect(score('tensile strength', 'Tensile strength (UTS)')).toBe(1);
    // any order, and the words may be in different texts
    expect(score('strength tensile', 'Tensile strength')).toBe(1);
    expect(score('tensile strength', 'Strength', 'Tensile test')).toBeGreaterThan(0);
    expect(score('tensile strength', 'Strength', 'Tensile test')).toBeLessThan(1);
  });

  it('a line that matches the query in its name beats one that matches in its product', () => {
    const inName = score('cement', 'Setting time of cement');
    const inProduct = score('cement', 'Slump', 'Cement concrete');
    expect(inName).toBeGreaterThan(inProduct);
    expect(inProduct).toBeGreaterThan(0);
  });

  it('the best of the terms counts: a synonym expansion', () => {
    const terms = [splitWords('ts'), splitWords('tensile strength')];
    expect(bestTermScore(terms, splitWords('Tensile strength (UTS)'), [])).toBe(1);
    expect(bestTermScore(terms, splitWords('Total suspended solids (TSS)'), [])).toBe(0);
  });

  it('a query that is only punctuation matches nothing', () => {
    expect(bestTermScore(queryWordLists(['(((', '...']), splitWords('pH value'), [])).toBe(0);
  });
});
