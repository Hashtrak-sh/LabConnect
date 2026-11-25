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
});
