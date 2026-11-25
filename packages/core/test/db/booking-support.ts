import { type DbContext, type Prisma, withDbContext } from '@labconnect/database';
import {
  BOOKING_TRANSITIONS,
  type BookingStatus,
  type BookingTransition,
  type TransitionActor,
  type TransitionId,
} from '@labconnect/shared';
import { beforeAll } from 'vitest';
import {
  createBooking,
  createWorld,
  transition as rawTransition,
} from '../../../database/test/db/fixtures.js';
import type { World } from '../../../database/test/db/fixtures.js';
import {
  AuditService,
  type BookingActor,
  BookingEngine,
  type BookingEngineServices,
  ConfigParameters,
  FixedClock,
  OutboxService,
  TimerService,
  TransitionRegistry,
} from '../../src/index.js';
import { usePlatform, uuid } from './support.js';

export const NOW = '2026-11-25T10:00:00Z';

/** The configuration values the engine reads (the seeds of reference-data.ts, BR-018, 030, 031, 046, 077). */
export const CONFIG_VALUES: Readonly<Record<string, number>> = {
  'payment.window_minutes': 1440,
  'payment.reminder_before_minutes': 120,
  'booking.counter_response_minutes': 1440,
  'handover.hold_decision_minutes': 1440,
  'dispute.window_minutes': 4320,
};

export interface Caller {
  context: DbContext;
  actor: BookingActor;
}

/** The shortest chain of transitions from REQUESTED to each state, by breadth-first search over the shared table. */
function pathTo(target: BookingStatus): { id: TransitionId; to: BookingStatus }[] {
  const queue: { status: BookingStatus; path: { id: TransitionId; to: BookingStatus }[] }[] = [
    { status: 'REQUESTED', path: [] },
  ];
  const seen = new Set<BookingStatus>(['REQUESTED']);
  for (let head = 0; head < queue.length; head += 1) {
    const item = queue[head];
    if (!item) break;
    if (item.status === target) return item.path;
    for (const t of BOOKING_TRANSITIONS) {
      if (t.from.length === 0 || (t.from.length === 1 && t.from[0] === t.to)) continue;
      if (!t.from.includes(item.status) || seen.has(t.to)) continue;
      seen.add(t.to);
      queue.push({ status: t.to, path: [...item.path, { id: t.id, to: t.to }] });
    }
  }
  throw new Error(`no path to ${target}`);
}

/**
 * The world of packages/database/test/db/fixtures.ts, the three database roles, the platform
 * services and an engine factory. Bookings are placed in a state with the owner connection
 * (which is how the database tests do it) so that the code under test is the engine alone.
 */
