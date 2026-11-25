import {
  type Prisma,
  type PrismaClient,
  type TimerType,
  uuidv7,
  withDbContext,
} from '@labconnect/database';
import type { BusinessCalendar } from './business-calendar.js';
import type { Clock } from './clock.js';

export const DEFAULT_TIMER_BATCH_SIZE = 50;
/** A timer whose handler failed this many times is marked FAILED and left for a person (OQ-83). */
export const DEFAULT_TIMER_MAX_ATTEMPTS = 10;
const MAX_ERROR_LENGTH = 500;
const MAX_AGGREGATE_TYPE = 60;

export interface TimerAggregate {
  type: string;
  id: string;
}

export interface NewTimer {
  type: TimerType;
  aggregate: TimerAggregate;
  dueAt: Date;
  /** Anything the handler needs besides the aggregate. Never logged. */
  payload?: Prisma.InputJsonValue;
}

export interface NewBusinessTimer {
  type: TimerType;
  aggregate: TimerAggregate;
  /** The calendar of the lab site the timer runs on (BR-090). */
  calendar: BusinessCalendar;
  /** Business minutes from `from`. */
  businessMinutes: number;
  /** Defaults to the clock's now. */
  from?: Date;
  payload?: Prisma.InputJsonValue;
}

/** A pending timer as a handler sees it. */
export interface DueTimer {
  id: string;
  type: TimerType;
  aggregate: TimerAggregate;
  dueAt: Date;
  /** How many earlier attempts failed. */
  attempts: number;
  payload: unknown;
}

/**
 * Runs when a timer is due, inside the timer's own transaction in the system context.
 *
 * It must re-check the aggregate's state itself and do nothing if the timer no longer
 * applies (the booking already moved on): a cancel can lose a race with the worker, and a
 * business-hours timer is never recalculated when a lab changes its hours (ADR-008).
 * Throwing rolls back everything the handler wrote and counts as a failed attempt.
 * Writes that must persist even on failure do not belong in a handler.
 */
export type TimerHandler = (
  tx: Prisma.TransactionClient,
  timer: DueTimer,
  clock: Clock,
) => Promise<void>;

/** Handlers by timer type. Later modules each register their own types. */
export class TimerHandlerRegistry {
  private readonly handlers = new Map<TimerType, TimerHandler>();

  register(type: TimerType, handler: TimerHandler): this {
    if (this.handlers.has(type)) {
      throw new Error(`A handler for timer type ${type} is already registered.`);
    }
    this.handlers.set(type, handler);
    return this;
  }

  get(type: TimerType): TimerHandler | undefined {
    return this.handlers.get(type);
  }

  types(): TimerType[] {
    return [...this.handlers.keys()];
  }
}

export interface RunDueOptions {
  /** The most timers one pass handles. */
  batchSize?: number;
  maxAttempts?: number;
  /**
   * Timer ids not to select. The pass adds every timer it takes to this set, so a caller that
   * repeats passes within one run (to drain a backlog) passes the same set each time and a
   * failing timer is not retried, and its attempts used up, again within that run.
   */
  skipIds?: Set<string>;
}

export interface RunDueResult {
  fired: number;
  /** The handler failed; the timer stays PENDING for the next pass. */
  retried: number;
  /** The handler failed for the last time; the timer is now FAILED. */
  failed: number;
  /** Due PENDING timers whose type has no handler yet, by type. They are left untouched. */
  unhandled: Partial<Record<TimerType, number>>;
}

interface TimerRow {
  id: string;
  timer_type: TimerType;
  aggregate_type: string;
  aggregate_id: string;
  due_at: Date;
  attempts: number;
  payload: unknown;
}

/**
 * Schedules and cancels timers (AUDIT_AND_EVENT_ARCHITECTURE.md section 4, ADR-008).
 * `schedule` and `cancel` work inside the caller's transaction, as the API or the worker.
 *
 * Under row-level security every request may INSERT a timer but only the system context may
 * read or update one. So `schedule` uses `createMany` (no `RETURNING`, which needs SELECT)
 * and `cancel` goes through two narrow SECURITY DEFINER functions that can only move a
 * PENDING timer to CANCELLED (migration 20261125090000).
 */
