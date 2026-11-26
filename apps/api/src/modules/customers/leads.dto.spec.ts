import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { parseLeadCreate } from './leads.dto.js';

// The lead body parser on its own. The HTTP behaviour is in test/public-leads.spec.ts; this covers
// the text cleaning, which must match the search's (`cleanText`).

function issues(body: unknown): string[] {
  try {
    parseLeadCreate(body);
    return [];
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return (error.errors ?? []).map((issue) => issue.path);
  }
}

describe('parseLeadCreate: search text', () => {
  it('cleans the text like the search does', () => {
    expect(parseLeadCreate({ kind: 'NO_RESULT', query: { q: '  ｃｅｍｅｎｔ   test ' } })).toEqual({
      kind: 'NO_RESULT',
      query: { q: 'cement test' },
      contactEmail: null,
    });
  });

  it('refuses control characters, and text that is empty once cleaned', () => {
    expect(issues({ kind: 'NO_RESULT', query: { q: 'ce\u0000ment' } })).toEqual(['query.q']);
    expect(issues({ kind: 'NO_RESULT', query: { q: '   ' } })).toEqual(['query.q']);
    expect(issues({ kind: 'NO_RESULT', query: { q: 'x'.repeat(201) } })).toEqual(['query.q']);
  });
});
