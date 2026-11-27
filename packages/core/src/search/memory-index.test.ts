import { describe, expect, it } from 'vitest';
import { searchDocument, siteUuid } from '../../test/support/search-documents.js';
import { InMemorySearchIndex } from './memory-index.js';
import { normaliseSearchQuery } from './query.js';
import type { SearchRequest } from './model.js';

const AT = new Date('2026-11-25T10:00:00Z');
const search = (index: InMemorySearchIndex, request: SearchRequest = {}) =>
  index.search(normaliseSearchQuery(request, AT));

describe('InMemorySearchIndex', () => {
  it('ignores an older projection of a document, and replaces a site exactly', async () => {
    const index = new InMemorySearchIndex();
    const current = searchDocument({ ratingCount: 3, projectedAt: '2026-11-25T10:00:00.000Z' });
    await index.upsertDocuments([current]);
    await index.upsertDocuments([
      { ...current, ratingCount: 1, projectedAt: '2026-11-25T09:00:00.000Z' },
    ]);
    expect(index.all()[0]?.ratingCount).toBe(3);

    const kept = searchDocument();
    await index.replaceSites([{ labSiteId: current.labSiteId, documents: [kept] }]);
    expect(index.all().map((doc) => doc.scopeLineId)).toEqual([kept.scopeLineId]);
    await index.replaceSites([{ labSiteId: current.labSiteId, documents: [] }]);
    expect(index.size).toBe(0);
  });

  it('lists site ids in order, after a given id', async () => {
    const index = new InMemorySearchIndex();
    await index.upsertDocuments([3, 1, 2].map((n) => searchDocument({ labSiteId: siteUuid(n) })));
    expect(await index.listSiteIds(null, 2)).toEqual([siteUuid(1), siteUuid(2)]);
    expect(await index.listSiteIds(siteUuid(2), 10)).toEqual([siteUuid(3)]);
  });

  it('judges the accreditation dates at the time of the query', async () => {
    const index = new InMemorySearchIndex();
    await index.upsertDocuments([searchDocument()]);
    expect((await search(index)).items).toHaveLength(1);
    const expired = normaliseSearchQuery({}, new Date('2028-01-01T00:00:00Z'));
    expect((await index.search(expired)).items).toEqual([]);
    const notYet = normaliseSearchQuery({}, new Date('2025-12-31T00:00:00Z'));
    expect((await index.search(notYet)).items).toEqual([]);
  });

  it('matches names, aliases, standards and the site, with a typo, and not unrelated text', async () => {
    const index = new InMemorySearchIndex();
    await index.upsertDocuments([searchDocument()]);
    for (const q of [
      'tensile',
      'rebar',
      'UTS',
      'IS 1608',
      'tmt bar',
      'tensile strenght',
      'alpha testing',
    ]) {
      expect((await search(index, { q })).items, q).toHaveLength(1);
    }
    for (const q of ['hardness', 'zinc coating']) {
      expect((await search(index, { q })).items, q).toHaveLength(0);
    }
    // short terms match whole words only (the rules and their examples: word-match.test.ts)
    expect((await search(index, { q: 'ts' })).items).toHaveLength(0);
  });
});
