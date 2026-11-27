import { describe, expect, it } from 'vitest';
import { LabDirectoryQueryError, LabDirectoryService } from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// I1-CUS-02: the public lab site profile, on the real schema and as the API's database role.
// It runs on the search world, so the profile's notion of "public site" is checked against the
// same sites the search conformance suite checks: every site search can find has a profile, and
// every site search must never show has none (the same answer as a missing site).

describe('LabDirectoryService (public read side)', () => {
  const { platform, clock, world } = useSearchWorld();
  const directory = (): LabDirectoryService =>
    new LabDirectoryService({ prisma: platform.api(), clock });

  it('has a profile for every site search can find', async () => {
    for (const siteId of world().visibleSiteIds) {
      const profile = await directory().getPublicSite(siteId);
      expect(profile, siteId).not.toBeNull();
      expect(profile?.labSiteId).toBe(siteId);
    }
  });

  it('has no profile for any site search must never show, nor for unknown or malformed ids', async () => {
    for (const [why, site] of Object.entries(world().hidden)) {
      expect(await directory().getPublicSite(site.id), why).toBeNull();
    }
    expect(await directory().getPublicSite('0190d6a2-7c4e-7a1b-9c3d-000000000000')).toBeNull();
    expect(await directory().getPublicSite('not-a-uuid')).toBeNull();
  });

  it('describes a bookable site: accreditation in force, approved pin, hours in IST', async () => {
    const { a1 } = world();
    const profile = await directory().getPublicSite(a1.id);
    expect(profile).toMatchObject({
      siteCode: a1.siteCode,
      name: a1.name,
      listingStatus: 'BOOKABLE',
      address: { city: 'Delhi', stateCode: 'DL' },
      accreditations: [
        { certificateNo: a1.certificateNo, status: 'VALID', labCategory: 'TESTING' },
      ],
    });
    expect(profile?.location?.lat).toBeCloseTo(28.61, 5);
    expect(profile?.location?.lng).toBeCloseTo(77.21, 5);
    expect(profile?.receivingHours.length).toBeGreaterThan(0);
    for (const window of profile?.receivingHours ?? []) {
      expect(window.weekday).toBeGreaterThanOrEqual(1);
      expect(window.weekday).toBeLessThanOrEqual(7);
      expect(window.opensAt).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(window.closesAt).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  it('shows a listed, not yet bookable site as LISTED, and no location without an approved pin', async () => {
    const { c, noPin } = world();
    expect(await directory().getPublicSite(c.id)).toMatchObject({ listingStatus: 'LISTED' });
    expect(await directory().getPublicSite(noPin.id)).toMatchObject({ location: null });
  });

  it('carries nothing beyond the public fields', async () => {
    const profile = await directory().getPublicSite(world().a1.id);
    expect(Object.keys(profile ?? {}).sort()).toEqual(
      [
        'accreditations',
        'address',
        'labSiteId',
        'listingStatus',
        'location',
        'name',
        'ratingAverage',
        'ratingCount',
        'receivingHours',
        'siteCode',
      ].sort(),
    );
  });

  // ---------------------------------------------------------------- scope (I1-CUS-03)

  const scope = (
    siteId: string,
    query: Partial<{ text: string; cursor: string; limit: number }> = {},
  ) =>
    directory().listPublicScope(siteId, {
      text: query.text ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 25,
    });
  const names = (page: Awaited<ReturnType<typeof scope>>): string[] =>
    (page?.lines ?? []).map((line) => line.parameter.name);

  it('lists the scope in tree order: product, then parameter, by name', async () => {
    const page = await scope(world().a1.id);
    // Mechanical > Metals > Aluminium sheet > Hardness, then TMT bar > Tensile, Yield.
    expect(names(page)).toEqual(['Hardness', 'Tensile strength', 'Yield strength']);
    expect(page?.nextCursor).toBeNull();
    expect(page?.lines.every((line) => line.certificateNo === world().a1.certificateNo)).toBe(true);
  });

  it('leaves out a scope line that is not active', async () => {
    const page = await scope(world().b.id);
    expect(page?.lines.map((line) => line.scopeLineId)).not.toContain(world().inactiveLineId);
    expect(page?.lines.length).toBeGreaterThan(0);
  });

  it('searches inside the scope with the lab search text rule, typos included', async () => {
    expect(names(await scope(world().a1.id, { text: 'tensile' }))).toEqual(['Tensile strength']);
    const typo = names(await scope(world().a1.id, { text: 'strenght' }));
    expect(typo).toContain('Tensile strength');
    expect(typo).not.toContain('Hardness');
    expect(names(await scope(world().a1.id, { text: 'chromatography' }))).toEqual([]);
  });

  it('pages with an opaque cursor, without gaps or repeats', async () => {
    const first = await scope(world().a1.id, { limit: 2 });
    expect(names(first)).toEqual(['Hardness', 'Tensile strength']);
    expect(first?.nextCursor).toEqual(expect.any(String));
    const second = await scope(world().a1.id, { limit: 2, cursor: first?.nextCursor ?? '' });
    expect(names(second)).toEqual(['Yield strength']);
    expect(second?.nextCursor).toBeNull();
  });

  it('refuses a cursor it did not issue', async () => {
    await expect(scope(world().a1.id, { cursor: 'pg1.abc' })).rejects.toBeInstanceOf(
      LabDirectoryQueryError,
    );
    await expect(
      scope(world().a1.id, { cursor: `sc1.${Buffer.from('[1,2]').toString('base64url')}` }),
    ).rejects.toBeInstanceOf(LabDirectoryQueryError);
  });

  it('has no scope for a site that is not public', async () => {
    for (const [why, site] of Object.entries(world().hidden)) {
      expect(await scope(site.id), why).toBeNull();
    }
  });

  // ---------------------------------------------------------------- prices (I1-CUS-04)

  const prices = (siteId: string, query: Partial<{ cursor: string; limit: number }> = {}) =>
    directory().listPublicPrices(siteId, {
      cursor: query.cursor ?? null,
      limit: query.limit ?? 25,
    });

  it('lists the effective published prices of a bookable site in tree order', async () => {
    const page = await prices(world().a1.id);
    expect(page?.items.map((item) => item.scopeLine.parameter.name)).toEqual([
      'Hardness',
      'Tensile strength',
      'Yield strength',
    ]);
    // A1's prices are 1000, 1250 and 1500 rupees for tensile, yield and hardness.
    expect(page?.items.map((item) => item.pricePaise)).toEqual([150_000n, 100_000n, 125_000n]);
    expect(page?.priceList.versionNo).toBeGreaterThanOrEqual(1);
    for (const item of page?.items ?? []) {
      expect(item.tatDays).toBeGreaterThanOrEqual(1);
      expect(item.sampleUnit.code.length).toBeGreaterThan(0);
    }
  });

  it('never shows the draft price list', async () => {
    const page = await prices(world().a1.id, { limit: 100 });
    expect(page?.items.map((item) => item.pricePaise)).not.toContain(world().draftPricePaise);
  });

  it('pages the price list with its own cursor', async () => {
    const first = await prices(world().a1.id, { limit: 2 });
    expect(first?.items).toHaveLength(2);
    const second = await prices(world().a1.id, { limit: 2, cursor: first?.nextCursor ?? '' });
    expect(second?.items.map((item) => item.scopeLine.parameter.name)).toEqual(['Yield strength']);
    expect(second?.nextCursor).toBeNull();
    // A scope cursor is not a price cursor.
    const scopePage = await scope(world().a1.id, { limit: 1 });
    await expect(
      prices(world().a1.id, { cursor: scopePage?.nextCursor ?? '' }),
    ).rejects.toBeInstanceOf(LabDirectoryQueryError);
  });

  it('has no price list for a site that is listed but not bookable', async () => {
    const { c, noPriceList, kycPending, calibration, hidden } = world();
    for (const [why, site] of Object.entries({
      c,
      noPriceList,
      kycPending,
      calibration,
      ...hidden,
    })) {
      expect(await prices(site.id), why).toBeNull();
    }
  });

  // ---------------------------------------------------------------- slots (I1-CUS-05)

  const slots = (
    siteId: string,
    query: Partial<{ discipline: string; cursor: string; limit: number }> = {},
  ) =>
    directory().listPublicSlots(siteId, {
      from: '2026-11-01',
      to: '2026-12-31',
      discipline: query.discipline ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit ?? 100,
    });

  it('lists the open future slots of a bookable site, by start', async () => {
    const page = await slots(world().a1.id);
    const ids = page?.slots.map((slot) => slot.slotId) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(world().a1.slotIds).toEqual(expect.arrayContaining(ids));
    const starts = page?.slots.map((slot) => slot.startsAt.getTime()) ?? [];
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    for (const slot of page?.slots ?? []) {
      expect(slot.startsAt.getTime()).toBeGreaterThan(clock.now().getTime());
      expect(slot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(slot).sort()).toEqual([
        'date',
        'discipline',
        'endsAt',
        'slotId',
        'startsAt',
      ]);
    }
  });

  it('pages slots with a cursor and keeps to the date range', async () => {
    const all = (await slots(world().a1.id))?.slots ?? [];
    if (all.length >= 2) {
      const first = await slots(world().a1.id, { limit: 1 });
      const second = await slots(world().a1.id, { limit: 1, cursor: first?.nextCursor ?? '' });
      expect(second?.slots[0]?.slotId).toBe(all[1]?.slotId);
    }
    const none = await directory().listPublicSlots(world().a1.id, {
      from: '2030-01-01',
      to: '2030-01-31',
      discipline: null,
      cursor: null,
      limit: 25,
    });
    expect(none?.slots).toEqual([]);
  });

  it('refuses an unknown discipline, and has no slots for a site that is not bookable', async () => {
    await expect(slots(world().a1.id, { discipline: 'NO_SUCH_DISCIPLINE' })).rejects.toBeInstanceOf(
      LabDirectoryQueryError,
    );
    const { c, kycPending, calibration } = world();
    for (const [why, site] of Object.entries({ c, kycPending, calibration })) {
      expect(await slots(site.id), why).toBeNull();
    }
  });

  // ---------------------------------------------------------------- paging edge cases (review of #58)
  // These change data, so they run last.

  it('pages through a scope line with a very long free-text method', async () => {
    const { a1 } = world();
    const line = a1.scopeLines[0];
    if (!line) throw new Error('a1 has scope lines');
    await platform.owner().$executeRaw`
      UPDATE scope_line SET method_node_id = NULL, method_text = ${'M'.repeat(800)}
       WHERE id = ${line.id}::uuid`;
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await scope(a1.id, { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...(page?.lines.map((l) => l.scopeLineId) ?? []));
      if (!page?.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect([...seen].sort()).toEqual(a1.scopeLines.map((l) => l.id).sort());
  });

  it('does not repeat a slot whose start has microseconds', async () => {
    const { a1 } = world();
    const before = (await slots(a1.id))?.slots.map((s) => s.slotId) ?? [];
    expect(before.length).toBeGreaterThan(1);
    await platform.owner().$executeRaw`
      UPDATE slot SET starts_at = starts_at + interval '123 microseconds'
       WHERE lab_site_id = ${a1.id}::uuid`;
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 50; i++) {
      const page = await slots(a1.id, { limit: 1, ...(cursor ? { cursor } : {}) });
      seen.push(...(page?.slots.map((s) => s.slotId) ?? []));
      if (!page?.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(before);
  });
});
