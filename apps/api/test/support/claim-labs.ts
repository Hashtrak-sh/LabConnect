// Unclaimed labs on demand for the lab claim tests (I1-LAB-01, I1-LAB-02): each call makes a listed
// lab with one site, so tests never share an organisation, a certificate number or an address.
import {
  createCatalogue,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  type LabContext,
  type LabFixture,
  type LabOptions,
  loadReference,
  seedReference,
} from '@labconnect/database/test-utils';
import { beforeAll } from 'vitest';
import type { useIdentityApp } from './identity-app.js';

type IdentityApp = ReturnType<typeof useIdentityApp>;

const PATIENT = { maxWait: 60_000, timeout: 10 * 60_000 };

export interface ClaimableLab {
  fixture: LabFixture;
  organisationId: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  certificateNo: string;
  /** The NABL address of the site, as stored (`null` when removed). */
  email: string | null;
}

export function useClaimLabs(t: IdentityApp, now: Date) {
  let context: LabContext | undefined;

  beforeAll(async () => {
    context = await t.owner(async (tx) => {
      await seedReference(tx);
      const reference = await loadReference(tx);
      const platform = await createPlatformTeam(tx);
      const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO claim http tests');
      const catalogue = await createCatalogue(tx, reference, changeSetId);
      return { reference, platform, catalogue, changeSetId };
    }, PATIENT);
  });

  /** A listed lab; `email` overrides the NABL address of its site (`null` removes it). */
  return async (options: LabOptions & { email?: string | null } = {}): Promise<ClaimableLab> => {
    if (!context) throw new Error('the claim labs are not ready');
    const ctx = context;
    const { email, ...labOptions } = options;
    const fixture = await t.owner(
      (tx) => createLab(tx, ctx, { onboarded: false, now, ...labOptions }),
      PATIENT,
    );
    const site = fixture.sites[0];
    if (!site) throw new Error('the lab has no site');
    if (email !== undefined) {
      await t
        .db()
        .query('UPDATE lab_site_private SET contact_email = $1 WHERE lab_site_id = $2', [
          email,
          site.id,
        ]);
    }
    const stored = await t
      .db()
      .query<{ contact_email: string | null }>(
        'SELECT contact_email FROM lab_site_private WHERE lab_site_id = $1',
        [site.id],
      );
    return {
      fixture,
      organisationId: fixture.organisationId,
      siteId: site.id,
      siteCode: site.siteCode,
      siteName: site.name,
      certificateNo: site.certificateNo,
      email: stored.rows[0]?.contact_email ?? null,
    };
  };
}
