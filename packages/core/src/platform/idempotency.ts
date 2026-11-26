import { createHash } from 'node:crypto';
import { type Prisma, type PrismaClient, uuidv7, withDbContext } from '@labconnect/database';
import { canonicalJson } from './canonical-json.js';
import type { Clock } from './clock.js';

// The Idempotency-Key mechanism (API_CONVENTIONS.md section 5). Framework-free (ADR-020): the API's
// interceptor wraps it. Table: `idempotency_record`, unique on (key, user, route) NULLS NOT DISTINCT.
//
// What the database allows decides the shape:
// - `app_rw` has SELECT, INSERT and UPDATE, no DELETE. So `abandon` expires the row instead of
//   deleting it, and a begin on an expired row reuses it in place. `app_worker` deletes expired
//   rows (`purgeExpiredIdempotencyRecords`).
// - The row policy is `own_user`: a request sees only its own user's rows. Every call here runs in
//   the user-only context (`tenant`, no organisation), never in the system context.
// - The table has no column for response headers: a replay repeats the status and the body only.

/** How long a record is kept: 24 hours from the request that created it. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How long an IN_PROGRESS record is believed. Older than this, the process that made it is
 * presumed dead and a repeat of the same request may take it over. The first attempt's writes may
 * already be committed, so a takeover can run an operation twice unless it is safe to repeat.
 */
export const IDEMPOTENCY_LOCK_TIMEOUT_MS = 60_000;

const MAX_ROUTE_LENGTH = 200;
const KEY_PATTERN = /^[\x21-\x7e]{1,100}$/;
const CLAIM_ATTEMPTS = 3;

/** 1 to 100 characters, visible ASCII (the contract's `minLength` and `maxLength`, no spaces). */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * SHA-256 of the canonical JSON of the body, so key order does not matter. A missing body and `{}`
 * are the same request. Never log the input or the result's source.
 */
export function hashRequestBody(body: unknown): Buffer {
  return createHash('sha256')
    .update(canonicalJson(body ?? {}))
    .digest();
}

export interface IdempotencyRequest {
  /** From the header; check it with `isValidIdempotencyKey` first. */
  key: string;
  /** The authenticated user. There is no anonymous mode (OQ-42). */
  actorUserId: string;
  /** Method and concrete path without the query, at most 200 characters. See API_CONVENTIONS.md. */
  route: string;
  requestHash: Buffer;
}

/** Proof of holding a record. Completing or abandoning with a lost claim does nothing. */
export interface IdempotencyClaim {
  id: string;
  actorUserId: string;
  lockedAt: Date;
}

export interface StoredResponse {
  status: number;
  /** JSON, kept as data at rest. It can hold personal data: never log it. */
  body: unknown;
}

export type BeginResult =
  | { kind: 'started'; claim: IdempotencyClaim; takenOver: boolean }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'in_progress' }
  | { kind: 'reused' };

interface RecordRow {
  id: string;
  request_hash: Uint8Array;
  status: 'IN_PROGRESS' | 'COMPLETED';
  response_status: number | null;
  response_body: unknown;
  expires_at: Date;
  created_at: Date;
}

type Db = Pick<PrismaClient, '$transaction'>;

export class IdempotencyService {
  constructor(
    private readonly prisma: Db,
    private readonly clock: Clock,
  ) {}

  /**
   * Claims the key, or says what the existing record means. The claim is the INSERT: two
   * simultaneous identical requests race on the unique index and exactly one inserts.
   */
  async begin(input: IdempotencyRequest): Promise<BeginResult> {
    if (!isValidIdempotencyKey(input.key)) throw new RangeError('Invalid idempotency key.');
    if (input.route.length === 0 || input.route.length > MAX_ROUTE_LENGTH) {
      throw new RangeError(`The route must be 1 to ${String(MAX_ROUTE_LENGTH)} characters.`);
    }
    if (input.actorUserId === '') throw new RangeError('An authenticated user is required.');
    return await this.asUser(input.actorUserId, (tx) => this.claim(tx, input));
  }

  /**
   * Stores the response and finishes the record. Pass the `tx` of the handler's own transaction
   * (opened for the same user) to commit the response together with the business write; without
   * one it runs in a transaction of its own, after the business commit. Returns false when the
   * claim was lost (taken over, or abandoned).
   */
  complete(
    claim: IdempotencyClaim,
    response: StoredResponse,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const body = JSON.stringify(response.body ?? null);
    return this.within(claim, tx, async (client) => {
      const rows = await client.$queryRaw<{ id: string }[]>`
        UPDATE idempotency_record
           SET status = 'COMPLETED'::idempotency_status,
               response_status = ${response.status}::int,
               response_body = ${body}::jsonb
         WHERE id = ${claim.id}::uuid
           AND status = 'IN_PROGRESS'::idempotency_status
           AND created_at = ${claim.lockedAt}::timestamptz
        RETURNING id`;
      return rows.length === 1;
    });
  }

