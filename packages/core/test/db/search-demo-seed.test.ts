import {
  DEMO_SITE_COUNT,
  demoGuide,
  seedDemo,
  seedReference,
} from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CachedSynonymSource,
  FixedClock,
  PostgresSearchIndex,
  PostgresSynonymSource,
  SearchService,
  type SearchRequest,
  type SearchResult,
} from '../../src/index.js';
import { usePlatform } from './support.js';

// The demo seed through the real search service: what a person typing in the search box of the
// demonstration finds (docs/05-integrations/SEARCH.md, AC-DIS-02). Unlike the other search tests,
// the world here is the one `seed:demo` makes.

const NOW = new Date('2026-11-25T10:00:00Z');

describe('search over the demo seed', () => {
  const platform = usePlatform();
  const clock = new FixedClock(new Date(NOW.getTime() + 3_600_000));
  let service: SearchService;

  beforeAll(async () => {
    await platform.owner().$transaction(
      async (tx) => {
        await seedReference(tx, { now: NOW });
        await seedDemo(tx, { now: NOW });
      },
      { maxWait: 60_000, timeout: 600_000 },
    );
    service = new SearchService({
      primary: null,
      fallback: new PostgresSearchIndex(platform.api()),
      clock,
      synonyms: new CachedSynonymSource(new PostgresSynonymSource(platform.api()), clock),
    });
  }, 600_000);

  const search = (request: SearchRequest): Promise<SearchResult> =>
    service.search({ limit: 100, ...request });
  const names = (result: SearchResult): string[] => result.items.map((item) => item.site.name);
  const parameters = (result: SearchResult): string[] =>
    result.items.flatMap((item) => item.matchedLines.map((line) => line.parameter.name));
  const bookable = (result: SearchResult): string[] =>
    result.items.filter((item) => item.priceFromPaise !== null).map((item) => item.site.name);
  const site = (fragment: string): string => {
    const found = demoGuide().bookableSites.find((entry) => entry.name.includes(fragment));
    if (!found) throw new Error(`no bookable site ${fragment}`);
    return found.name;
  };

  describe('the terms of the printed guide', () => {
    it('pH: many labs, two bookable sites with their own prices and turnaround, a filter that narrows', async () => {
      const result = await search({ q: 'pH' });
      expect(result.total).toBeGreaterThan(30);
      // A short term matches by substring, so Gurugram ("sulphuric anhydride") is also listed;
      // the two sites that really have a pH line are the ones to compare (see the report: OQ-246).
      const priced = result.items.filter(
        (item) =>
          item.priceFromPaise !== null &&
          item.matchedLines.some((line) => line.parameter.name.startsWith('pH')),
      );
      expect(priced.map((item) => item.site.name).sort()).toEqual(
        [site('Faridabad'), site('Aravali')].sort(),
      );
      const phPrices = priced.map(
        (item) =>
          item.matchedLines.find((line) => line.parameter.name.startsWith('pH'))?.pricePaise,
      );
      expect(phPrices[0]).not.toBe(phPrices[1]);
      for (const item of priced) {
        expect(item.minTatDays).toBeGreaterThanOrEqual(1);
        expect(new Date(item.nextSlotAt ?? 0).getTime()).toBeGreaterThan(NOW.getTime());
      }
      const narrowed = await search({ q: 'pH', tatMax: 3 });
      expect(narrowed.total).toBeGreaterThan(0);
      expect(narrowed.total).toBeLessThan(result.total);
      const cheap = await search({ q: 'pH', priceMax: 40_000 });
      expect(cheap.total).toBeLessThan(result.total);
    });

    it('TS: the synonym for tensile strength (AC-DIS-02)', async () => {
      const result = await search({ q: 'TS' });
      expect(result.total).toBeGreaterThan(10);
      expect(parameters(result).some((name) => name.startsWith('Tensile strength'))).toBe(true);
      const direct = await search({ q: 'tensile strength' });
      expect(direct.total).toBeGreaterThan(10);
      // every lab of the spelled-out search is found by the abbreviation too
      const abbreviated = new Set(result.items.map((item) => item.site.labSiteId));
      const bigger = await search({ q: 'tensile strength', limit: 100 });
      for (const item of bigger.items.slice(0, 20))
        expect(abbreviated.has(item.site.labSiteId)).toBe(true);
    });

    it('cement: many listed labs and the two bookable sites of Vasundhara, with prices', async () => {
      const result = await search({ q: 'cement' });
      expect(result.total).toBeGreaterThan(30);
      expect(bookable(result).sort()).toEqual([site('Faridabad'), site('Gurugram')].sort());
      const gurugram = result.items.find((item) => item.site.name === site('Gurugram'));
      const lines = (await search({ q: 'compressive strength cement' })).items.find(
        (item) => item.site.name === site('Gurugram'),
      );
      expect(gurugram?.priceFromPaise).toBeGreaterThan(0n);
      expect(lines?.matchedLines.some((line) => line.methodText === 'IS 4031 (Part 6)')).toBe(true);
    });

    it('aflatoxin: a test that one lab offers', async () => {
      const result = await search({ q: 'aflatoxin' });
      expect(names(result)).toEqual([site('Aravali')]);
      expect(result.items[0]?.priceFromPaise).toBeGreaterThan(0n);
    });

    it('ceiling fan: labs that are listed but not on LabConnect yet, with no price', async () => {
      const result = await search({ q: 'ceiling fan' });
      expect(result.total).toBeGreaterThan(5);
      expect(bookable(result)).toEqual([]);
      expect(result.items.every((item) => item.site.listingStatus === 'LISTED')).toBe(true);
      expect(result.items.every((item) => item.nextSlotAt === null)).toBe(true);
    });

    it('radioactivity: no lab, so the request-a-lab path', async () => {
      expect((await search({ q: 'radioactivity' })).total).toBe(0);
      expect((await search({ q: 'gross alpha activity' })).total).toBe(0);
    });
  });

  describe('aliases and synonyms', () => {
    it.each([
      ['TDS', 'Total dissolved solids'],
      ['BOD', 'Biochemical oxygen demand'],
      ['COD', 'Chemical oxygen demand'],
      ['hardness', 'Total hardness'],
      ['UTS', 'Tensile strength'],
      ['LOI', 'Loss on ignition'],
      ['MFR', 'Melt flow rate'],
      ['HMF', 'Hydroxymethylfurfural'],
      ['Blaine', 'Fineness by Blaine'],
      ['sieve analysis', 'Sieve analysis'],
      ['E. coli', 'Escherichia coli'],
      ['curcumin', 'Curcumin'],
      ['CRI', 'Colour rendering index'],
    ])('%s finds %s', async (term, parameter) => {
      const result = await search({ q: term });
      expect(result.total, term).toBeGreaterThan(0);
      expect(
        parameters(result).some((name) => name.startsWith(parameter)),
        term,
      ).toBe(true);
    });

    it.each([
      ['TMT', 'TMT reinforcement bars'],
      ['rebar', 'TMT reinforcement bars'],
      ['IS 1786', 'TMT reinforcement bars'],
      ['OPC', 'Ordinary Portland cement'],
      ['borewell', 'Ground water'],
      ['sand', 'Fine aggregate'],
      ['HDPE', 'HDPE pipes'],
    ])('%s finds the product %s', async (term, product) => {
      const result = await search({ q: term });
      expect(result.total, term).toBeGreaterThan(0);
      const products = result.items.flatMap((item) =>
        item.matchedLines.map((line) => line.product?.name ?? ''),
      );
      expect(
        products.some((name) => name.startsWith(product)),
        term,
      ).toBe(true);
    });

    it('finds a test by the standard that covers it', async () => {
      const result = await search({ q: 'IS 3025 (Part 11)' });
      expect(result.total).toBeGreaterThan(20);
      expect(parameters(result).some((name) => name.startsWith('pH'))).toBe(true);
      expect((await search({ q: 'IS 4031' })).total).toBeGreaterThan(20);
    });
  });

  describe('what a person typing the obvious terms finds', () => {
    it.each([
      'pH',
      'TDS',
      'total hardness',
      'chloride',
      'cement',
      'TMT',
      'tensile strength',
      'compressive strength',
      'sieve analysis',
      'coliform',
      'BOD',
      'acid value',
      'LED',
      'moisture',
      'water',
    ])('%s finds labs', async (term) => {
      const result = await search({ q: term });
      expect(result.total, term).toBeGreaterThan(0);
      expect(result.total, term).toBeLessThanOrEqual(DEMO_SITE_COUNT);
    });

    it('does not show a food lab for a building-materials test, or the other way round', async () => {
      const cement = await search({ q: 'compressive strength cement' });
      expect(names(cement).some((name) => /Food/.test(name))).toBe(false);
      const milk = await search({ q: 'milk powder' });
      expect(milk.total).toBeGreaterThan(5);
      expect(names(milk).some((name) => /Materials|Civil|Construction/.test(name))).toBe(false);
    });

    it('shows a lab only once, with the tests that matched', async () => {
      const result = await search({ q: 'drinking water' });
      expect(new Set(names(result)).size).toBe(result.items.length);
      for (const item of result.items) expect(item.matchedLines.length).toBeGreaterThan(0);
    });
  });
});
