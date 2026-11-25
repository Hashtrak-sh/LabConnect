import { describe, expect, it } from 'vitest';
import { IdentityError } from '../../src/index.js';
import { useAccess } from './access-support.js';

// P3-04: TenantScope against real row-level security, as the app_rw login role.

const refusal = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IdentityError) return error.code;
    throw error;
  }
  return undefined;
};

interface Settings {
  org: string;
  user: string;
  platform: string;
  system: string;
}

describe('TenantScope', () => {
  const t = useAccess();

  const sitesSeenBy = (
    actor: Awaited<ReturnType<typeof t.actorOf>>,
    filter: { organisationId?: string } = {},
  ) =>
    t
      .scope()
      .run(actor, async (tx) =>
        (await tx.customerSite.findMany({ where: filter, select: { organisationId: true } })).map(
          (row) => row.organisationId,
        ),
      );
  const settingsOf = async (tx: {
    $queryRaw: (q: TemplateStringsArray) => Promise<Settings[]>;
  }): Promise<Settings> => {
    const [row] = await tx.$queryRaw`
      SELECT current_setting('app.org_id', true) AS org, current_setting('app.user_id', true) AS "user",
             current_setting('app.is_platform', true) AS platform, current_setting('app.is_system', true) AS system`;
    if (!row) throw new Error('no settings');
    return row;
  };

  describe('run', () => {
    it('shows a customer the rows of its organisation and nothing of another', async () => {
      const { a, b } = t.world();
      const actor = await t.actorOf(a.admin, await t.membershipOf(a.admin, a.organisationId));
      expect(await sitesSeenBy(actor)).toEqual([a.organisationId]);
      // Asking for the other organisation's rows by id finds nothing: row-level security answers.
      expect(await sitesSeenBy(actor, { organisationId: b.organisationId })).toEqual([]);
    });

    it('sets the settings from the actor: its organisation, its user, not platform, not system', async () => {
      const { a } = t.world();
      const actor = await t.actorOf(a.admin, await t.membershipOf(a.admin, a.organisationId));
      const settings = await t.scope().run(actor, (tx) => settingsOf(tx));
      expect(settings).toEqual({ org: a.organisationId, user: a.admin, platform: '', system: '' });
    });

    it('shows a user of two organisations only the active one, and switching switches the data', async () => {
      const { a, b } = t.world();
      const user = await t.twoOrgUser();
      const inA = await t.actorOf(user.userId, user.inA);
      const inB = await t.actorOf(user.userId, user.inA, { requested: user.inB });
      expect(await sitesSeenBy(inA)).toEqual([a.organisationId]);
      expect(await sitesSeenBy(inB)).toEqual([b.organisationId]);
      expect(await sitesSeenBy(inA)).toEqual([a.organisationId]);
    });

    it('runs platform staff as the platform: every organisation, no organisation setting', async () => {
      const { a, b, platform } = t.world();
      const actor = await t.actorOf(
        platform.ops,
        await t.membershipOf(platform.ops, platform.organisationId),
      );
      const seen = await sitesSeenBy(actor);
      expect(seen).toEqual(expect.arrayContaining([a.organisationId, b.organisationId]));
      const settings = await t.scope().run(actor, (tx) => settingsOf(tx));
      expect(settings).toEqual({ org: '', user: platform.ops, platform: 'true', system: '' });
    });

    it('refuses an actor with no organisation before any query', async () => {
      const { a } = t.world();
      const nobody = await t.actorOf(a.admin, null);
      let ran = false;
      await expect(
        refusal(
          t.scope().run(nobody, () => {
            ran = true;
            return Promise.resolve();
          }),
        ),
      ).resolves.toBe('FORBIDDEN');
      expect(ran).toBe(false);
    });

    it('keeps mixed contexts apart under concurrency on a pool of four connections', async () => {
      const { a, b, platform } = t.world();
      const actors = [
        await t.actorOf(a.admin, await t.membershipOf(a.admin, a.organisationId)),
        await t.actorOf(b.admin, await t.membershipOf(b.admin, b.organisationId)),
        await t.actorOf(platform.ops, await t.membershipOf(platform.ops, platform.organisationId)),
      ];
      const results = await Promise.all(
        Array.from({ length: 60 }, async (_, index) => {
          const actor = actors[index % actors.length];
          if (!actor) throw new Error('actor');
          return {
            actor,
            seen: new Set(await sitesSeenBy(actor)),
          };
        }),
      );
      for (const { actor, seen } of results) {
        if (actor.isPlatform) expect(seen.size).toBeGreaterThanOrEqual(2);
        else expect([...seen]).toEqual([actor.orgId]);
      }
    });
  });

  describe('runAsUser', () => {
    it('shows the user only their own memberships (no organisation)', async () => {
      const user = await t.twoOrgUser();
      const seen = await t
        .scope()
        .runAsUser(user.userId, async (tx) =>
          (await tx.membership.findMany({ select: { id: true } })).map((row) => row.id).sort(),
        );
      expect(seen).toEqual([user.inA, user.inB].sort());
      const settings = await t.scope().runAsUser(user.userId, (tx) => settingsOf(tx));
      expect(settings).toEqual({ org: '', user: user.userId, platform: '', system: '' });
    });
  });

  describe('runAsSystem', () => {
    it('sees every organisation and says so in the settings', async () => {
      const { a, b } = t.world();
      const { seen, settings } = await t
        .scope()
        .runAsSystem('A test needs to see across tenants', async (tx) => ({
          seen: (await tx.customerSite.findMany({ select: { organisationId: true } })).map(
            (row) => row.organisationId,
          ),
          settings: await settingsOf(tx),
        }));
      expect(seen).toEqual(expect.arrayContaining([a.organisationId, b.organisationId]));
      expect(settings).toEqual({ org: '', user: '', platform: '', system: 'true' });
    });
  });

  describe('runOnBehalfOf (OQ-53)', () => {
    const request = (organisationId: string) => ({
      organisationId,
      reason: 'A caller phoned in a booking',
      requestId: 'req-on-behalf',
    });

    it('runs Ops as the platform with the customer organisation set, and audits it first', async () => {
      const { b, platform } = t.world();
      const ops = await t.actorOf(
        platform.ops,
        await t.membershipOf(platform.ops, platform.organisationId),
      );
      const settings = await t
        .scope()
        .runOnBehalfOf(ops, request(b.organisationId), (tx) => settingsOf(tx));
      expect(settings).toEqual({
        org: b.organisationId,
        user: platform.ops,
        platform: 'true',
        system: '',
      });
      const audit = await t.db().query<{
        actor_user_id: string;
        actor_role: string;
        action: string;
        entity_id: string;
        reason: string;
        request_id: string;
      }>(
        `SELECT actor_user_id, actor_role, action, entity_id, reason, request_id FROM audit_log
          WHERE action = 'platform.act_on_behalf' AND entity_id = $1`,
        [b.organisationId],
      );
      expect(audit.rows).toEqual([
        {
          actor_user_id: platform.ops,
          actor_role: 'PLATFORM_OPS',
          action: 'platform.act_on_behalf',
          entity_id: b.organisationId,
          reason: 'A caller phoned in a booking',
          request_id: 'req-on-behalf',
        },
      ]);
    });

    it('refuses everyone but PLATFORM_OPS with 403 and writes nothing', async () => {
      const { a, b, lab, platform } = t.world();
      const before = await t
        .db()
        .query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'platform.act_on_behalf'",
        );
      const actors = [
        await t.actorOf(a.admin, await t.membershipOf(a.admin, a.organisationId)),
        await t.actorOf(lab.checker, await t.membershipOf(lab.checker, lab.organisationId)),
        await t.actorOf(
          platform.admin,
          await t.membershipOf(platform.admin, platform.organisationId),
        ),
        await t.actorOf(
          platform.finance,
          await t.membershipOf(platform.finance, platform.organisationId),
        ),
      ];
      for (const actor of actors) {
        await expect(
          refusal(
            t.scope().runOnBehalfOf(actor, request(b.organisationId), () => Promise.resolve(1)),
          ),
        ).resolves.toBe('FORBIDDEN');
      }
      const after = await t
        .db()
        .query<{ n: string }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'platform.act_on_behalf'",
        );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });

    it('is 404 for an organisation that is unknown, not a customer, or not active', async () => {
      const { b, lab, platform } = t.world();
      const ops = await t.actorOf(
        platform.ops,
        await t.membershipOf(platform.ops, platform.organisationId),
      );
      const target = (organisationId: string) =>
        refusal(t.scope().runOnBehalfOf(ops, request(organisationId), () => Promise.resolve(1)));
      await expect(target('0192f3c0-0000-7000-8000-00000000dead')).resolves.toBe('NOT_FOUND');
      await expect(target(lab.organisationId)).resolves.toBe('NOT_FOUND');
      await expect(target(platform.organisationId)).resolves.toBe('NOT_FOUND');
      await t
        .db()
        .query("UPDATE organisation SET status = 'SUSPENDED' WHERE id = $1", [b.organisationId]);
      await expect(target(b.organisationId)).resolves.toBe('NOT_FOUND');
      await t
        .db()
        .query("UPDATE organisation SET status = 'ACTIVE' WHERE id = $1", [b.organisationId]);
    });

    it('rolls the audit row back with the work when the work fails', async () => {
      const { a, platform } = t.world();
      const ops = await t.actorOf(
        platform.ops,
        await t.membershipOf(platform.ops, platform.organisationId),
      );
      await expect(
        t
          .scope()
          .runOnBehalfOf(ops, { organisationId: a.organisationId, reason: 'This one fails' }, () =>
            Promise.reject(new Error('boom')),
          ),
      ).rejects.toThrow('boom');
      const rows = await t
        .db()
        .query(
          "SELECT 1 FROM audit_log WHERE action = 'platform.act_on_behalf' AND reason = 'This one fails'",
        );
      expect(rows.rowCount).toBe(0);
    });
  });
});