  /**
   * Frees the key so the client can retry: the record expires now (there is no DELETE for the API
   * role) and the next begin reuses it. Returns false when the claim was lost.
   */
  abandon(claim: IdempotencyClaim, tx?: Prisma.TransactionClient): Promise<boolean> {
    const now = this.clock.now();
    return this.within(claim, tx, async (client) => {
      const rows = await client.$queryRaw<{ id: string }[]>`
        UPDATE idempotency_record
           SET expires_at = ${now}::timestamptz
         WHERE id = ${claim.id}::uuid
           AND status = 'IN_PROGRESS'::idempotency_status
           AND created_at = ${claim.lockedAt}::timestamptz
        RETURNING id`;
      return rows.length === 1;
    });
  }

  private within<T>(
    claim: IdempotencyClaim,
    tx: Prisma.TransactionClient | undefined,
    work: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx ? work(tx) : this.asUser(claim.actorUserId, work);
  }

  private asUser<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withDbContext(this.prisma, { kind: 'tenant', orgId: '', userId }, work);
  }

  private async claim(
    tx: Prisma.TransactionClient,
    input: IdempotencyRequest,
  ): Promise<BeginResult> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS);
    const { key, actorUserId: user, route, requestHash: hash } = input;
    const started = (id: string, lockedAt: Date, takenOver: boolean): BeginResult => ({
      kind: 'started',
      claim: { id, actorUserId: user, lockedAt },
      takenOver,
    });

    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      const id = uuidv7(now.getTime());
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_record
               (id, idempotency_key, actor_user_id, route, request_hash, status,
                expires_at, created_at, created_by_user_id)
        VALUES (${id}::uuid, ${key}, ${user}::uuid, ${route}, ${hash}::bytea,
                'IN_PROGRESS'::idempotency_status, ${expiresAt}::timestamptz,
                ${now}::timestamptz, ${user}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (inserted.length === 1) return started(id, now, false);

      const [row] = await tx.$queryRaw<RecordRow[]>`
        SELECT id, request_hash, status, response_status, response_body, expires_at, created_at
          FROM idempotency_record
         WHERE idempotency_key = ${key}
           AND actor_user_id = ${user}::uuid
           AND route = ${route}`;
      if (!row) continue; // purged between the two statements: claim again

      if (row.expires_at.getTime() <= now.getTime()) {
        // Expired counts as absent. Reuse the row in place; of several racers one wins.
        // The lock time (`created_at`) identifies the holder, so it always moves forward.
        const [reused] = await tx.$queryRaw<{ created_at: Date }[]>`
          UPDATE idempotency_record
             SET request_hash = ${hash}::bytea, status = 'IN_PROGRESS'::idempotency_status,
                 response_status = NULL, response_body = NULL,
                 expires_at = ${expiresAt}::timestamptz,
                 created_at = GREATEST(${now}::timestamptz, created_at + interval '1 millisecond')
           WHERE id = ${row.id}::uuid AND expires_at <= ${now}::timestamptz
          RETURNING created_at`;
        if (reused) return started(row.id, reused.created_at, false);
        continue;
      }
      if (!Buffer.from(row.request_hash).equals(hash)) return { kind: 'reused' };
      if (row.status === 'COMPLETED' && row.response_status !== null) {
        return {
          kind: 'replay',
          response: { status: row.response_status, body: row.response_body },
        };
      }
      if (now.getTime() - row.created_at.getTime() < IDEMPOTENCY_LOCK_TIMEOUT_MS) {
        return { kind: 'in_progress' };
      }
      // Stale IN_PROGRESS: compare-and-swap on the lock time, so one racer takes it over.
      const [taken] = await tx.$queryRaw<{ created_at: Date }[]>`
        UPDATE idempotency_record
           SET created_at = GREATEST(${now}::timestamptz, created_at + interval '1 millisecond'),
               expires_at = ${expiresAt}::timestamptz
         WHERE id = ${row.id}::uuid AND status = 'IN_PROGRESS'::idempotency_status
           AND created_at = ${row.created_at}::timestamptz
        RETURNING created_at`;
      return taken ? started(row.id, taken.created_at, true) : { kind: 'in_progress' };
    }
    throw new Error('The idempotency record could not be claimed.');
  }
}

export interface PurgeOptions {
  batchSize?: number;
}

/**
 * Deletes records past `expires_at`, one batch. Runs as the worker, in the system context: the
 * policy lets only `system` see other users' rows, and `app_worker` is the one role with DELETE.
 * Returns a count only.
 */
export async function purgeExpiredIdempotencyRecords(
  prisma: Db,
  clock: Clock,
  options: PurgeOptions = {},
): Promise<{ deleted: number }> {
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer.');
  }
  const now = clock.now();
  return await withDbContext(prisma, { kind: 'system' }, async (tx) => ({
    deleted: await tx.$executeRaw`
      DELETE FROM idempotency_record
       WHERE id IN (SELECT id FROM idempotency_record
                     WHERE expires_at <= ${now}::timestamptz
                     ORDER BY expires_at LIMIT ${batchSize}
                       FOR UPDATE SKIP LOCKED)`,
  }));
}