export class TimerService {
  constructor(private readonly clock: Clock) {}

  /** Adds a PENDING timer and returns its id. */
  async schedule(tx: Prisma.TransactionClient, timer: NewTimer): Promise<{ id: string }> {
    const { aggregate } = timer;
    if (aggregate.type.length === 0 || aggregate.type.length > MAX_AGGREGATE_TYPE) {
      throw new RangeError(
        `The aggregate type must be 1 to ${String(MAX_AGGREGATE_TYPE)} characters.`,
      );
    }
    if (Number.isNaN(timer.dueAt.getTime()))
      throw new RangeError('The due time is not a valid date.');
    const id = uuidv7(this.clock.now().getTime());
    await tx.timer.createMany({
      data: [
        {
          id,
          timerType: timer.type,
          aggregateType: aggregate.type,
          aggregateId: aggregate.id,
          dueAt: timer.dueAt,
          ...(timer.payload === undefined ? {} : { payload: timer.payload }),
        },
      ],
    });
    return { id };
  }

  /** Schedules a timer `businessMinutes` of lab business time from now (BR-012). Returns the id and the due time. */
  async scheduleAfterBusinessTime(
    tx: Prisma.TransactionClient,
    timer: NewBusinessTimer,
  ): Promise<{ id: string; dueAt: Date }> {
    const dueAt = timer.calendar.addBusinessMinutes(
      timer.from ?? this.clock.now(),
      timer.businessMinutes,
    );
    const { id } = await this.schedule(tx, {
      type: timer.type,
      aggregate: timer.aggregate,
      dueAt,
      ...(timer.payload === undefined ? {} : { payload: timer.payload }),
    });
    return { id, dueAt };
  }

  /** Cancels one PENDING timer. Returns false if it was not pending (fired, cancelled or unknown). */
  async cancel(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ count: number }[]>`
      SELECT cancel_timer(${id}::uuid) AS count`;
    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Cancels the PENDING timers of an aggregate, of the given types or of every type.
   * Returns how many were cancelled.
   */
  async cancelForAggregate(
    tx: Prisma.TransactionClient,
    aggregate: TimerAggregate,
    types?: readonly TimerType[],
  ): Promise<number> {
    const list = types ? [...types] : null;
    const rows = await tx.$queryRaw<{ count: number }[]>`
      SELECT cancel_timers(${aggregate.type}, ${aggregate.id}::uuid, ${list}::text[]::timer_type[]) AS count`;
    return rows[0]?.count ?? 0;
  }

  /** The worker pass, see `runDueTimers`. */
  runDue(
    prisma: Pick<PrismaClient, '$transaction'>,
    handlers: TimerHandlerRegistry,
    options: RunDueOptions = {},
  ): Promise<RunDueResult> {
    return runDueTimers(prisma, this.clock, handlers, options);
  }
}

/**
 * The worker pass: runs the handlers of timers that are due.
 *
 * Structure: one transaction per timer, in the system context.
 * 1. `SELECT ... WHERE status = 'PENDING' AND due_at <= now AND type has a handler AND id not
 *    yet seen in this pass ORDER BY due_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`. The row lock
 *    is the claim: a second worker skips the row, and after commit the status filter hides it.
 * 2. `SAVEPOINT`, then the handler. On success the same transaction marks the timer FIRED, so
 *    the handler's writes and the FIRED mark commit together or not at all.
 * 3. On a handler error: `ROLLBACK TO SAVEPOINT` undoes only the handler's writes (and heals
 *    the transaction if the error was a failed SQL statement), then the attempt is recorded
 *    in the same transaction and committed. The lock is held throughout, so nobody else can
 *    pick the timer up between the failure and the record of it.
 *
 * Why not one transaction for the whole batch, as the relay does: a long transaction would
 * hold every row lock until the last handler ends and one slow handler would delay all
 * commits. Why not run the handler in one transaction and record the failure in another:
 * the lock would be released in between and a second worker could run the handler again.
 *
 * A failed timer stays PENDING and is retried on the next pass (the due time is not moved),
 * so passes 15 seconds apart are the back-off. After `maxAttempts` it becomes FAILED. A timer
 * whose type has no handler is never selected, so it stays PENDING; it is counted in
 * `unhandled`. Errors are stored as name and message only, truncated; never the payload.
 */
