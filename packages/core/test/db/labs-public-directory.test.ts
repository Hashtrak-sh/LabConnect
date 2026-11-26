import { describe, expect, it } from 'vitest';
import { LabDirectoryService } from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// I1-CUS-02: the public lab site profile, on the real schema and as the API's database role.
// It runs on the search world, so the profile's notion of "public site" is checked against the
// same sites the search conformance suite checks: every site search can find has a profile, and
// every site search must never show has none (the same answer as a missing site).

describe('LabDirectoryService.getPublicSite', () => {
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
});
