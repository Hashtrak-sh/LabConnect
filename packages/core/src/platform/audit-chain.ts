import { createHash } from 'node:crypto';
import { type Prisma, type PrismaClient, uuidv7, withDbContext } from '@labconnect/database';
import { canonicalJson } from './canonical-json.js';
import type { Clock } from './clock.js';

/**
 * Audit hash chain (AUDIT_AND_EVENT_ARCHITECTURE.md section 2, SCHEMA_SPECIFICATION.md 1.8).
 *
 * A job (the worker) seals audit rows into `audit_log_chain`, one chain per UTC month of the
 * row's `occurred_at`: `hash = SHA-256(prev_hash || canonical_json(row))`, where `row` is
 * every column of the audit row (`CHAIN_ROW_COLUMNS`) and `prev_hash` is empty for seq 1.
 *
 * Rows are sealed oldest first, in (`occurred_at`, `id`) order, but only rows older than a
 * safety lag, so that a transaction that committed a little late is normally sealed in its
 * place. A row that still commits after the lag is sealed on a later run with a higher
 * `seq` than rows with a later `occurred_at`. The chain order is `seq`, not `occurred_at`:
 * the verifier follows `seq` and never requires `occurred_at` to increase. That keeps the
 * chain append-only (nothing is ever re-sealed) at the cost of a chain that is only
 * approximately in time order (OQ-61).
 */

export const DEFAULT_SEAL_BATCH_SIZE = 500;
/** Rows younger than this are left for the next run. */
export const DEFAULT_SEAL_SAFETY_LAG_MS = 30_000;
/** A row unsealed for longer than this is reported by the verifier (the architecture says one hour). */
export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

const SEAL_LOCK_NAME = 'labconnect.audit_log.seal';
const TX_OPTIONS = { maxWait: 30_000, timeout: 120_000 };

type Db = Pick<PrismaClient, '$transaction'>;

