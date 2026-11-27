import { describe, expect, it } from 'vitest';
import { CoreError, TaxonomyDirectory } from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// I1-CUS-06: the public filter values, on the real schema and as the API's database role. The
// search world's catalogue lives in the SCOPE taxonomy: disciplines SX_MECHANICAL ("Mechanical")
// and SX_CHEMICAL ("Chemical"), with SX_METALS under SX_MECHANICAL.

describe('TaxonomyDirectory.listPublicNodes', () => {
  const { platform, clock } = useSearchWorld();
  const directory = (): TaxonomyDirectory =>
    new TaxonomyDirectory({ prisma: platform.api(), clock });
  const list = (
    code: string,
    query: Partial<{ parent: string; cursor: string; limit: number }> = {},
  ) =>
    directory().listPublicNodes(code, {
      parent: query.parent ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 100,
    });

  it('lists the top level of a taxonomy by name, with node types', async () => {
    const page = await list('SCOPE');
    const codes = page?.nodes.map((node) => node.code) ?? [];
    expect(codes).toEqual(expect.arrayContaining(['SX_MECHANICAL', 'SX_CHEMICAL']));
    const names = page?.nodes.map((node) => node.name) ?? [];
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(page?.nodes.find((node) => node.code === 'SX_MECHANICAL')).toEqual({
      code: 'SX_MECHANICAL',
      name: 'Mechanical',
      nodeType: 'DISCIPLINE',
      parentCode: null,
    });
  });

  it('lists the children of a parent', async () => {
    const page = await list('SCOPE', { parent: 'SX_MECHANICAL' });
    expect(page?.nodes.map((node) => node.code)).toContain('SX_METALS');
    expect(page?.nodes.every((node) => node.parentCode === 'SX_MECHANICAL')).toBe(true);
  });

  it('pages by name with a cursor', async () => {
    const all = (await list('SCOPE'))?.nodes ?? [];
    expect(all.length).toBeGreaterThan(1);
    const first = await list('SCOPE', { limit: 1 });
    const second = await list('SCOPE', { limit: 1, cursor: first?.nextCursor ?? '' });
    expect(second?.nodes[0]?.code).toBe(all[1]?.code);
  });

  it('has nothing for an unknown taxonomy or parent, and refuses a foreign cursor', async () => {
    expect(await list('NO_SUCH_TAXONOMY')).toBeNull();
    expect(await list('SCOPE', { parent: 'NO_SUCH_NODE' })).toBeNull();
    await expect(list('SCOPE', { cursor: 'sc1.abc' })).rejects.toBeInstanceOf(CoreError);
  });
});
