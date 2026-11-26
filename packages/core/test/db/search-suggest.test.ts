import { describe, expect, it } from 'vitest';
import { SearchQueryError, StaticSynonymSource, SuggestService } from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// I1-CUS-08: typeahead on the real schema, as the API's database role, on the search world.
// Suggestions come only from public scope lines and public sites, so the hidden labs of the
// world ("Hotel Hidden", "Sierra Suspended", "Mike Medical", ...) must never appear.

describe('SuggestService.suggest', () => {
  const { platform, clock } = useSearchWorld();
  const service = (synonyms = new Map<string, string[]>()): SuggestService =>
    new SuggestService({
      prisma: platform.api(),
      clock,
      synonyms: new StaticSynonymSource(synonyms),
    });

  it('suggests a parameter by the start of its name, best first', async () => {
    const suggestions = await service().suggest('tensile');
    expect(suggestions[0]).toEqual({
      kind: 'PARAMETER',
      label: 'Tensile strength',
      code: 'SX_TENSILE',
      labSiteId: null,
    });
  });

  it('suggests products, methods and lab sites too', async () => {
    expect(await service().suggest('cement')).toContainEqual(
      expect.objectContaining({ kind: 'PRODUCT', label: 'Cement' }),
    );
    expect(await service().suggest('IS 1608')).toContainEqual(
      expect.objectContaining({ kind: 'METHOD' }),
    );
    const sites = await service().suggest('alpha');
    expect(
      sites
        .filter((s) => s.kind === 'LAB_SITE')
        .map((s) => s.label)
        .sort(),
    ).toEqual(['Alpha Testing Delhi', 'Alpha Testing Noida']);
    expect(sites.every((s) => s.kind !== 'LAB_SITE' || s.labSiteId !== null)).toBe(true);
  });

  it('tolerates typos and applies the admin synonyms', async () => {
    expect((await service().suggest('strenght')).map((s) => s.label)).toContain('Tensile strength');
    const withSynonym = await service(new Map([['ts', ['tensile strength']]])).suggest('TS');
    expect(withSynonym.map((s) => s.label)).toContain('Tensile strength');
  });

  it('never suggests a lab that search must not show, and gives at most 10', async () => {
    for (const name of ['Hotel Hidden', 'Sierra Suspended', 'Mike Medical', 'Golf Orgsuspended']) {
      const labels = (await service().suggest(name)).map((s) => s.label);
      expect(
        labels.some((label) => label.startsWith(name)),
        name,
      ).toBe(false);
    }
    expect((await service().suggest('lab')).length).toBeLessThanOrEqual(10);
    expect(await service().suggest('chromatography')).toEqual([]);
  });

  it('refuses empty text', async () => {
    await expect(service().suggest('   ')).rejects.toBeInstanceOf(SearchQueryError);
  });
});
