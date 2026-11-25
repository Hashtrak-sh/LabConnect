import { type DbContext, withDbContext } from '@labconnect/database';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AuditService,
  ConfigChangeError,
  ConfigParameterInvalidError,
  ConfigParameterMissingError,
  ConfigParameters,
  configParsers,
  FixedClock,
} from '../../src/index.js';
import { usePlatform, uuid } from './support.js';

// P3-01: effective configuration, fallback between scopes, versioned changes and their audit.

describe('ConfigParameters', () => {
  const { api, owner, db } = usePlatform();
  const clock = new FixedClock('2026-11-25T10:00:00Z');
  const config = new ConfigParameters(clock, new AuditService(clock));
  const tenant = (): DbContext => ({ kind: 'tenant', orgId: uuid(), userId: uuid() });
  const read = <T>(
    key: string,
    parse: (raw: unknown) => T,
    scopes?: { type: 'LAB_ORG' | 'LAB_SITE'; id: string }[],
    at?: Date,
  ) =>
    withDbContext(api(), tenant(), (tx) =>
      config.get(tx, key, parse, { ...(scopes ? { scopes } : {}), ...(at ? { at } : {}) }),
    );
  let userId = '';

  beforeAll(async () => {
    userId = uuid();
    await db().query(
      `INSERT INTO app_user (id, email, full_name, status) VALUES ($1, $2, 'Test User', 'ACTIVE')`,
      [userId, `${userId}@example.test`],
    );
  });

  const seedGlobal = (key: string, value: unknown, from = '2026-01-01T00:00:00Z') =>
    owner().configParameter.create({
      data: {
        id: uuid(),
        key,
        scopeType: 'GLOBAL',
        value: value as number,
        effectiveFrom: new Date(from),
        changeReason: 'seed',
      },
    });

  it('reads the seeded global value', async () => {
    await seedGlobal('booking.lab_decision_sla_business_minutes', 240);
    expect(
      await read('booking.lab_decision_sla_business_minutes', configParsers.positiveInteger),
    ).toBe(240);
  });

  it('throws for a missing key, with no silent default', async () => {
    await expect(read('no.such.key', configParsers.integer)).rejects.toBeInstanceOf(
      ConfigParameterMissingError,
    );
  });

  it('throws when the stored value fails the caller parser, without echoing the value', async () => {
    await seedGlobal('feature.platform_fee_enabled', 'maybe');
    const error = await read('feature.platform_fee_enabled', configParsers.boolean).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConfigParameterInvalidError);
    expect((error as Error).message).not.toContain('maybe');
  });

  it('prefers the most specific scope and falls back to the global one', async () => {
    await seedGlobal('handover.drop_allowance_minutes', 100);
    const site = uuid();
    const org = uuid();
    const otherOrg = uuid();
    await owner().configParameter.createMany({
      data: [
        {
          id: uuid(),
          key: 'handover.drop_allowance_minutes',
          scopeType: 'LAB_ORG',
          scopeId: org,
          value: 200,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          changeReason: 'org',
        },
        {
          id: uuid(),
          key: 'handover.drop_allowance_minutes',
          scopeType: 'LAB_SITE',
          scopeId: site,
          value: 300,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          changeReason: 'site',
        },
      ],
    });
    const key = 'handover.drop_allowance_minutes';
    const p = configParsers.integer;
    expect(
      await read(key, p, [
        { type: 'LAB_SITE', id: site },
        { type: 'LAB_ORG', id: org },
      ]),
    ).toBe(300);
    expect(
      await read(key, p, [
        { type: 'LAB_SITE', id: uuid() },
        { type: 'LAB_ORG', id: org },
      ]),
    ).toBe(200);
    expect(
      await read(key, p, [
        { type: 'LAB_SITE', id: uuid() },
        { type: 'LAB_ORG', id: otherOrg },
      ]),
    ).toBe(100);
    expect(await read(key, p)).toBe(100);
  });

  it('refuses a scope that needs an id and has none', async () => {
    await expect(
      withDbContext(api(), tenant(), (tx) =>
        config.get(tx, 'x', configParsers.integer, { scopes: [{ type: 'LAB_ORG' }] }),
      ),
    ).rejects.toBeInstanceOf(ConfigChangeError);
  });

  describe('set', () => {
    const key = 'booking.max_open_requests_per_customer';
    const change = (value: number, extra: Record<string, unknown> = {}) =>
      withDbContext(api(), tenant(), (tx) =>
        config.set(tx, {
          key,
          scope: { type: 'GLOBAL' },
          value,
          reason: `set to ${String(value)}`,
          actor: { userId, role: 'PLATFORM_ADMIN' },
          ...extra,
        }),
      );

    it('closes the current row, adds a new one and keeps the history readable', async () => {
      await seedGlobal(key, 10, '2026-01-01T00:00:00Z');
      clock.set('2026-11-25T10:00:00Z');
      const { id } = await change(25);
      clock.set('2026-12-01T00:00:00Z');
      const { id: second } = await change(40);

      const rows = (
        await db().query<{
          id: string;
          value: number;
          effective_from: Date;
          effective_to: Date | null;
          change_reason: string;
          created_by_user_id: string | null;
        }>(
          'SELECT id::text, value, effective_from, effective_to, change_reason, created_by_user_id::text FROM config_parameter WHERE key = $1 ORDER BY effective_from',
          [key],
        )
      ).rows;
      expect(rows.map((row) => row.value)).toEqual([10, 25, 40]);
      expect(rows[0]?.effective_to?.toISOString()).toBe('2026-11-25T10:00:00.000Z');
      expect(rows[1]?.effective_to?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
      expect(rows[2]?.effective_to).toBeNull();
      expect(rows[1]).toMatchObject({ id, change_reason: 'set to 25', created_by_user_id: userId });
      expect(rows[2]?.id).toBe(second);

      // What applied at each instant can still be read.
      const p = configParsers.integer;
      expect(await read(key, p, undefined, new Date('2026-06-01T00:00:00Z'))).toBe(10);
      expect(await read(key, p, undefined, new Date('2026-11-30T00:00:00Z'))).toBe(25);
      expect(await read(key, p, undefined, new Date('2026-12-02T00:00:00Z'))).toBe(40);
      expect(await read(key, p)).toBe(40);
    });

    it('writes a config.change audit entry with the old and new value, in the same transaction', async () => {
      const audited = (
        await db().query<{
          action: string;
          entity_type: string;
          before: { value: number } | null;
          after: { value: number };
          reason: string;
          actor_user_id: string;
        }>(
          `SELECT action, entity_type, "before", "after", reason, actor_user_id::text FROM audit_log WHERE action = 'config.change' AND "after"->>'key' = $1 ORDER BY occurred_at`,
          [key],
        )
      ).rows;
      expect(audited).toHaveLength(2);
      expect(audited[0]).toMatchObject({
        entity_type: 'config_parameter',
        before: { value: 10 },
        after: { value: 25 },
        reason: 'set to 25',
        actor_user_id: userId,
      });
      expect(audited[1]?.after.value).toBe(40);
    });

    it('creates the first version when there is none', async () => {
      clock.set('2026-11-25T10:00:00Z');
      const first = 'report.share_link_default_days';
      await withDbContext(api(), tenant(), (tx) =>
        config.set(tx, {
          key: first,
          scope: { type: 'GLOBAL' },
          value: 7,
          reason: 'initial',
          actor: 'SYSTEM',
        }),
      );
      expect(await read(first, configParsers.integer)).toBe(7);
      const audit = await db().query(`SELECT before FROM audit_log WHERE "after"->>'key' = $1`, [
        first,
      ]);
      expect(audit.rows[0]).toMatchObject({ before: null });
    });

    it('refuses a change that does not start after the current value, and one without a reason', async () => {
      clock.set('2026-12-01T00:00:00Z');
      await expect(change(41)).rejects.toBeInstanceOf(ConfigChangeError);
      clock.set('2026-12-02T00:00:00Z');
      await expect(change(42, { reason: '  ' })).rejects.toBeInstanceOf(ConfigChangeError);
      expect(await read(key, configParsers.integer)).toBe(40);
    });

    it('rolls the audit entry back with a failed change', async () => {
      clock.set('2026-12-03T00:00:00Z');
      const before = (await db().query(`SELECT 1 FROM audit_log WHERE "after"->>'key' = $1`, [key]))
        .rowCount;
      await expect(
        withDbContext(api(), tenant(), async (tx) => {
          await config.set(tx, {
            key,
            scope: { type: 'GLOBAL' },
            value: 50,
            reason: 'doomed',
            actor: 'SYSTEM',
          });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(
        (await db().query(`SELECT 1 FROM audit_log WHERE "after"->>'key' = $1`, [key])).rowCount,
      ).toBe(before);
      expect(await read(key, configParsers.integer)).toBe(40);
    });

    it('lets only one of two concurrent changes win', async () => {
      clock.set('2026-12-10T00:00:00Z');
      const outcomes = await Promise.allSettled([change(61), change(62)]);
      const wins = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      expect(wins).toHaveLength(1);
      const open = await db().query(
        'SELECT value FROM config_parameter WHERE key = $1 AND effective_to IS NULL',
        [key],
      );
      expect(open.rowCount).toBe(1);
    });
  });
});
