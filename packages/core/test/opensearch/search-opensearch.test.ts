import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  OpenSearchSearchIndex,
  createOpenSearchClientProvider,
  type OpenSearchConfig,
} from '../../src/index.js';
import { defineSearchConformance } from '../db/search-conformance.js';
import { useSearchWorld } from '../db/search-support.js';

// P3-10: the OpenSearch adapter against a real OpenSearch, loaded from the real projector, held
// to the same conformance scenarios as the Postgres adapter. Not part of CI (see
// vitest.opensearch.config.ts).

describe('OpenSearchSearchIndex (real OpenSearch)', () => {
  const t = useSearchWorld();
  const url = inject('opensearchUrl');
  const config: OpenSearchConfig = {
    node: url,
    auth: { mode: 'none' },
    // one alias per run, so runs do not see each other's documents
    alias: `lc_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    version: 1,
    requestTimeoutMs: 10_000,
  };
  const index = new OpenSearchSearchIndex(createOpenSearchClientProvider(config), config);

  const refresh = async (): Promise<void> => {
    const response = await fetch(`${url}/${config.alias}/_refresh`, { method: 'POST' });
    expect(response.ok).toBe(true);
  };

  afterAll(async () => {
    await fetch(`${url}/${config.alias}_v1`, { method: 'DELETE' });
  });

  const load = async (): Promise<OpenSearchSearchIndex> => {
    await index.ensureIndex();
    await index.ensureIndex(); // idempotent
    const projection = await t.projected();
    const bySite = new Map<string, ReturnType<typeof projection.all>>();
    for (const doc of projection.all()) {
      bySite.set(doc.labSiteId, [...(bySite.get(doc.labSiteId) ?? []), doc]);
    }
    const result = await index.replaceSites(
      [...bySite.entries()].map(([labSiteId, documents]) => ({ labSiteId, documents })),
    );
    expect(result.failed).toEqual([]);
    await refresh();
    return index;
  };

  defineSearchConformance('OpenSearchSearchIndex', {
    world: t.world,
    asOf: t.asOf,
    make: load,
  });

  it('is healthy, and lists the sites it holds in id order', async () => {
    await load();
    expect(await index.isHealthy()).toBe(true);
    const listed = await index.listSiteIds(null, 100);
    expect(listed).toEqual([...t.world().visibleSiteIds].sort());
    expect(await index.listSiteIds(listed[0] ?? null, 100)).toEqual(listed.slice(1));
  });

  it('replaces a site, removes one that is gone, and ignores an older projection', async () => {
    await load();
    const { a1, b } = t.world();
    const projection = await t.projected();
    const [doc] = projection.all().filter((candidate) => candidate.labSiteId === a1.id);
    if (!doc) throw new Error('A1 is projected');
    await index.upsertDocuments([
      { ...doc, ratingCount: 77, projectedAt: '2020-01-01T00:00:00.000Z' },
    ]);
    await refresh();
    const page = await t.run(index, { parameter: 'SX_HARDNESS' });
    expect(page.items[0]?.site.ratingCount).toBe(0);

    await index.replaceSites([{ labSiteId: b.id, documents: [] }]);
    await refresh();
    expect((await t.run(index, {})).items.map((item) => item.site.labSiteId)).not.toContain(b.id);
    await index.replaceSites([{ labSiteId: b.id, documents: [] }]); // idempotent
    await index.deleteDocuments(['no-such-document']);
  });

  it('refuses unknown fields: a field the mapping does not declare cannot be indexed', async () => {
    await load();
    const response = await fetch(`${url}/${config.alias}/_doc/strict-check`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lab_org_id: 'x' }),
    });
    expect(response.status).toBe(400);
  });
});
