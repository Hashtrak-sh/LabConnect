import { randomUUID } from 'node:crypto';
import type { Prisma } from '@labconnect/database';
import {
  addMember,
  createCatalogue,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  createUser,
  type LabContext,
  type LabFixture,
  type LabOptions,
  loadReference,
  seedReference,
} from '@labconnect/database/test-utils';
import { beforeAll } from 'vitest';
import {
  actorWithoutMembership,
  type ClaimDeps,
  type CurrentActor,
  OutboxService,
  type RequestMeta,
} from '../../src/index.js';
import { START, uniqueEmail, useIdentity } from './identity-support.js';

/** The transaction client of a scope, named so the declarations of this helper can refer to it. */
export type ClaimTx = Prisma.TransactionClient;

const PATIENT = { maxWait: 60_000, timeout: 10 * 60_000 };

export const CLAIM_META: RequestMeta = {
  requestId: 'req-claim-1',
  ipAddress: '203.0.113.9',
  userAgent: 'vitest',
};

export interface Claimant {
  id: string;
  email: string;
  actor: CurrentActor;
}

/**
 * The world of the lab claim database tests: unclaimed labs on demand (each test makes its own,
 * so tests never share an organisation, a certificate or an address), claimants with no
 * membership, and the claim dependencies on a clock the test controls.
 */
export function useClaimWorld() {
  const t = useIdentity();
  const deps: ClaimDeps = { ...t.deps, outbox: new OutboxService(t.clock) };
  let context: LabContext | undefined;

  beforeAll(async () => {
    context = await t.owner(async (tx) => {
      await seedReference(tx);
      const reference = await loadReference(tx);
      const platform = await createPlatformTeam(tx);
      const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO claim tests');
      const catalogue = await createCatalogue(tx, reference, changeSetId);
      return { reference, platform, catalogue, changeSetId };
    }, PATIENT);
  });

  /**
   * A listed, unclaimed lab with one site. `email` overrides the NABL address of the site
   * (`null` removes it).
   */
  const lab = async (
    options: LabOptions & { email?: string | null } = {},
  ): Promise<LabFixture & { siteId: string; certificateNo: string; email: string | null }> => {
    if (!context) throw new Error('the claim world is not ready');
    const ctx = context;
    const { email, ...labOptions } = options;
    const fixture = await t.owner(
      (tx) => createLab(tx, ctx, { onboarded: false, now: new Date(START), ...labOptions }),
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
      ...fixture,
      siteId: site.id,
      certificateNo: site.certificateNo,
      email: stored.rows[0]?.contact_email ?? null,
    };
  };

  /** A signed-in user with no membership, as a new lab user is. */
  const claimant = async (label = 'claimant'): Promise<Claimant> => {
    const email = uniqueEmail(label);
    const id = await t.owner((tx) => createUser(tx, { email, fullName: `DEMO ${label}` }));
    return {
      id,
      email,
      actor: actorWithoutMembership({ userId: id, sessionId: randomUUID(), mfaVerifiedAt: null }),
    };
  };

  /** A user who is platform staff, with no membership (RR-5 must still stop them). */
  const staffWithoutMembership = async (): Promise<Claimant> => {
    const email = uniqueEmail('staff');
    const id = await t.owner((tx) =>
      createUser(tx, { email, fullName: 'DEMO staff', platformStaff: true }),
    );
    return {
      id,
      email,
      actor: actorWithoutMembership({ userId: id, sessionId: randomUUID(), mfaVerifiedAt: null }),
    };
  };

  return { ...t, deps, lab, claimant, staffWithoutMembership, addMember };
}
