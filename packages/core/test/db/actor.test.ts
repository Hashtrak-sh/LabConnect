import { describe, expect, it } from 'vitest';
import { IdentityError } from '../../src/index.js';
import { useAccess } from './access-support.js';

// P3-04: the CurrentActor built from real membership rows, as the API role under row-level security.

const refusal = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IdentityError) return error.code;
    throw error;
  }
  return undefined;
};

describe('loadCurrentActor', () => {
  const t = useAccess();

  it('builds the actor of a customer admin from the membership, its roles and its organisation', async () => {
    const { a } = t.world();
    const membership = await t.membershipOf(a.admin, a.organisationId);
    const actor = await t.actorOf(a.admin, membership);
    expect(actor).toMatchObject({
      userId: a.admin,
      membershipId: membership,
      orgId: a.organisationId,
      orgType: 'CUSTOMER',
      roles: ['CUSTOMER_ADMIN'],
      siteIds: [],
      allSites: false,
      isPlatform: false,
    });
    expect(actor.permissions.has('booking.create_edit')).toBe(true);
    expect(actor.permissions.has('receipt.record')).toBe(false);
  });

  it('gives a lab member the sites assigned to the membership, and no more', async () => {
    const { lab, siteMaker } = t.world();
    const all = await t.actorOf(lab.maker, await t.membershipOf(lab.maker, lab.organisationId));
    expect([...all.siteIds].sort()).toEqual([...lab.siteIds].sort());
    expect(all.orgType).toBe('LAB');
    const one = await t.actorOf(siteMaker.userId, siteMaker.membershipId);
    expect(one.siteIds).toEqual([lab.siteIds[0]]);
  });

  it('leaves out a site whose assignment was revoked', async () => {
    const { lab, siteMaker } = t.world();
    await t
      .db()
      .query('UPDATE membership_site SET revoked_at = now() WHERE membership_id = $1', [
        siteMaker.membershipId,
      ]);
    const actor = await t.actorOf(siteMaker.userId, siteMaker.membershipId);
    expect(actor.siteIds).toEqual([]);
    await t
      .db()
      .query(
        `INSERT INTO membership_site (id, membership_id, lab_site_id) VALUES (gen_random_uuid(), $1, $2)`,
        [siteMaker.membershipId, lab.siteIds[0]],
      );
  });

  it('makes a platform user a platform actor with every site', async () => {
    const { platform } = t.world();
    const actor = await t.actorOf(
      platform.ops,
      await t.membershipOf(platform.ops, platform.organisationId),
    );
    expect(actor).toMatchObject({
      orgType: 'PLATFORM',
      isPlatform: true,
      allSites: true,
      roles: ['PLATFORM_OPS'],
    });
    expect(actor.permissions.has('dispute.decide')).toBe(true);
    expect(actor.permissions.has('platform_config.manage')).toBe(false);
  });

  it('gives a user with no active membership an actor with no organisation and no permissions', async () => {
    const { a } = t.world();
    const actor = await t.actorOf(a.admin, null);
    expect(actor).toMatchObject({ membershipId: null, orgId: null, orgType: null, roles: [] });
    expect(actor.permissions.size).toBe(0);
  });

  it('refuses at once a session whose membership was deactivated (the token has not expired)', async () => {
    const { a } = t.world();
    const membership = await t.membershipOf(a.requester, a.organisationId);
    expect((await t.actorOf(a.requester, membership)).roles).toEqual(['CUSTOMER_REQUESTER']);
    await t.db().query("UPDATE membership SET status = 'DEACTIVATED' WHERE id = $1", [membership]);
    await expect(refusal(t.actorOf(a.requester, membership))).resolves.toBe('FORBIDDEN');
    // Asking for it by header is "not one of your active memberships".
    await expect(refusal(t.actorOf(a.requester, null, { requested: membership }))).resolves.toBe(
      'NOT_FOUND',
    );
    await t.db().query("UPDATE membership SET status = 'ACTIVE' WHERE id = $1", [membership]);
    expect((await t.actorOf(a.requester, membership)).orgId).toBe(a.organisationId);
  });

  it('refuses at once a membership whose only role was revoked', async () => {
    const { a } = t.world();
    const membership = await t.membershipOf(a.finance, a.organisationId);
    await t
      .db()
      .query('UPDATE membership_role SET revoked_at = now() WHERE membership_id = $1', [
        membership,
      ]);
    await expect(refusal(t.actorOf(a.finance, membership))).resolves.toBe('FORBIDDEN');
    await t
      .db()
      .query('UPDATE membership_role SET revoked_at = NULL WHERE membership_id = $1', [membership]);
  });

  it.each(['SUSPENDED', 'CLOSED'])(
    'refuses at once a member of an organisation that is %s',
    async (status) => {
      const { b } = t.world();
      const membership = await t.membershipOf(b.admin, b.organisationId);
      await t
        .db()
        .query('UPDATE organisation SET status = $1::org_status WHERE id = $2', [
          status,
          b.organisationId,
        ]);
      await expect(refusal(t.actorOf(b.admin, membership))).resolves.toBe('FORBIDDEN');
      await t
        .db()
        .query("UPDATE organisation SET status = 'ACTIVE' WHERE id = $1", [b.organisationId]);
      expect((await t.actorOf(b.admin, membership)).orgId).toBe(b.organisationId);
    },
  );

  it('lets a user of two organisations choose between their own memberships, and no others', async () => {
    const { a, b } = t.world();
    const user = await t.twoOrgUser();
    const inA = await t.actorOf(user.userId, user.inA);
    expect(inA.orgId).toBe(a.organisationId);
    const switched = await t.actorOf(user.userId, user.inA, { requested: user.inB });
    expect(switched).toMatchObject({ orgId: b.organisationId, membershipId: user.inB });

    // Someone else's membership, a membership that does not exist, and rubbish: all "not found".
    const othersMembership = await t.membershipOf(a.admin, a.organisationId);
    for (const requested of [
      othersMembership,
      '0192f3c0-0000-7000-8000-00000000dead',
      'not-a-uuid',
      '',
      "' OR 1=1 --",
    ]) {
      await expect(refusal(t.actorOf(user.userId, user.inA, { requested }))).resolves.toBe(
        'NOT_FOUND',
      );
    }
  });

  it('asks for MFA of a role that needs it when the session never completed it', async () => {
    const { lab } = t.world();
    const membership = await t.membershipOf(lab.checker, lab.organisationId);
    await expect(refusal(t.actorOf(lab.checker, membership, { mfa: false }))).resolves.toBe(
      'STEP_UP_REQUIRED',
    );
    expect((await t.actorOf(lab.checker, membership, { mfa: true })).roles).toEqual([
      'LAB_CHECKER',
    ]);
    // A Maker may work without MFA (optional).
    const maker = await t.membershipOf(lab.maker, lab.organisationId);
    expect((await t.actorOf(lab.maker, maker, { mfa: false })).roles).toEqual(['LAB_MAKER']);
  });
});
