import { withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { IdentityError, MembershipRepository } from '../../src/index.js';
import { useAccess } from './access-support.js';

// P3-04: the worked example of the repository pattern, on a real tenant table under row-level
// security. The point: another tenant's row is "not found" even when asked for by id, and the
// organisation predicate holds even when row-level security would have allowed the row.

describe('MembershipRepository', () => {
  const t = useAccess();

  const asActor = async (userId: string, organisationId: string) =>
    t.actorOf(userId, await t.membershipOf(userId, organisationId));

  it('lists the members of the actor organisation and no one else', async () => {
    const { a, b } = t.world();
    const actor = await asActor(a.admin, a.organisationId);
    const members = await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).list());
    expect(members.map((member) => member.userId).sort()).toEqual(
      [a.admin, a.requester, a.finance].sort(),
    );
    expect(members.map((member) => member.userId)).not.toContain(b.admin);
    const roles = Object.fromEntries(members.map((member) => [member.userId, member.roles]));
    expect(roles).toEqual({
      [a.admin]: ['CUSTOMER_ADMIN'],
      [a.requester]: ['CUSTOMER_REQUESTER'],
      [a.finance]: ['CUSTOMER_FINANCE'],
    });
  });

  it('finds a member of its own organisation by id', async () => {
    const { a } = t.world();
    const actor = await asActor(a.admin, a.organisationId);
    const id = await t.membershipOf(a.requester, a.organisationId);
    const found = await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).find(id));
    expect(found).toMatchObject({ id, userId: a.requester, status: 'ACTIVE', siteIds: [] });
  });

  it("cannot read another tenant's membership even when asked for it by id: not found", async () => {
    const { a, b } = t.world();
    const actor = await asActor(a.admin, a.organisationId);
    const foreign = await t.membershipOf(b.admin, b.organisationId);
    const found = await t
      .scope()
      .run(actor, (tx) => new MembershipRepository(tx, actor).find(foreign));
    expect(found).toBeNull();
    await expect(
      t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).get(foreign)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers not found for an id that is not a UUID, without a database error', async () => {
    const { a } = t.world();
    const actor = await asActor(a.admin, a.organisationId);
    await expect(
      t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).find("1' OR '1'='1")),
    ).resolves.toBeNull();
  });

  it('still limits itself to the organisation when row-level security would have let the row through', async () => {
    const { a, b } = t.world();
    const actor = await asActor(a.admin, a.organisationId);
    const foreign = await t.membershipOf(b.admin, b.organisationId);
    // `system` and `platform` see every row: the explicit predicate is what holds.
    const underSystem = await t
      .scope()
      .runAsSystem('A test shows the repository does not rely on row-level security alone', (tx) =>
        new MembershipRepository(tx, actor).find(foreign),
      );
    expect(underSystem).toBeNull();
    const listUnderSystem = await t
      .scope()
      .runAsSystem('A test shows the repository does not rely on row-level security alone', (tx) =>
        new MembershipRepository(tx, actor).list(),
      );
    expect(
      listUnderSystem.every((member) => [a.admin, a.requester, a.finance].includes(member.userId)),
    ).toBe(true);
    const underPlatform = await withDbContext(
      t.api(),
      { kind: 'platform', userId: t.world().platform.ops },
      (tx) => new MembershipRepository(tx, actor).find(foreign),
    );
    expect(underPlatform).toBeNull();
  });

  it("does not return the actor's own membership in another organisation (row-level security allows own rows)", async () => {
    const user = await t.twoOrgUser();
    const actor = await t.actorOf(user.userId, user.inA);
    const { inB } = user;
    // Policy `membership_visibility` lets a user see their own membership rows in any organisation.
    const raw = await t
      .scope()
      .run(actor, (tx) => tx.membership.findUnique({ where: { id: inB } }));
    expect(raw?.id).toBe(inB);
    // The repository is limited to the active organisation all the same.
    expect(
      await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).find(inB)),
    ).toBeNull();
    const listed = await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).list());
    expect(listed.map((member) => member.id)).toContain(user.inA);
    expect(listed.map((member) => member.id)).not.toContain(inB);
  });

  it('shows a lab member their lab, with roles and sites', async () => {
    const { lab } = t.world();
    const actor = await asActor(lab.checker, lab.organisationId);
    const members = await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).list());
    const checker = members.find((member) => member.userId === lab.checker);
    expect(checker?.roles).toEqual(['LAB_CHECKER']);
    expect([...(checker?.siteIds ?? [])].sort()).toEqual([...lab.siteIds].sort());
  });

  it('works for platform staff on the platform organisation only', async () => {
    const { platform, a } = t.world();
    const actor = await asActor(platform.admin, platform.organisationId);
    const members = await t.scope().run(actor, (tx) => new MembershipRepository(tx, actor).list());
    expect(members.map((member) => member.userId)).toEqual(
      expect.arrayContaining([platform.ops, platform.admin]),
    );
    expect(members.map((member) => member.userId)).not.toContain(a.admin);
  });

  it('refuses to be built for a user with no organisation', async () => {
    const { a } = t.world();
    const nobody = await t.actorOf(a.admin, null);
    await expect(
      t
        .scope()
        .runAsSystem('A test builds a repository for an actor with no organisation', (tx) => {
          try {
            return Promise.resolve(new MembershipRepository(tx, nobody));
          } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error('unknown'));
          }
        }),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