export async function runDueTimers(
  prisma: Pick<PrismaClient, '$transaction'>,
  clock: Clock,
  handlers: TimerHandlerRegistry,
  options: RunDueOptions = {},
): Promise<RunDueResult> {
  const batchSize = options.batchSize ?? DEFAULT_TIMER_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_TIMER_MAX_ATTEMPTS;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer.');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer.');
  }

  const registered = handlers.types();
  const now = clock.now();
  const result: RunDueResult = { fired: 0, retried: 0, failed: 0, unhandled: {} };
  const seen = options.skipIds ?? new Set<string>();

  if (registered.length > 0) {
    for (let handled = 0; handled < batchSize; handled += 1) {
      const outcome = await withDbContext(
        prisma,
        { kind: 'system' },
        (tx) => processNext(tx, clock, handlers, registered, seen, now, maxAttempts),
        { maxWait: 30_000, timeout: 120_000 },
      );
      if (outcome === 'none') break;
      result[outcome] += 1;
    }
  }

  result.unhandled = await withDbContext(prisma, { kind: 'system' }, (tx) =>
    countUnhandled(tx, registered, now),
  );
  return result;
}

type Outcome = 'fired' | 'retried' | 'failed' | 'none';

async function processNext(
  tx: Prisma.TransactionClient,
  clock: Clock,
  handlers: TimerHandlerRegistry,
  registered: TimerType[],
  seen: Set<string>,
  now: Date,
  maxAttempts: number,
): Promise<Outcome> {
  const rows = await tx.$queryRaw<TimerRow[]>`
    SELECT id::text AS id, timer_type::text AS timer_type, aggregate_type,
           aggregate_id::text AS aggregate_id, due_at, attempts, payload
      FROM timer
     WHERE status = 'PENDING' AND due_at <= ${now}
       AND timer_type = ANY (${registered}::text[]::timer_type[])
       AND id <> ALL (${[...seen]}::text[]::uuid[])
     ORDER BY due_at, id
     LIMIT 1
       FOR UPDATE SKIP LOCKED`;
  const row = rows[0];
  if (!row) return 'none';
  seen.add(row.id);

  const handler = handlers.get(row.timer_type);
  if (!handler) return 'none'; // unreachable: only registered types are selected
  const timer: DueTimer = {
    id: row.id,
    type: row.timer_type,
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    dueAt: row.due_at,
    attempts: row.attempts,
    payload: row.payload,
  };

  await tx.$executeRaw`SAVEPOINT timer_handler`;
  try {
    await handler(tx, timer, clock);
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT timer_handler`;
    const final = row.attempts + 1 >= maxAttempts;
    await tx.$executeRaw`
      UPDATE timer
         SET attempts = attempts + 1, last_error = ${describeError(error)},
             status = ${final ? 'FAILED' : 'PENDING'}::timer_status, lock_version = lock_version + 1
       WHERE id = ${row.id}::uuid`;
    return final ? 'failed' : 'retried';
  }
  await tx.$executeRaw`RELEASE SAVEPOINT timer_handler`;
  await tx.$executeRaw`
    UPDATE timer
       SET status = 'FIRED', fired_at = ${now}, lock_version = lock_version + 1
     WHERE id = ${row.id}::uuid`;
  return 'fired';
}

async function countUnhandled(
  tx: Prisma.TransactionClient,
  registered: TimerType[],
  now: Date,
): Promise<Partial<Record<TimerType, number>>> {
  const rows = await tx.$queryRaw<{ timer_type: TimerType; count: bigint }[]>`
    SELECT timer_type::text AS timer_type, count(*) AS count
      FROM timer
     WHERE status = 'PENDING' AND due_at <= ${now}
       AND timer_type <> ALL (${registered}::text[]::timer_type[])
     GROUP BY timer_type`;
  const counts: Partial<Record<TimerType, number>> = {};
  for (const row of rows) counts[row.timer_type] = Number(row.count);
  return counts;
}

/** The error's name and message, cut short. The payload is never part of it. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  return text.slice(0, MAX_ERROR_LENGTH);
}
