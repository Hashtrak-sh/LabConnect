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
      // pH is a short word, so it matches only the whole word "pH" (OQ-246): every site listed has
      // a pH line, and a pH line comes first (the best score; a site shows at most ten lines and
      // the order among equal scores is not fixed, so nothing else is assumed about the order).
      for (const item of result.items) {
        expect(
          item.matchedLines.some((line) => /(^|[^a-z])ph([^a-z]|$)/i.test(line.parameter.name)),
          item.site.name,
        ).toBe(true);
        expect(item.matchedLines[0]?.parameter.name, item.site.name).toMatch(/^pH/);
      }
      // "Phosphorus" and "Sulphuric anhydride" no longer bring labs in: of the bookable sites only
      // the two that really test pH are priced.
      const expected = [site('Faridabad'), site('Aravali')];
      expect(bookable(result).sort()).toEqual([...expected].sort());
      const priced = result.items.filter((item) => item.priceFromPaise !== null);
      // That two sites price the same test differently is checked on the seed itself
      // (demo-guide.test.ts); here every pH line that is shown has a price.
      const phPrices = priced.flatMap((item) =>
        item.matchedLines
          .filter((line) => line.parameter.name.startsWith('pH'))
          .map((line) => line.pricePaise),
      );
      for (const price of phPrices) expect(price).toBeGreaterThan(0n);
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
      // "TS" was once a substring of 181 of the 200 sites ("results", "tests", "constituents"...).
      expect(result.total).toBeLessThan(DEMO_SITE_COUNT / 2);
      expect(parameters(result).some((name) => name.startsWith('Tensile strength'))).toBe(true);
      const direct = await search({ q: 'tensile strength' });
      expect(direct.total).toBeGreaterThan(10);
      // AC-DIS-02: the abbreviation returns the same results as the spelled-out words
      expect(result.total).toBe(direct.total);
      expect(result.items.map((item) => item.site.labSiteId)).toEqual(
        direct.items.map((item) => item.site.labSiteId),
      );
    });

    it('tensile strength: no site is listed only because it tests another strength', async () => {
      const result = await search({ q: 'tensile strength' });
      expect(result.total).toBeGreaterThan(10);
      for (const item of result.items) {
        // every matched line has both words somewhere in its visible text (a parameter alias,
        // which a line does not show, may carry the word "tensile" instead)
        const onlyOtherStrengths = item.matchedLines.every((line) =>
          /^(compressive|flexural|bond|crushing|shear|impact) /i.test(line.parameter.name),
        );
        expect(onlyOtherStrengths, item.site.name).toBe(false);
      }
      // a typing mistake still finds them
      const typo = await search({ q: 'tensil strenght' });
      expect(typo.total).toBeGreaterThan(10);
      expect(parameters(typo).some((name) => name.startsWith('Tensile strength'))).toBe(true);
    });

    it('LED: only the sites with an LED lamp line, found as a whole word', async () => {
      const result = await search({ q: 'LED' });
      expect(result.total).toBeGreaterThan(5);
      expect(result.total).toBeLessThan(DEMO_SITE_COUNT / 2);
      for (const item of result.items) {
        expect(
          item.matchedLines.some((line) =>
            /\bLED\b/i.test(
              [line.product?.name, line.parameter.name, line.method?.name, line.methodText].join(' '),
            ),
          ),
          item.site.name,
        ).toBe(true);
      }
    });

    it('cement: many listed labs and the two bookable sites of Vasundhara, with prices', async () => {
      const result = await search({ q: 'cement' });
      expect(result.total).toBeGreaterThan(30);
      expect(bookable(result).sort()).toEqual([site('Faridabad'), site('Gurugram')].sort());
      const gurugram = result.items.find((item) => item.site.name === site('Gurugram'));
      expect(gurugram?.priceFromPaise).toBeGreaterThan(0n);
      // A test of a cement product comes before "Slump", which has only the alias "cement
      // concrete" (OQ-246: a line was first because of its Slump line). Lines of equal score and
      // the ten-line cut are not assumed: only the order of a better and a worse score.
      let compared = 0;
      for (const item of result.items) {
        const lines = item.matchedLines;
        const slump = lines.findIndex((line) => line.parameter.name === 'Slump');
        const cementTest = lines.findIndex((line) => /cement/i.test(line.product?.name ?? ''));
        if (slump >= 0 && cementTest >= 0) {
          compared += 1;
          expect(cementTest, item.site.name).toBeLessThan(slump);
        }
      }
      expect(compared).toBeGreaterThan(0); // some building-materials lab has both
      // The method is shown with the line. Looked for over all sites: one site shows at most ten
      // matched lines, in no fixed order among equal scores.
      const methods = (await search({ q: 'compressive strength cement' })).items.flatMap((item) =>
        item.matchedLines.map((line) => line.methodText),
      );
      expect(methods).toContain('IS 4031 (Part 6)');
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

    it('matches the beginning of a word, never the middle or the end', async () => {
      const tens = await search({ q: 'tens' });
      expect(parameters(tens).some((name) => name.startsWith('Tensile strength'))).toBe(true);
      const chlor = await search({ q: 'chlor' });
      expect(parameters(chlor).some((name) => name.startsWith('Chloride'))).toBe(true);
      for (const q of ['ensile', 'loride', 'mad', 'nar']) {
        expect((await search({ q })).total, q).toBe(0);
      }
      // a lab found by its name, by the beginning of a word of it
      const narmada = await search({ q: 'narm' });
      expect(narmada.total).toBeGreaterThan(0);
      for (const item of narmada.items) {
        expect(item.site.name).toMatch(/\bNarm/);
        expect(item.matchedLines).toEqual([]); // a name-only match shows no line
      }
    });

    it('takes %, _, \\, [, ( and .* as plain text: nothing is found by accident, nothing fails', async () => {
      for (const q of ['%', '_', '\\', '[', '(', '.*', '50%', 'a_b', '(((', '[a-z]', '\\d']) {
        const result = await search({ q });
        expect(result.total, q).toBe(0);
      }
      const plain = await search({ q: 'tensile' });
      const wrapped = await search({ q: '(tensile)%' });
      expect(wrapped.items.map((item) => item.site.labSiteId)).toEqual(
        plain.items.map((item) => item.site.labSiteId),
      );
    });

    it('a query of 200 characters, of Hindi text or of only short words does not fail', async () => {
      expect((await search({ q: 'a'.repeat(200) })).total).toBe(0);
      expect((await search({ q: 'तन्यता शक्ति' })).total).toBe(0);
      // only short words: whole words only, and all of them on one line, so (almost) nothing
      expect((await search({ q: 'is of in at' })).total).toBeLessThan(DEMO_SITE_COUNT / 10);
      expect((await search({ q: 't' })).total).toBe(0);
    });

    it('shows a lab only once, with the tests that matched', async () => {
      const result = await search({ q: 'drinking water' });
      expect(new Set(names(result)).size).toBe(result.items.length);
      for (const item of result.items) expect(item.matchedLines.length).toBeGreaterThan(0);
    });
  });
});