/** The audit row as it is hashed: every column, with a fixed text form for each. */
export interface ChainRow {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  actor_role: string | null;
  actor_org_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

/**
 * The SELECT list that produces a `ChainRow`. Timestamps come out as text with microseconds
 * (a JavaScript Date would drop them) and the enum and address as text, so the hash does
 * not depend on a driver's type mapping.
 */
const CHAIN_ROW_COLUMNS = `
  a.id::text AS id,
  to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  a.actor_user_id::text AS actor_user_id,
  a.actor_membership_id::text AS actor_membership_id,
  a.actor_role::text AS actor_role,
  a.actor_org_id::text AS actor_org_id,
  a.action AS action,
  a.entity_type AS entity_type,
  a.entity_id::text AS entity_id,
  a."before" AS "before",
  a."after" AS "after",
  a.reason AS reason,
  a.request_id AS request_id,
  host(a.ip_address) AS ip_address,
  a.user_agent AS user_agent`;

export function chainHash(prevHash: Uint8Array | null, row: ChainRow): Buffer {
  const hash = createHash('sha256');
  if (prevHash !== null) hash.update(prevHash);
  hash.update(canonicalJson(row), 'utf8');
  return hash.digest();
}

/** `2026-11-25T10:00:00.123456Z` becomes `2026-11-01`. */
function monthOf(occurredAt: string): string {
  return `${occurredAt.slice(0, 7)}-01`;
}

function monthStart(month: string): Date {
  return new Date(`${month}T00:00:00.000Z`);
}

function nextMonthStart(month: string): Date {
  const start = monthStart(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export function normaliseMonth(month: string | Date): string {
  if (month instanceof Date) {
    return `${String(month.getUTCFullYear())}-${String(month.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  const match = /^(\d{4})-(\d{2})(?:-01)?$/.exec(month);
  if (!match) throw new RangeError(`"${month}" is not a month (expected YYYY-MM).`);
  return `${match[1] ?? ''}-${match[2] ?? ''}-01`;
}

export interface SealOptions {
  /** Most rows sealed per call. */
  batchSize?: number;
  /** Rows younger than this stay unsealed until a later run. */
  safetyLagMs?: number;
}

export interface SealResult {
  /** How many rows were appended to the chains. */
  sealed: number;
  /** The months (`YYYY-MM-01`) that received rows. */
  months: string[];
}

/**
 * Seals the oldest unsealed audit rows. Runs as the worker (system context) in one
 * transaction. A transaction-scoped advisory lock serialises concurrent sealers, so two
 * workers (or two calls) can never both read the same chain tail and fork the chain; the
 * second one waits, then continues from what the first committed.
 */
export async function sealAuditLog(
  prisma: Db,
  clock: Clock,
  options: SealOptions = {},
): Promise<SealResult> {
  const batchSize = options.batchSize ?? DEFAULT_SEAL_BATCH_SIZE;
  const lag = options.safetyLagMs ?? DEFAULT_SEAL_SAFETY_LAG_MS;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer.');
  }

  return withDbContext(
    prisma,
    { kind: 'system' },
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${SEAL_LOCK_NAME}, 0))`;
      // Taken after the lock: another sealer may have committed while this one waited.
      const cutoff = new Date(clock.now().getTime() - lag);
      const rows = await tx.$queryRawUnsafe<ChainRow[]>(
        `SELECT ${CHAIN_ROW_COLUMNS}
           FROM audit_log a
          WHERE a.occurred_at <= $1
            AND NOT EXISTS (SELECT 1 FROM audit_log_chain c WHERE c.audit_log_id = a.id)
          ORDER BY a.occurred_at, a.id
          LIMIT $2`,
        cutoff,
        batchSize,
      );
      if (rows.length === 0) return { sealed: 0, months: [] };

      const tails = new Map<string, { seq: bigint; hash: Buffer | null }>();
      const data: Prisma.AuditLogChainCreateManyInput[] = [];
      for (const row of rows) {
        const month = monthOf(row.occurred_at);
        let tail = tails.get(month);
        if (!tail) {
          const last = await tx.auditLogChain.findFirst({
            where: { chainMonth: monthStart(month) },
            orderBy: { seq: 'desc' },
            select: { seq: true, hash: true },
          });
          tail = last ? { seq: last.seq, hash: Buffer.from(last.hash) } : { seq: 0n, hash: null };
        }
        const hash = chainHash(tail.hash, row);
        const seq = tail.seq + 1n;
        data.push({
          id: uuidv7(clock.now().getTime()),
          chainMonth: monthStart(month),
          seq,
          auditLogId: row.id,
          auditOccurredAt: new Date(row.occurred_at.replace(/\.(\d{3})\d{3}Z$/, '.$1Z')),
          prevHash: tail.hash === null ? null : new Uint8Array(tail.hash),
          hash: new Uint8Array(hash),
        });
        tails.set(month, { seq, hash });
      }
      await tx.auditLogChain.createMany({ data });
      return { sealed: data.length, months: [...tails.keys()].sort() };
    },
    TX_OPTIONS,
  );
}

// ------------------------------------------------------------------ verification

export type AuditChainBreakKind =
  /** A chain entry's seq is not the next one: an entry was removed or inserted. */
  | 'SEQ_GAP'
  /** An entry's `prev_hash` is not the previous entry's `hash`. */
  | 'BROKEN_LINK'
  /** The audit row a chain entry points to no longer exists. */
  | 'MISSING_ROW'
  /** The hash recomputed from the audit row is not the stored one: the row or the hash was changed. */
  | 'HASH_MISMATCH';

export interface AuditChainBreak {
  kind: AuditChainBreakKind;
  seq: string;
  auditLogId: string;
  detail: string;
}

export interface UnsealedRow {
  id: string;
  occurredAt: string;
}

export interface AuditChainVerification {
  /** `YYYY-MM-01` */
  month: string;
  ok: boolean;
  /** Chain entries that were checked before the first break (or all of them). */
  checked: number;
  /** The first break, if any. */
  break?: AuditChainBreak;
  /** Rows of this month with no chain entry that are older than `staleAfterMs` (up to 100). */
  staleUnsealed: UnsealedRow[];
  /** How many such rows there are in all. */
  staleUnsealedCount: number;
}

export interface VerifyOptions {
  month: string | Date;
  clock: Clock;
  staleAfterMs?: number;
  /** Chain entries read per query. */
  pageSize?: number;
}

const STALE_LIST_LIMIT = 100;

/**
 * Recomputes one month's chain from the audit rows and reports the first break, plus the
 * rows that have waited more than `staleAfterMs` (default one hour) to be sealed. It cannot
 * see the removal of the newest entries together with their audit rows; the newest hash
 * should also be exported outside the database (OQ-61).
 */
export async function verifyAuditChain(
  prisma: Db,
  options: VerifyOptions,
): Promise<AuditChainVerification> {
  const month = normaliseMonth(options.month);
  const pageSize = options.pageSize ?? 500;
  const staleBefore = new Date(
    options.clock.now().getTime() - (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
  );

  return withDbContext(
    prisma,
    { kind: 'system' },
    async (tx) => {
      let checked = 0;
      let expectedSeq = 1n;
      let prevHash: Buffer | null = null;
      let found: AuditChainBreak | undefined;

      scan: for (;;) {
        const page = await tx.auditLogChain.findMany({
          where: { chainMonth: monthStart(month), seq: { gte: expectedSeq } },
          orderBy: { seq: 'asc' },
          take: pageSize,
        });
        if (page.length === 0) break;

        const audited = await readAuditRows(
          tx,
          page.map((entry) => entry.auditLogId),
          page.map((entry) => entry.auditOccurredAt),
        );
        for (const entry of page) {
          const base = { seq: entry.seq.toString(), auditLogId: entry.auditLogId };
          if (entry.seq !== expectedSeq) {
            found = {
              ...base,
              kind: 'SEQ_GAP',
              detail: `expected seq ${expectedSeq.toString()}, found ${entry.seq.toString()}`,
            };
            break scan;
          }
          const storedPrev = entry.prevHash === null ? null : Buffer.from(entry.prevHash);
          if (!sameBytes(storedPrev, prevHash)) {
            found = {
              ...base,
              kind: 'BROKEN_LINK',
              detail: 'prev_hash differs from the previous hash',
            };
            break scan;
          }
          const row = audited.get(entry.auditLogId);
          if (!row) {
            found = { ...base, kind: 'MISSING_ROW', detail: 'the audit row no longer exists' };
            break scan;
          }
          const storedHash = Buffer.from(entry.hash);
          if (!sameBytes(chainHash(prevHash, row), storedHash)) {
            found = {
              ...base,
              kind: 'HASH_MISMATCH',
              detail: 'the hash of the audit row differs from the stored hash',
            };
            break scan;
          }
          prevHash = storedHash;
          expectedSeq += 1n;
          checked += 1;
        }
        if (page.length < pageSize) break;
      }

      const window = [monthStart(month), nextMonthStart(month), staleBefore] as const;
      const stale = await tx.$queryRaw<{ id: string; occurred_at: string }[]>`
        SELECT a.id::text AS id,
               to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
          FROM audit_log a
         WHERE a.occurred_at >= ${window[0]} AND a.occurred_at < ${window[1]}
           AND a.occurred_at < ${window[2]}
           AND NOT EXISTS (SELECT 1 FROM audit_log_chain c WHERE c.audit_log_id = a.id)
         ORDER BY a.occurred_at, a.id
         LIMIT ${STALE_LIST_LIMIT}`;
      const total = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n
          FROM audit_log a
         WHERE a.occurred_at >= ${window[0]} AND a.occurred_at < ${window[1]}
           AND a.occurred_at < ${window[2]}
           AND NOT EXISTS (SELECT 1 FROM audit_log_chain c WHERE c.audit_log_id = a.id)`;

      const result: AuditChainVerification = {
        month,
        ok: found === undefined,
        checked,
        staleUnsealed: stale.map((row) => ({ id: row.id, occurredAt: row.occurred_at })),
        staleUnsealedCount: Number(total[0]?.n ?? 0n),
      };
      if (found) result.break = found;
      return result;
    },
    TX_OPTIONS,
  );
}

/** The months that have chain entries or audit rows, oldest first (`YYYY-MM-01`). */
export async function listAuditMonths(prisma: Db): Promise<string[]> {
  return withDbContext(prisma, { kind: 'system' }, async (tx) => {
    const rows = await tx.$queryRaw<{ month: string }[]>`
      SELECT to_char(m, 'YYYY-MM-01') AS month FROM (
        SELECT DISTINCT date_trunc('month', occurred_at AT TIME ZONE 'UTC') AS m FROM audit_log
        UNION
        SELECT DISTINCT chain_month::timestamp FROM audit_log_chain
      ) months ORDER BY 1`;
    return rows.map((row) => row.month);
  });
}

/** Verifies every month that has audit rows or chain entries. */
export async function verifyAllAuditChains(
  prisma: Db,
  options: Omit<VerifyOptions, 'month'>,
): Promise<AuditChainVerification[]> {
  const results: AuditChainVerification[] = [];
  for (const month of await listAuditMonths(prisma)) {
    results.push(await verifyAuditChain(prisma, { ...options, month }));
  }
  return results;
}

async function readAuditRows(
  tx: Prisma.TransactionClient,
  ids: string[],
  occurredAt: Date[],
): Promise<Map<string, ChainRow>> {
  const rows = await tx.$queryRawUnsafe<ChainRow[]>(
    `SELECT ${CHAIN_ROW_COLUMNS}
       FROM audit_log a
       JOIN unnest($1::uuid[], $2::timestamptz[]) AS k(id, occurred_at)
         ON a.id = k.id AND date_trunc('milliseconds', a.occurred_at) = k.occurred_at`,
    ids,
    occurredAt.map((instant) => instant.toISOString()),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}
