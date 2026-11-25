import { type DbContext, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AuditService, FixedClock, REDACTED } from '../../src/index.js';
import { failure, PG, usePlatform, uuid } from './support.js';

// P3-01: AuditService against the real table, roles, grants and row-level security.

describe('AuditService and the audit_log grants', () => {
  const { api, worker, db } = usePlatform();
  const clock = new FixedClock('2026-11-25T10:00:00Z');
  const audit = new AuditService(clock);
  const tenant = (): DbContext => ({ kind: 'tenant', orgId: uuid(), userId: uuid() });

  it('writes a row as the API role, with the actor, entity, request and address', async () => {
    const userId = uuid();
    const orgId = uuid();
    const entityId = uuid();
    const { id } = await withDbContext(api(), { kind: 'tenant', orgId, userId }, (tx) =>
      audit.record(tx, {
        actor: { userId, orgId, membershipId: uuid(), role: 'LAB_CHECKER' },
        action: AUDIT_ACTIONS.BOOKING_TRANSITION,
        entityType: 'booking',
        entityId,
        before: { status: 'REQUESTED' },
        after: { status: 'ACCEPTED' },
        reason: 'lab accepted',
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'vitest',
      }),
    );

    const rows = await db().query<Record<string, unknown>>(
      'SELECT *, host(ip_address) AS ip FROM audit_log WHERE id = $1',
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      actor_user_id: userId,
      actor_org_id: orgId,
      actor_role: 'LAB_CHECKER',
      action: 'booking.transition',
      entity_type: 'booking',
      entity_id: entityId,
      before: { status: 'REQUESTED' },
      after: { status: 'ACCEPTED' },
      reason: 'lab accepted',
      request_id: 'req-123',
      ip: '203.0.113.9',
      user_agent: 'vitest',
    });
    expect((rows.rows[0]?.occurred_at as Date).toISOString()).toBe('2026-11-25T10:00:00.000Z');
  });

  it('records SYSTEM as a row with no actor, and leaves absent members NULL', async () => {
    const { id } = await withDbContext(worker(), { kind: 'system' }, (tx) =>
      audit.record(tx, {
        actor: 'SYSTEM',
        action: 'timer.fire',
        entityType: 'timer',
        entityId: uuid(),
        ipAddress: 'not an address',
      }),
    );
    const row = (
      await db().query<Record<string, unknown>>('SELECT * FROM audit_log WHERE id = $1', [id])
    ).rows[0];
    expect(row).toMatchObject({
      actor_user_id: null,
      actor_membership_id: null,
      actor_role: null,
      actor_org_id: null,
      before: null,
      after: null,
      reason: null,
      ip_address: null,
    });
  });

  it('redacts sensitive keys before the row is stored', async () => {
    const { id } = await withDbContext(api(), tenant(), (tx) =>
      audit.record(tx, {
        actor: 'SYSTEM',
        action: 'user.update',
        entityType: 'app_user',
        entityId: uuid(),
        before: {
          name: 'A',
          otp: '123456',
          bank: { accountNumber: '000111222333', ifsc: 'HDFC0000001' },
        },
        after: {
          name: 'B',
          session: { token: 'abc' },
          amount: 12n,
          at: new Date('2026-01-01T00:00:00Z'),
        },
      }),
    );
    const row = (
      await db().query<{ before: unknown; after: unknown }>(
        'SELECT "before", "after" FROM audit_log WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(row?.before).toEqual({
      name: 'A',
      otp: REDACTED,
      bank: { accountNumber: REDACTED, ifsc: 'HDFC0000001' },
    });
    expect(row?.after).toEqual({
      name: 'B',
      session: { token: REDACTED },
      amount: '12',
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(row)).not.toContain('123456');
    expect(JSON.stringify(row)).not.toContain('000111222333');
  });

  it('commits and rolls back with the surrounding transaction', async () => {
    const entityId = uuid();
    await expect(
      withDbContext(api(), tenant(), async (tx) => {
        await audit.record(tx, { actor: 'SYSTEM', action: 'x.y', entityType: 'x', entityId });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    const count = await db().query('SELECT 1 FROM audit_log WHERE entity_id = $1', [entityId]);
    expect(count.rowCount).toBe(0);
  });

  it('refuses an action or entity type the columns cannot hold', async () => {
    await expect(
      withDbContext(api(), tenant(), (tx) =>
        audit.record(tx, {
          actor: 'SYSTEM',
          action: 'a'.repeat(101),
          entityType: 'x',
          entityId: uuid(),
        }),
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      withDbContext(api(), tenant(), (tx) =>
        audit.record(tx, { actor: 'SYSTEM', action: 'a', entityType: '', entityId: uuid() }),
      ),
    ).rejects.toThrow(RangeError);
  });

  describe('grants', () => {
    it('lets the API role insert but not read the audit log as a tenant', async () => {
      const visible = await withDbContext(api(), tenant(), (tx) => tx.auditLog.count());
      expect(visible).toBe(0);
    });

    it('stops the API role from updating or deleting audit rows', async () => {
      const update = await failure(() =>
        withDbContext(api(), { kind: 'platform', userId: uuid() }, (tx) =>
          tx.auditLog.updateMany({ data: { reason: 'edited' } }),
        ),
      );
      expect(update.state).toBe(PG.privilege);
      const remove = await failure(() =>
        withDbContext(api(), { kind: 'platform', userId: uuid() }, (tx) =>
          tx.auditLog.deleteMany(),
        ),
      );
      expect(remove.state).toBe(PG.privilege);
    });

    it('stops the worker role from updating or deleting audit rows as well', async () => {
      const update = await failure(() =>
        withDbContext(worker(), { kind: 'system' }, (tx) =>
          tx.auditLog.updateMany({ data: { reason: 'edited' } }),
        ),
      );
      expect(update.state).toBe(PG.privilege);
    });

    it('lets only the worker insert into audit_log_chain', async () => {
      const row = () => ({
        id: uuid(),
        chainMonth: new Date('2026-11-01T00:00:00Z'),
        seq: 1n,
        auditLogId: uuid(),
        auditOccurredAt: new Date('2026-11-25T10:00:00Z'),
        hash: new Uint8Array(32),
      });
      const refused = await failure(() =>
        withDbContext(api(), { kind: 'system' }, (tx) =>
          tx.auditLogChain.createMany({ data: [row()] }),
        ),
      );
      expect(refused.state).toBe(PG.privilege);
      const accepted = await withDbContext(worker(), { kind: 'system' }, (tx) =>
        tx.auditLogChain.createMany({ data: [row()] }),
      );
      expect(accepted.count).toBe(1);
    });
  });
});
