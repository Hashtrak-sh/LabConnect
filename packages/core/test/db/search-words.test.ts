import { Prisma } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { splitWords } from '../../src/index.js';
import { wordsSql } from '../../src/search/matching-sql.js';
import { usePlatform } from './support.js';

// The words of a text are cut twice: in TypeScript (`splitWords`, for the query and the in-memory
// index) and in SQL (`wordsSql`, for the stored text). They must cut every text the same way, or
// a word would match in one backend and not in the other.

const TEXTS = [
  'pH value',
  'Tensile strength (UTS)',
  'UTS/YS ratio',
  'Total hardness (as CaCO3)',
  'E. coli',
  'IS 3025 (Part 11)',
  'Biochemical oxygen demand (BOD, 3 days at 27 °C)',
  're-bend test',
  'a_b',
  '50% [x] .* \\ (((',
  '  TENSILE   strength  ',
  'Café été',
  'प्रमाणित प्रयोगशाला। जल',
  '“quoted” – dash — and … ellipsis',
  'x×y÷z',
  'tab\tseparated',
  '',
];

describe('the words of a text, in SQL and in TypeScript', () => {
  const platform = usePlatform();

  it.each(TEXTS)('%j', async (text) => {
    const rows = await platform
      .owner()
      .$queryRaw<{ w: string }[]>(Prisma.sql`SELECT ${wordsSql(Prisma.sql`${text}::text`)} AS w`);
    const inSql = (rows[0]?.w ?? '').split(' ').filter((word) => word.length > 0);
    expect(inSql).toEqual(splitWords(text));
  });
});
