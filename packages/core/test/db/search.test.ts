import { describe, expect, it } from 'vitest';
import {
  CachedSynonymSource,
  PostgresSynonymSource,
  SearchService,
  buildLabSearchDocuments,
  deniedFieldPaths,
  normaliseSearchQuery,
  withPublicReadContext,
} from '../../src/index.js';
import { defineSearchConformance } from './search-conformance.js';
import { failure } from './support.js';
import { useSearchWorld } from './search-support.js';

// P3-10: public search on the real schema, connected as the API role (anonymous, read-only) and,
// for the projector, as the worker role.

describe('search (database)', () => {
  const t = useSearchWorld();

  defineSearchConformance('PostgresSearchIndex', {
    world: t.world,
    asOf: t.asOf,
    make: () => Promise.resolve(t.postgres()),
  });
  defineSearchConformance('projection in an InMemorySearchIndex', {
    world: t.world,
    asOf: t.asOf,
    make: t.projected,
  });

  it('runs as an anonymous visitor: no tenant row, no draft price list, no contact details, no writes', async () => {
    const seen = await withPublicReadContext(t.platform.api(), async (tx) => {
      const rows = async (query: Promise<{ n: bigint }[]>): Promise<number> =>
        Number((await query)[0]?.n ?? -1n);
      return {
        privateSite: await rows(tx.$queryRaw`SELECT count(*) AS n FROM lab_site_private`),
        privateOrg: await rows(tx.$queryRaw`SELECT count(*) AS n FROM organisation_private`),
        drafts: await rows(
          tx.$queryRaw`SELECT count(*) AS n FROM price_list WHERE status = 'DRAFT'`,
        ),
        draftItems: await rows(
          tx.$queryRaw`SELECT count(*) AS n FROM price_item WHERE price_paise = ${t.world().draftPricePaise}::bigint`,
        ),
        users: await rows(tx.$queryRaw`SELECT count(*) AS n FROM app_user`),
        sites: await rows(tx.$queryRaw`SELECT count(*) AS n FROM lab_site`),
        published: await rows(
          tx.$queryRaw`SELECT count(*) AS n FROM price_list WHERE status = 'PUBLISHED'`,
        ),
      };
    });
    expect(seen.privateSite).toBe(0);
    expect(seen.privateOrg).toBe(0);
    expect(seen.drafts).toBe(0);
    expect(seen.draftItems).toBe(0);
    expect(seen.users).toBe(0);
    expect(seen.sites).toBeGreaterThan(0);
    expect(seen.published).toBeGreaterThan(0);

    // read-only: SQLSTATE 25006
    const write = await failure(() =>
      withPublicReadContext(
        t.platform.api(),
        (tx) => tx.$executeRaw`UPDATE lab_site SET name = name`,
      ),
    );
    expect(write.state).toBe('25006');
  });

  it('projects exactly the lines that Postgres search finds, for every visible site', async () => {
    const projected = await t.projected();
    const docIds = new Map<string, string[]>();
    for (const doc of projected.all()) {
      docIds.set(doc.labSiteId, [...(docIds.get(doc.labSiteId) ?? []), doc.scopeLineId]);
    }
    const found = new Map<string, string[]>();
    for (const discipline of ['SX_MECHANICAL', 'SX_CHEMICAL']) {
      const page = await t.run(t.postgres(), { discipline });
      for (const item of page.items) {
        found.set(item.site.labSiteId, [
          ...(found.get(item.site.labSiteId) ?? []),
          ...item.matchedLines.map((line) => line.scopeLineId),
        ]);
      }
    }
    expect([...docIds.keys()].sort()).toEqual([...found.keys()].sort());
    for (const [siteId, lines] of docIds) {
      expect((found.get(siteId) ?? []).sort(), siteId).toEqual([...lines].sort());
    }
  });

  it('projects documents with public data only, and nothing from a draft price list', async () => {
    const projected = await t.projected();
    const docs = projected.all();
    expect(docs.length).toBeGreaterThan(10);
    for (const doc of docs) {
      expect(deniedFieldPaths(doc), doc.scopeLineId).toEqual([]);
      expect(doc.pricePaise === null || doc.pricePaise > t.world().draftPricePaise).toBe(true);
    }
    // bookable sites carry price, turnaround and next slot; the others carry none
    const byId = new Map(docs.map((doc) => [doc.labSiteId, doc]));
    expect(byId.get(t.world().a1.id)).toMatchObject({
      isBookable: true,
      listingStatus: 'BOOKABLE',
    });
    expect(byId.get(t.world().c.id)).toMatchObject({
      isBookable: false,
      pricePaise: null,
      tatDays: null,
      nextSlotAt: null,
    });
    expect(byId.get(t.world().noPriceList.id)).toMatchObject({
      isBookable: false,
      pricePaise: null,
    });
    expect(byId.get(t.world().kycPending.id)).toMatchObject({
      isBookable: false,
      pricePaise: null,
    });
    expect(byId.get(t.world().noPin.id)?.location).toBeNull();
    expect(byId.get(t.world().a1.id)?.location).toEqual({ lat: 28.61, lng: 77.21 });
  });

  it('judges accreditation validity at the time of the query (EC-01: removed at once)', async () => {
    const index = t.postgres();
    const before = await t.run(index, { parameter: 'SX_HARDNESS' });
    expect(before.items.map((item) => item.site.labSiteId)).toEqual([t.world().a1.id]);
    // 600 days later every certificate of the fixtures is past its valid_to
    const later = new Date(t.asOf().getTime() + 600 * 86_400_000);
    const page = await index.search(normaliseSearchQuery({ parameter: 'SX_HARDNESS' }, later));
    expect(page.items).toEqual([]);
  });

  it('expands an admin-managed synonym, through the service, the same for both backends (AC-DIS-02)', async () => {
    await t.platform
      .db()
      .query(
        `INSERT INTO search_synonym (id, term, expands_to, status) VALUES (gen_random_uuid(), 'TS', ARRAY['tensile strength'], 'ACTIVE')`,
      );
    const synonyms = new CachedSynonymSource(new PostgresSynonymSource(t.platform.api()), t.clock);
    expect((await synonyms.load()).get('ts')).toEqual(['tensile strength']);
    const service = new SearchService({
      primary: await t.projected(),
      fallback: t.postgres(),
      clock: t.clock,
      synonyms,
    });
    const viaMemory = await service.search({ q: 'TS', limit: 100 });
    expect(viaMemory.backend).toBe('memory');
    expect(viaMemory.items.length).toBe(t.world().visibleSiteIds.length);

    const onlyPostgres = new SearchService({
      primary: null,
      fallback: t.postgres(),
      clock: t.clock,
      synonyms,
    });
    const viaPostgres = await onlyPostgres.search({ q: 'ts', limit: 100 });
    expect(viaPostgres.backend).toBe('postgres');
    expect(viaPostgres.items.map((item) => item.site.labSiteId).sort()).toEqual(
      viaMemory.items.map((item) => item.site.labSiteId).sort(),
    );
    // without the synonym the two letters find nothing
    expect((await t.run(t.postgres(), { q: 'ts' })).items).toEqual([]);
  });

  it('runs the projector as the worker role without the system context', async () => {
    const result = await withPublicReadContext(t.platform.worker(), (tx) =>
      buildLabSearchDocuments(
        tx,
        { labSiteIds: [t.world().a1.id, t.world().hidden.expired.id] },
        t.asOf(),
      ),
    );
    expect(result.sites).toHaveLength(2);
    expect(result.sites.find((site) => site.labSiteId === t.world().a1.id)?.documents).toHaveLength(
      3,
    );
    expect(
      result.sites.find((site) => site.labSiteId === t.world().hidden.expired.id)?.documents,
    ).toEqual([]);
  });
});
