import { type DbContext, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  AuditService,
  FixedClock,
  listAuditMonths,
  sealAuditLog,
  verifyAllAuditChains,
  verifyAuditChain,
} from '../../src/index.js';
import { type Db, gate, usePlatform, uuid } from './support.js';

// P3-01: sealing and verifying the audit hash chain, against the real triggers and roles.

describe('audit hash chain', () => {
  const { api, worker, db } = usePlatform();
  const tenant = (): DbContext => ({ kind: 'tenant', orgId: uuid(), userId: uuid() });

  /** Writes `count` audit rows, one second apart, starting at `start`. Returns their ids in order. */
  async function writeRows(start: string, count: number, label = 'row'): Promise<string[]> {
    const clock = new FixedClock(start);
    const audit = new AuditService(clock);
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const { id } = await withDbContext(api(), tenant(), (tx) =>
        audit.record(tx, {
          actor: 'SYSTEM',
          action: 'test.write',
          entityType: 'test',
          entityId: uuid(),
          after: { label, i },
        }),
      );
      ids.push(id);
      clock.advance(1000);
    }
    return ids;
  }

  const sealClock = (iso: string) => new FixedClock(iso);
  const seal = (iso: string, batchSize = 500, safetyLagMs = 0) =>
    sealAuditLog(worker(), sealClock(iso), { batchSize, safetyLagMs });

  /** Changes rows as the database owner, with triggers switched off, as an attacker with owner access would. */
  async function tamper(sql: string, params: unknown[] = []): Promise<void> {
    const owner: Db = db();
    await owner.query('BEGIN');
    try {
      await owner.query('SET LOCAL session_replication_role = replica');
      await owner.query(sql, params);
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  }

  const chain = async (month: string) =>
    (
      await db().query<{
        seq: string;
        audit_log_id: string;
        prev_hash: Buffer | null;
        hash: Buffer;
      }>(
        'SELECT seq::text, audit_log_id::text, prev_hash, hash FROM audit_log_chain WHERE chain_month = $1 ORDER BY audit_log_chain.seq',
        [month],
      )
    ).rows;

  it('seals in batches, in time order, linking each hash to the one before', async () => {
    const ids = await writeRows('2026-11-10T08:00:00Z', 5);
    const first = await seal('2026-11-10T09:00:00Z', 3);
    expect(first).toEqual({ sealed: 3, months: ['2026-11-01'] });
    expect((await seal('2026-11-10T09:00:00Z', 3)).sealed).toBe(2);
    expect((await seal('2026-11-10T09:00:00Z', 3)).sealed).toBe(0);

    const rows = await chain('2026-11-01');
    expect(rows.map((row) => row.audit_log_id)).toEqual(ids);
    expect(rows.map((row) => row.seq)).toEqual(['1', '2', '3', '4', '5']);
    expect(rows[0]?.prev_hash).toBeNull();
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]?.prev_hash?.equals(rows[i - 1]?.hash ?? Buffer.alloc(0))).toBe(true);
    }
    expect(rows.every((row) => row.hash.length === 32)).toBe(true);

    const result = await verifyAuditChain(worker(), {
      month: '2026-11',
      clock: sealClock('2026-11-10T09:00:00Z'),
    });
    expect(result).toMatchObject({ ok: true, checked: 5, staleUnsealedCount: 0 });
  });

  it('leaves rows younger than the safety lag for a later run', async () => {
    await writeRows('2026-11-11T08:00:00Z', 1, 'lag');
    expect((await seal('2026-11-11T08:00:05Z', 10, 30_000)).sealed).toBe(0);
    expect((await seal('2026-11-11T08:00:40Z', 10, 30_000)).sealed).toBe(1);
  });

  it('seals a row that committed late with an earlier time after the later rows, and still verifies', async () => {
    // A transaction that has written its audit row but not yet committed.
    const clock = new FixedClock('2028-01-12T08:00:00Z');
    const held = gate();
    const written = gate();
    const lateId = uuid();
    const slow = withDbContext(api(), tenant(), async (tx) => {
      await tx.auditLog.createMany({
        data: [
          {
            id: lateId,
            occurredAt: clock.now(),
            action: 'test.late',
            entityType: 'test',
            entityId: uuid(),
          },
        ],
      });
      written.open();
      await held.wait;
    });
    await written.wait;

    await writeRows('2028-01-12T08:10:00Z', 2, 'later');
    expect((await seal('2028-01-12T08:30:00Z')).sealed).toBe(2);

    held.open();
    await slow;
    expect((await seal('2028-01-12T08:31:00Z')).sealed).toBe(1);

    const rows = await chain('2028-01-01');
    expect(rows.map((row) => row.seq)).toEqual(['1', '2', '3']);
    expect(rows[2]?.audit_log_id).toBe(lateId);
    const result = await verifyAuditChain(worker(), {
      month: new Date('2028-01-12T00:00:00Z'),
      clock: sealClock('2028-01-12T09:30:00Z'),
    });
    expect(result).toMatchObject({ ok: true, checked: 3 });
  });

  it('starts a new chain, with no previous hash, at the first instant of a month', async () => {
    const [lastOfNovember] = await writeRows('2026-12-31T23:59:59Z', 1, 'dec');
    const [firstOfJanuary] = await writeRows('2027-01-01T00:00:00Z', 1, 'jan');
    const result = await seal('2027-01-01T01:00:00Z', 500);
    expect(result.months).toEqual(['2026-12-01', '2027-01-01']);

    const december = await chain('2026-12-01');
    const january = await chain('2027-01-01');
    expect(december.map((row) => row.audit_log_id)).toEqual([lastOfNovember]);
    expect(january.map((row) => row.audit_log_id)).toEqual([firstOfJanuary]);
    expect(january[0]?.seq).toBe('1');
    expect(january[0]?.prev_hash).toBeNull();
    for (const month of ['2026-12', '2027-01']) {
      expect(
        (await verifyAuditChain(worker(), { month, clock: sealClock('2027-01-01T01:00:00Z') })).ok,
      ).toBe(true);
    }
  });

  it('keeps one consistent chain when several sealers run at once', async () => {
    await writeRows('2027-02-03T08:00:00Z', 20, 'race');
    const results = await Promise.all([
      seal('2027-02-03T09:00:00Z', 8),
      seal('2027-02-03T09:00:00Z', 8),
      seal('2027-02-03T09:00:00Z', 8),
    ]);
    const sealedNow = results.reduce((total, result) => total + result.sealed, 0);
    expect(sealedNow).toBe(20);
    expect((await seal('2027-02-03T09:00:00Z', 8)).sealed).toBe(0);

    const rows = await chain('2027-02-01');
    expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(new Set(rows.map((row) => row.audit_log_id)).size).toBe(20);
    expect(
      (
        await verifyAuditChain(worker(), {
          month: '2027-02',
          clock: sealClock('2027-02-03T09:00:00Z'),
        })
      ).checked,
    ).toBe(20);
  });

  describe('verification catches tampering, done as the database owner', () => {
    const verify = (month: string, now = '2027-12-31T00:00:00Z') =>
      verifyAuditChain(worker(), { month, clock: sealClock(now) });

    async function sealedMonth(start: string, count: number): Promise<string[]> {
      const ids = await writeRows(start, count, 'tamper');
      await seal('2027-12-30T00:00:00Z');
      return ids;
    }

    it('a modified audit row', async () => {
      const ids = await sealedMonth('2027-03-05T08:00:00Z', 5);
      expect((await verify('2027-03')).ok).toBe(true);
      await tamper(`UPDATE audit_log SET "after" = '{"label":"forged"}' WHERE id = $1`, [ids[2]]);
      const result = await verify('2027-03');
      expect(result.ok).toBe(false);
      expect(result.break).toMatchObject({ kind: 'HASH_MISMATCH', seq: '3', auditLogId: ids[2] });
      expect(result.checked).toBe(2);
    });

    it('a deleted audit row', async () => {
      const ids = await sealedMonth('2027-04-05T08:00:00Z', 4);
      await tamper('DELETE FROM audit_log WHERE id = $1', [ids[1]]);
      const result = await verify('2027-04');
      expect(result.break).toMatchObject({ kind: 'MISSING_ROW', seq: '2', auditLogId: ids[1] });
    });

    it('a modified chain hash', async () => {
      const ids = await sealedMonth('2027-05-05T08:00:00Z', 4);
      await tamper(
        `UPDATE audit_log_chain SET hash = decode(repeat('00', 32), 'hex') WHERE audit_log_id = $1`,
        [ids[1]],
      );
      expect((await verify('2027-05')).break).toMatchObject({ kind: 'HASH_MISMATCH', seq: '2' });
    });

    it('a broken link', async () => {
      const ids = await sealedMonth('2027-06-05T08:00:00Z', 4);
      await tamper(
        `UPDATE audit_log_chain SET prev_hash = decode(repeat('11', 32), 'hex') WHERE audit_log_id = $1`,
        [ids[2]],
      );
      expect((await verify('2027-06')).break).toMatchObject({ kind: 'BROKEN_LINK', seq: '3' });
    });

    it('a removed chain entry', async () => {
      const ids = await sealedMonth('2027-07-05T08:00:00Z', 4);
      await tamper('DELETE FROM audit_log_chain WHERE audit_log_id = $1', [ids[1]]);
      expect((await verify('2027-07')).break).toMatchObject({ kind: 'SEQ_GAP', seq: '3' });
    });

    it('lists rows that stay unsealed for more than an hour, and not younger ones', async () => {
      const ids = await writeRows('2027-08-05T10:00:00Z', 2, 'stale');
      const young = await verify('2027-08', '2027-08-05T10:30:00Z');
      expect(young).toMatchObject({ ok: true, staleUnsealedCount: 0 });
      const stale = await verify('2027-08', '2027-08-05T11:00:00.500Z');
      expect(stale.ok).toBe(true);
      expect(stale.staleUnsealedCount).toBe(1);
      expect(stale.staleUnsealed.map((row) => row.id)).toEqual([ids[0]]);
    });

    it('verifies every month at once and lists the months that have rows', async () => {
      const months = await listAuditMonths(worker());
      expect(months).toEqual(expect.arrayContaining(['2026-11-01', '2027-03-01', '2027-08-01']));
      const all = await verifyAllAuditChains(worker(), {
        clock: sealClock('2027-12-31T00:00:00Z'),
      });
      expect(all.map((result) => result.month)).toEqual(months);
      expect(all.filter((result) => !result.ok).map((result) => result.month)).toEqual(
        expect.arrayContaining(['2027-03-01', '2027-04-01', '2027-07-01']),
      );
    });
  });
});
