import type { Prisma } from '@labconnect/database';
import { beforeAll } from 'vitest';
import {
  addMember,
  createCatalogue,
  createCustomer,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  createUser,
  loadReference,
  seedReference,
  uuidv7,
} from '@labconnect/database/test-utils';
import {
  type CurrentActor,
  loadCurrentActor,
  type ActorSession,
  TenantScope,
} from '../../src/index.js';
import { useIdentity } from './identity-support.js';

const PATIENT = { maxWait: 60_000, timeout: 10 * 60_000 };
/** The transaction client of a scope, named so the declarations of this helper can refer to it. */
export type ScopedTx = Prisma.TransactionClient;
export const MFA_AT = new Date('2026-11-25T10:00:00Z');

export interface AccessWorld {
  /** Customer organisation A: admin, requester, finance. */
  a: { organisationId: string; admin: string; requester: string; finance: string; siteId: string };
  /** Customer organisation B. */
  b: { organisationId: string; admin: string; requester: string; finance: string; siteId: string };
  /** A lab with two sites; its maker and checker are assigned to both. */
  lab: {
    organisationId: string;
    siteIds: [string, string];
    maker: string;
    checker: string;
  };
  /** A second lab maker of the lab, assigned to the first site only. */
  siteMaker: { userId: string; membershipId: string };
  platform: { organisationId: string; ops: string; finance: string; admin: string };
}

/**
 * The database tests of the authorisation layer: two customers, a lab with two sites and a
 * platform team, all on the real schema, and the three ways to reach it (`TenantScope` as the API
 * role, an owner transaction for setup and tampering).
 */
export function useAccess() {
  const t = useIdentity();
  let world: AccessWorld | undefined;

  const scope = (): TenantScope => new TenantScope(t.api(), t.deps.audit);

  beforeAll(async () => {
    world = await t.owner(async (tx) => {
      await seedReference(tx);
      const reference = await loadReference(tx);
      const platform = await createPlatformTeam(tx);
      const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO access tests');
      const catalogue = await createCatalogue(tx, reference, changeSetId);
      const a = await createCustomer(tx);
      const b = await createCustomer(tx);
      const lab = await createLab(
        tx,
        { reference, platform, catalogue, changeSetId },
        { sites: [{}, {}] },
      );
      const siteIds = lab.sites.map((site) => site.id);
      const [first, second] = siteIds;
      if (first === undefined || second === undefined) throw new Error('two sites expected');
      const siteMakerUser = await createUser(tx, {
        email: `site.maker.${uuidv7().slice(-8)}@example.test`,
        fullName: 'DEMO Site Maker',
      });
      const siteMakerMembership = await addMember(
        tx,
        siteMakerUser,
        lab.organisationId,
        'LAB_MAKER',
        [first],
      );
      const need = (value: string | undefined): string => {
        if (value === undefined) throw new Error('fixture is incomplete');
        return value;
      };
      const customer = (c: typeof a) => ({
        organisationId: c.organisationId,
        admin: c.admin,
        requester: need(c.requester),
        finance: need(c.finance),
        siteId: c.siteId,
      });
      return {
        a: customer(a),
        b: customer(b),
        lab: {
          organisationId: lab.organisationId,
          siteIds: [first, second] as [string, string],
          maker: need(lab.makers[0]),
          checker: need(lab.checkers[0]),
        },
        siteMaker: { userId: siteMakerUser, membershipId: siteMakerMembership },
        platform: {
          organisationId: platform.organisationId,
          ops: platform.ops,
          finance: platform.finance,
          admin: platform.admin,
        },
      };
    }, PATIENT);
  }, 600_000);

  const known = (): AccessWorld => {
    if (!world) throw new Error('the world is not ready');
    return world;
  };

  /** The membership id of a user in an organisation (setup, as the owner). */
  const membershipOf = async (userId: string, organisationId: string): Promise<string> => {
    const row = await t
      .db()
      .query<{ id: string }>(
        'SELECT id FROM membership WHERE user_id = $1 AND organisation_id = $2',
        [userId, organisationId],
      );
    const id = row.rows[0]?.id;
    if (id === undefined) throw new Error('no such membership');
    return id;
  };

  /** The actor of a session of `userId` on one membership, loaded through the real tables. */
  const actorOf = (
    userId: string,
    activeMembershipId: string | null,
    options: { mfa?: boolean; requested?: string } = {},
  ): Promise<CurrentActor> => {
    const session: ActorSession & { activeMembershipId: string | null } = {
      userId,
      sessionId: `sid-${userId}`,
      activeMembershipId,
      mfaVerifiedAt: options.mfa === false ? null : MFA_AT,
    };
    return scope().runAsUser(userId, (tx) => loadCurrentActor(tx, session, options.requested));
  };

  /** A user who is a member of the customer organisation A and also of B. */
  const twoOrgUser = async (): Promise<{ userId: string; inA: string; inB: string }> => {
    const w = known();
    const userId = await t.owner((tx) =>
      createUser(tx, {
        email: `consultant.${uuidv7().slice(-8)}@example.test`,
        fullName: 'DEMO Consultant',
      }),
    );
    const inA = await t.owner((tx) =>
      addMember(tx, userId, w.a.organisationId, 'CUSTOMER_REQUESTER'),
    );
    const inB = await t.owner((tx) =>
      addMember(tx, userId, w.b.organisationId, 'CUSTOMER_REQUESTER'),
    );
    return { userId, inA, inB };
  };

  return { ...t, scope, world: known, membershipOf, actorOf, twoOrgUser };
}
