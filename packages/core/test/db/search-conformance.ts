import { beforeAll, describe, expect, it } from 'vitest';
import {
  SearchCursorError,
  deniedFieldPaths,
  haversineMetres,
  normaliseSearchQuery,
  type SearchIndex,
  type SearchPage,
  type SearchRequest,
} from '../../src/index.js';
import { P, type SearchWorld } from './search-support.js';

/**
 * The conformance suite: the scenarios every `SearchIndex` has to answer the same way. It runs
 * against `PostgresSearchIndex` (real database, real row-level security) and against
 * `InMemorySearchIndex` loaded from the projector, and would run against OpenSearch the same
 * (`search-opensearch.test.ts`, not part of the default run). Scenarios assert what the
 * documents require, not how a backend ranks: the sets of sites and lines, prices, distances
 * and paging, never an order of equal scores.
 */
export interface ConformanceContext {
  world: () => SearchWorld;
  asOf: () => Date;
  /** Builds the index to test (after the world exists). */
  make: () => Promise<SearchIndex>;
}

const ids = (page: SearchPage): string[] => page.items.map((item) => item.site.labSiteId);
const sorted = (values: string[]): string[] => [...values].sort();

export function defineSearchConformance(label: string, ctx: ConformanceContext): void {
  describe(`search conformance: ${label}`, () => {
    let index: SearchIndex;
    beforeAll(async () => {
      index = await ctx.make();
    }, 120_000);

    const run = (request: SearchRequest = {}): Promise<SearchPage> =>
      index.search(normaliseSearchQuery({ limit: 100, ...request }, ctx.asOf()));
    const w = (): SearchWorld => ctx.world();

    it('finds sites by the name of a test, and says which lines matched', async () => {
      const page = await run({ q: 'tensile strength' });
      expect(sorted(ids(page))).toEqual(sorted(w().visibleSiteIds));
      expect(page.total).toBe(w().visibleSiteIds.length);
      for (const item of page.items) {
        expect(item.matchedLineCount).toBe(1);
        expect(item.matchedLines.map((line) => line.parameter.name)).toEqual(['Tensile strength']);
      }
    });

    it('finds sites by the name of a product, and by its group', async () => {
      const page = await run({ q: 'TMT bar' });
      const a1 = page.items.find((item) => item.site.labSiteId === w().a1.id);
      expect(a1?.matchedLineCount).toBe(2);
      const a2 = page.items.find((item) => item.site.labSiteId === w().a2.id);
      expect(a2?.matchedLines.map((line) => line.parameter.name)).toEqual(['Tensile strength']);
      expect(page.items.some((item) => item.site.labSiteId === w().hidden.expired.id)).toBe(false);
    });

    it('tolerates a typo', async () => {
      const exact = await run({ q: 'tensile strength' });
      const typo = await run({ q: 'tensile strenght' });
      expect(sorted(ids(typo))).toEqual(sorted(ids(exact)));
    });

    describe('words, not letters (SEARCH.md section 3, Matching)', () => {
      const lineNames = (page: SearchPage): string[] =>
        page.items.flatMap((item) => item.matchedLines.map((line) => line.parameter.name));

      it('matches the beginning of a word of four letters or more, never the middle or the end', async () => {
        expect(lineNames(await run({ q: 'tens' })).length).toBeGreaterThan(0);
        expect(new Set(lineNames(await run({ q: 'chlor' })))).toEqual(
          new Set(['Chloride content']),
        );
        for (const q of ['loride', 'ride', 'ensile', 'ength', 'ulphat']) {
          expect((await run({ q })).items, q).toEqual([]);
        }
      });

      it('matches a word of three letters or fewer only as a whole word', async () => {
        for (const q of ['ten', 'ten', 'tm', 'cem', 'str', 'ts']) {
          expect((await run({ q })).items, q).toEqual([]);
        }
        // whole words: the product "TMT bar" and its words
        expect((await run({ q: 'tmt' })).items.length).toBeGreaterThan(0);
        expect((await run({ q: 'bar' })).items.length).toBeGreaterThan(0);
      });

      it('matches a site by the beginning of a word of its name, not by the middle', async () => {
        expect(sorted(ids(await run({ q: 'alph' })))).toEqual(sorted([w().a1.id, w().a2.id])); // Delhi and Noida
        expect(ids(await run({ q: 'Alpha Delhi' }))).toEqual([w().a1.id]);
        for (const q of ['lph', 'pha', 'alp', 'ravo', 'bra']) {
          expect((await run({ q })).items, q).toEqual([]);
        }
      });

      it('needs every word of the query on the line: strength alone is not tensile strength', async () => {
        const strength = lineNames(await run({ q: 'strength' }));
        expect(new Set(strength)).toEqual(new Set(['Tensile strength', 'Yield strength']));
        const tensile = await run({ q: 'tensile strength' });
        expect(new Set(lineNames(tensile))).toEqual(new Set(['Tensile strength']));
        // any order, and across texts: the product and the parameter
        expect(new Set(lineNames(await run({ q: 'strength tensile' })))).toEqual(
          new Set(['Tensile strength']),
        );
        expect(new Set(lineNames(await run({ q: 'yield tmt' })))).toEqual(
          new Set(['Yield strength']),
        );
        expect((await run({ q: 'hardness tensile' })).items).toEqual([]);
      });

      it('treats punctuation, brackets and case as separators', async () => {
        const plain = ids(await run({ q: 'tensile strength' }));
        for (const q of [
          '(Tensile) strength',
          'TENSILE/strength',
          'tensile-strength',
          ' tensile   strength.',
        ]) {
          expect(ids(await run({ q })), q).toEqual(plain);
        }
      });

      it('takes %, _, \\, [, ( and .* as plain text: no error, nothing matched by accident', async () => {
        for (const q of [
          '%',
          '_',
          '\\',
          '[',
          '(',
          '.*',
          '%%',
          'a%',
          '%%%%',
          '____',
          'te%t',
          '%ens',
          '_ _',
          '[a-z]',
          '\\d',
          '(((',
          '...',
          '*',
        ]) {
          const page = await run({ q });
          expect(page.items, q).toEqual([]);
          expect(page.total, q).toBe(0);
        }
        // ... and next to a real word they only separate it
        expect(ids(await run({ q: 'tens%' }))).toEqual(ids(await run({ q: 'tens' })));
        expect(ids(await run({ q: '.*tensile' }))).toEqual(ids(await run({ q: 'tensile' })));
      });

      it('forgives a typing mistake in a word of four letters or more, and not in a shorter one', async () => {
        expect(lineNames(await run({ q: 'chlorde' }))).toContain('Chloride content');
        expect(lineNames(await run({ q: 'tensile strenght' }))).toContain('Tensile strength');
        expect((await run({ q: 'tnsl' })).items).toEqual([]);
        expect((await run({ q: 'tmx' })).items).toEqual([]);
      });

      it('lists the best matching line first', async () => {
        // A1 has "Tensile strength" (the parameter) and "Yield strength" under the product "TMT bar":
        // for "tensile", the parameter line is the one that matches the name.
        const page = await run({ q: 'tensile' });
        for (const item of page.items) {
          expect(item.matchedLines[0]?.parameter.name).toBe('Tensile strength');
        }
      });
    });

    it('finds nothing for text that is nowhere', async () => {
      const page = await run({ q: 'zzzzqqqq' });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.nextCursor).toBeNull();
    });

    it('finds a site by its name, with no matched line (the contract: name-only match)', async () => {
      const page = await run({ q: 'bravo' });
      expect(ids(page)).toEqual([w().b.id]);
      const [item] = page.items;
      expect(item?.matchedLines).toEqual([]);
      expect(item?.matchedLineCount).toBe(0);
      // no matched line: the lowest price of the whole price list
      expect(item?.priceFromPaise).toBe(90_000n);
    });

    it('filters by discipline, parameter and method (taxonomy codes), and combines filters with AND', async () => {
      const chemical = await run({ discipline: 'SX_CHEMICAL' });
      expect(ids(chemical)).toEqual([w().a2.id]);
      expect(chemical.items[0]?.matchedLineCount).toBe(2);

      const tensile = await run({ parameter: 'SX_TENSILE' });
      expect(sorted(ids(tensile))).toEqual(sorted(w().visibleSiteIds));

      const method = await run({ method: w().methodCode });
      expect(ids(method)).toEqual([w().a1.id]);
      expect(method.items[0]?.matchedLines.map((line) => line.rangeText)).toEqual(['10-600 kN']);

      const none = await run({ discipline: 'SX_CHEMICAL', parameter: 'SX_TENSILE' });
      // A2 has a chloride line and a tensile line, but no line that is both.
      expect(none.items).toEqual([]);
    });

    it('prices a line only for a bookable site, and tatMax and priceMax only match priced lines', async () => {
      const w0 = w();
      const tat = await run({ tatMax: 5 });
      expect(sorted(ids(tat))).toEqual(sorted([w0.a1.id, w0.a2.id, w0.b.id, w0.noPin.id]));
      expect((await run({ tatMax: 4 })).items).toEqual([]);

      const cheap = await run({ priceMax: 95_000 });
      expect(ids(cheap)).toEqual([w0.b.id]);
      expect(cheap.items[0]?.matchedLines[0]?.pricePaise).toBe(90_000n);
      // The draft price list of A1 costs one paisa a line. It must never be found or shown.
      expect((await run({ priceMax: Number(w0.draftPricePaise) })).items).toEqual([]);
    });

    it('takes the price from the matched lines, not from the whole list', async () => {
      const page = await run({ q: 'yield strength', parameter: 'SX_YIELD' });
      const a1 = page.items.find((item) => item.site.labSiteId === w().a1.id);
      expect(a1?.matchedLineCount).toBe(1);
      // A1's cheapest line costs 1000 rupees, the yield line 1250.
      expect(a1?.priceFromPaise).toBe(125_000n);
      expect(a1?.minTatDays).toBe(5);
    });

    it('filters by lab category; a calibration site is found but never priced', async () => {
      const calibration = await run({ category: 'CALIBRATION' });
      expect(ids(calibration)).toEqual([w().calibration.id]);
      const [item] = calibration.items;
      expect(item?.priceFromPaise).toBeNull();
      expect(item?.minTatDays).toBeNull();
      expect(item?.nextSlotAt).toBeNull();
      expect(item?.matchedLines.every((line) => line.pricePaise === null)).toBe(true);

      const testing = await run({ category: 'TESTING' });
      expect(sorted(ids(testing))).toEqual(
        sorted(w().visibleSiteIds.filter((id) => id !== w().calibration.id)),
      );
    });

    it('lists listed-but-not-bookable sites without a price, a turnaround or a slot', async () => {
      const w0 = w();
      const page = await run({});
      const notBookable = [w0.c, w0.noPriceList, w0.kycPending, w0.calibration];
      for (const site of notBookable) {
        const item = page.items.find((entry) => entry.site.labSiteId === site.id);
        expect(item, site.name).toBeDefined();
        expect(item?.priceFromPaise).toBeNull();
        expect(item?.minTatDays).toBeNull();
        expect(item?.nextSlotAt).toBeNull();
      }
      for (const site of [w0.a1, w0.a2, w0.b, w0.noPin]) {
        const item = page.items.find((entry) => entry.site.labSiteId === site.id);
        expect(item?.priceFromPaise, site.name).not.toBeNull();
        expect(item?.nextSlotAt, site.name).not.toBeNull();
        expect(item?.site.listingStatus).toBe('BOOKABLE');
      }
      expect(page.items.find((entry) => entry.site.labSiteId === w0.c.id)?.site.listingStatus).toBe(
        'LISTED',
      );
    });

    it('never shows a site that must not be public (BR-002, BR-005, listing and organisation rules)', async () => {
      const everything = await run({});
      const shown = new Set(ids(everything));
      for (const [reason, site] of Object.entries(w().hidden)) {
        expect(shown.has(site.id), reason).toBe(false);
        // nor by its name
        const byName = await run({ q: site.name });
        expect(ids(byName), `${reason} by name`).not.toContain(site.id);
      }
      expect(sorted([...shown])).toEqual(sorted(w().visibleSiteIds));
      // an inactive scope line of a visible site is not a line of the site
      const lines = (await run({ discipline: 'SX_MECHANICAL' })).items.flatMap((item) =>
        item.matchedLines.map((line) => line.scopeLineId),
      );
      expect(lines).not.toContain(w().inactiveLineId);
      expect(w().visibleSiteIds).toContain(w().b.id);
    });

    it('measures distance from the approved pin, filters by radius, and leaves out sites without a pin', async () => {
      const w0 = w();
      const here = { lat: 28.61, lng: 77.21 };
      const within = async (radiusKm: number): Promise<SearchPage> =>
        run({ ...here, radiusKm, sort: 'distance' });

      const five = await within(5);
      expect(sorted(ids(five))).toEqual(
        sorted([w0.a1.id, w0.noPriceList.id, w0.kycPending.id, w0.calibration.id]),
      );
      expect(five.items[0]?.site.labSiteId).toBe(w0.a1.id);
      expect(five.items[0]?.distanceKm).toBeLessThan(0.1);

      const twentyFive = await within(25);
      expect(ids(twentyFive)).toEqual(expect.arrayContaining([w0.a2.id, w0.b.id, w0.c.id]));
      expect(ids(twentyFive)).not.toContain(w0.noPin.id);
      expect(ids(twentyFive)).not.toContain(w0.hidden.expired.id);
      const distances = twentyFive.items.map((item) => item.distanceKm ?? Number.NaN);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      for (const item of twentyFive.items) {
        const pin = item.site.location;
        if (!pin) throw new Error('a site within a radius has a pin');
        const expected = haversineMetres(here, pin) / 1000;
        expect(Math.abs((item.distanceKm ?? 0) - expected)).toBeLessThanOrEqual(
          expected * 0.01 + 0.01,
        );
      }

      // without a radius the site without a pin is still listed, last, with no distance
      const all = await run({ ...here });
      expect(all.items.at(-1)?.site.labSiteId).toBe(w0.noPin.id);
      expect(all.items.at(-1)?.distanceKm).toBeNull();
      expect(all.items.at(-1)?.site.location).toBeNull();
    });

    it('sorts by the price of the matched lines, unpriced sites last', async () => {
      const page = await run({ sort: 'price' });
      const prices = page.items.map((item) => item.priceFromPaise);
      expect(page.items[0]?.site.labSiteId).toBe(w().b.id);
      const firstUnpriced = prices.findIndex((price) => price === null);
      expect(prices.slice(firstUnpriced).every((price) => price === null)).toBe(true);
      const priced = prices.slice(0, firstUnpriced).map((price) => Number(price));
      expect(priced).toEqual([...priced].sort((a, b) => a - b));
    });

    it('pages without repeating or skipping a site, with the same total on every page', async () => {
      const whole = ids(await run({ q: 'strength' }));
      expect(whole.length).toBeGreaterThan(3);
      const collected: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await run({ q: 'strength', limit: 3, ...(cursor ? { cursor } : {}) });
        expect(page.total).toBe(whole.length);
        expect(page.items.length).toBeLessThanOrEqual(3);
        collected.push(...ids(page));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 20);
      expect(collected).toEqual(whole);
      expect(new Set(collected).size).toBe(collected.length);

      // the same by distance, which has its own sort key
      const near = { lat: 28.61, lng: 77.21, sort: 'distance' as const };
      const wholeNear = ids(await run({ ...near }));
      const collectedNear: string[] = [];
      cursor = undefined;
      do {
        const page = await run({ ...near, limit: 2, ...(cursor ? { cursor } : {}) });
        collectedNear.push(...ids(page));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(collectedNear).toEqual(wholeNear);
    });

    it('refuses a cursor it did not issue', async () => {
      await expect(run({ cursor: 'not-a-cursor' })).rejects.toBeInstanceOf(SearchCursorError);
      await expect(run({ cursor: 'pg1.%%%' })).rejects.toBeInstanceOf(SearchCursorError);
    });

    it('returns nothing that is on the deny-list of the public boundary', async () => {
      const page = await run({ q: 'tensile strength' });
      // Money is bigint here and the mapper makes it a number: only names matter.
      expect(deniedFieldPaths(page)).toEqual([]);
      expect(page.items[0]?.site.accreditations.length).toBeGreaterThan(0);
    });

    it('shows the accreditation of each result and the ratings as the aggregate only', async () => {
      const page = await run({ parameter: 'SX_HARDNESS' });
      const [item] = page.items;
      expect(ids(page)).toEqual([w().a1.id]);
      expect(item?.site.accreditations).toHaveLength(1);
      expect(item?.site.accreditations[0]).toMatchObject({
        certificateNo: w().a1.certificateNo,
        status: 'VALID',
        labCategory: 'TESTING',
        bodyCode: 'NABL',
      });
      expect(item?.site.ratingCount).toBe(0);
      expect(item?.site.ratingAverage).toBeNull();
      expect(w().a1.scopeLines[P.hardness]).toBeDefined();
    });
  });
}