export function useBookingHarness() {
  const platform = usePlatform();
  const clock = new FixedClock(NOW);
  const audit = new AuditService(clock);
  const outbox = new OutboxService(clock);
  const timers = new TimerService(clock);
  const config = new ConfigParameters(clock, audit);
  const services: BookingEngineServices = { clock, audit, outbox, timers, config };
  let world: World | undefined;
  let colleague = '';
  const colleagueId = (): string => colleague;

  beforeAll(async () => {
    world = await createWorld(platform.db());
    colleague = uuid();
    await platform
      .db()
      .query(
        `INSERT INTO app_user (id, email, full_name, status) VALUES ($1, $2, 'Colleague', 'ACTIVE')`,
        [colleague, `${colleague}@example.test`],
      );
    for (const [key, value] of Object.entries(CONFIG_VALUES)) {
      await platform.owner().configParameter.create({
        data: {
          id: uuid(),
          key,
          scopeType: 'GLOBAL',
          value,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          changeReason: 'test',
        },
      });
    }
  });

  const need = (): World => {
    if (!world) throw new Error('the world is not ready');
    return world;
  };

  const contexts = {
    customer: (): DbContext => ({
      kind: 'tenant',
      orgId: need().orgs.customer,
      userId: need().users.customerAdmin,
    }),
    otherCustomer: (): DbContext => ({
      kind: 'tenant',
      orgId: need().orgs.otherCustomer,
      userId: need().users.otherCustomerAdmin,
    }),
    maker: (): DbContext => ({
      kind: 'tenant',
      orgId: need().orgs.lab,
      userId: need().users.maker,
    }),
    checker: (): DbContext => ({
      kind: 'tenant',
      orgId: need().orgs.lab,
      userId: need().users.checker,
    }),
    otherChecker: (): DbContext => ({
      kind: 'tenant',
      orgId: need().orgs.otherLab,
      userId: need().users.otherChecker,
    }),
    ops: (): DbContext => ({
      kind: 'platform',
      orgId: need().orgs.platform,
      userId: need().users.ops,
    }),
    system: (): DbContext => ({ kind: 'system' }),
  };

  const callers = {
    customerAdmin: (): Caller => ({
      context: contexts.customer(),
      actor: {
        kind: 'USER',
        userId: need().users.customerAdmin,
        membershipId: need().memberships.customerAdmin,
        role: 'CUSTOMER_ADMIN',
      },
    }),
    /** The requester of the fixture bookings is `customerAdmin`; this claims the requester role for the same person. */
    requester: (): Caller => ({
      context: contexts.customer(),
      actor: { kind: 'USER', userId: need().users.customerAdmin, role: 'CUSTOMER_REQUESTER' },
    }),
    /** Someone else of the customer organisation: not the requester of the fixture bookings. */
    colleague: (role: 'CUSTOMER_ADMIN' | 'CUSTOMER_REQUESTER' | 'CUSTOMER_FINANCE'): Caller => ({
      context: { kind: 'tenant', orgId: need().orgs.customer, userId: colleagueId() },
      actor: { kind: 'USER', userId: colleagueId(), role },
    }),
    finance: (): Caller => ({
      context: contexts.customer(),
      actor: { kind: 'USER', userId: need().users.customerAdmin, role: 'CUSTOMER_FINANCE' },
    }),
    maker: (): Caller => ({
      context: contexts.maker(),
      actor: {
        kind: 'USER',
        userId: need().users.maker,
        membershipId: need().memberships.maker,
        role: 'LAB_MAKER',
      },
    }),
    checker: (): Caller => ({
      context: contexts.checker(),
      actor: {
        kind: 'USER',
        userId: need().users.checker,
        membershipId: need().memberships.checker,
        role: 'LAB_CHECKER',
      },
    }),
    ops: (): Caller => ({
      context: contexts.ops(),
      actor: {
        kind: 'USER',
        userId: need().users.ops,
        membershipId: need().memberships.ops,
        role: 'PLATFORM_OPS',
      },
    }),
    system: (source?: 'PAYMENTS' | 'EC-01'): Caller => ({
      context: contexts.system(),
      actor: source ? { kind: 'SYSTEM', source } : { kind: 'SYSTEM' },
    }),
  };

  /** Runs `work` as the caller, in a transaction in the caller's database context, on the role the app would use. */
  const as = <T>(caller: Caller, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    withDbContext(
      caller.context.kind === 'system' ? platform.worker() : platform.api(),
      caller.context,
      work,
    );

  /** A caller that the table lists for the transition (the first listed actor of its first command). */
  const callerFor = (entry: TransitionActor): Caller => {
    switch (entry.kind) {
      case 'SYSTEM':
        return callers.system(entry.source);
      case 'OWNER':
        return callers.requester();
      case 'ROLE':
        switch (entry.role) {
          case 'CUSTOMER_ADMIN':
            return callers.customerAdmin();
          case 'CUSTOMER_REQUESTER':
            return callers.requester();
          case 'CUSTOMER_FINANCE':
            return callers.finance();
          case 'LAB_MAKER':
            return callers.maker();
          case 'LAB_CHECKER':
            return callers.checker();
          case 'PLATFORM_OPS':
            return callers.ops();
          default:
            throw new Error(`no caller for ${entry.role}`);
        }
    }
  };

  /** Creates a booking of the fixture customer and lab and walks it to `status`. Committed. */
  const placeBooking = async (
    status: BookingStatus,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const db = platform.db();
    await db.query('BEGIN');
    try {
      const booking = await createBooking(db, need(), { overrides });
      for (const step of pathTo(status)) {
        await rawTransition(
          db,
          booking.id,
          step.id,
          step.to,
          step.to === 'CANCELLED'
            ? {
                cancellation_code_node_id: need().nodes.cancelReason,
                cancelled_by_party: 'CUSTOMER',
              }
            : step.to === 'REJECTED'
              ? { rejection_reason_node_id: need().nodes.rejectReason }
              : {},
        );
      }
      await db.query('COMMIT');
      return booking.id;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  };

  const engine = (registry: TransitionRegistry = new TransitionRegistry()): BookingEngine =>
    new BookingEngine(services, registry);

  /** What the "required input" of each transition looks like. */
  const inputFor = (transition: BookingTransition): Record<string, unknown> => ({
    cancellationCodeNodeId: need().nodes.cancelReason,
    rejectionReasonNodeId: need().nodes.rejectReason,
    expectedReportDate: '2026-12-20',
    ...(transition.id === 'T-16' ? { deviationNotes: 'minor' } : {}),
  });

  const rows = async <T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await platform.db().query<T>(sql, params)).rows;

  return {
    ...platform,
    clock,
    services,
    world: need,
    contexts,
    callers,
    as,
    callerFor,
    placeBooking,
    engine,
    inputFor,
    rows,
  };
}

export type BookingHarness = ReturnType<typeof useBookingHarness>;
