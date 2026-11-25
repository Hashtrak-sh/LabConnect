import { type Booking, type Prisma, uuidv7 } from '@labconnect/database';
import {
  type BookingStatus,
  findTransition,
  isTransitionId,
  type TransitionId,
} from '@labconnect/shared';
import { AUDIT_ACTIONS, type AuditEntry } from '../platform/audit.js';
import type { EventActor, NewEvent } from '../platform/events.js';
import { authorizeActor, type BookingParties, readCallerContext } from './actors.js';
import { BookingError } from './errors.js';
import { eventTypesFor } from './events.js';
import { TransitionRegistry } from './registry.js';
import { partyOf, statusColumns } from './status-columns.js';
import type {
  BookingColumns,
  BookingEngineServices,
  BookingSubmitCommand,
  BookingTransitionCommand,
  EffectContext,
  TransitionContext,
  TransitionOutcome,
  TransitionResult,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** T-25 to T-27 stay open while a booking is frozen (EC-01). */
const OPEN_WHILE_FROZEN: ReadonlySet<TransitionId> = new Set(['T-25', 'T-26', 'T-27']);
/** Columns the engine owns. A contributor may not set them. */
const ENGINE_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'status',
  'statusChangedAt',
  'lockVersion',
  'createdAt',
  'updatedAt',
]);

/**
 * The only code that changes `booking.status` (BOOKING_STATE_MACHINE.md, MODULE_BOUNDARIES.md
 * rule 4). Every other module (payments, custody, reports, the HTTP layer, the timers) calls
 * `transition()`, or `submit()` for T-01. The database trigger `trg_booking_status_guard` is the
 * backstop: it refuses a status change unless `app.transition_id` names a legal transition, and
 * this class is the only place that sets it.
 *
 * Both methods work inside the caller's transaction, which the caller opened with
 * `withDbContext` (so row-level security already limits what is visible). They write
 * nothing outside it, and a thrown error, from the engine or from a guard or effect, rolls
 * everything back together.
 *
 * Steps of `transition`, in order:
 *  1. read the caller's database context (`app.*` settings);
 *  2. lock the booking `SELECT ... FOR UPDATE` and load it (a booking the context cannot see
 *     is NOT_FOUND);
 *  3. the current status must be a `from` state of the transition (INVALID_STATE_TRANSITION,
 *     `meta.currentState`);
 *  4. a frozen booking (EC-01) accepts only T-25 to T-27 and Ops (INVALID_STATE_TRANSITION);
 *  5. the actor must be allowed to trigger it (FORBIDDEN), see `authorizeActor`;
 *  6. `expectedLockVersion`, if given, must be the current one (CONCURRENT_MODIFICATION);
 *  7. the transition's guards run, in registration order (nothing is written yet);
 *  8. the columns the new state fixes (`statusColumns`) and the registered column
 *     contributors are merged;
 *  9. `app.transition_id` is set (transaction-local), `booking.status` and `lock_version`
 *     are updated in one statement, and `app.transition_id` is cleared again;
 * 10. the `booking_status_history` row is inserted;
 * 11. the effects run, in registration order;
 * 12. the `booking.transition` audit entry is written;
 * 13. the outbox events of the transition are enqueued.
 * The documents (SYSTEM_ARCHITECTURE 4.1) fix only "load FOR UPDATE, validate, write the
 * changes, history, audit and outbox in one transaction, commit"; steps 3 to 8 refine the
 * "validate" part and 11 sits between history and audit so that the audit entry also
 * records a transition whose effects succeeded.
 */
export class BookingEngine {
  constructor(
    private readonly services: BookingEngineServices,
    private readonly registry: TransitionRegistry = new TransitionRegistry(),
  ) {}

  /** T-02 to T-28: moves an existing booking. */
  async transition(
    tx: Prisma.TransactionClient,
    command: BookingTransitionCommand,
  ): Promise<TransitionResult> {
    const outcome = await this.run(tx, command, undefined);
    if (!outcome.applied) {
      // Unreachable: without a status filter `run` either applies or throws.
      throw new BookingError('NOT_FOUND', { detail: 'The booking was not found.' });
    }
    return {
      bookingId: outcome.bookingId,
      transitionId: outcome.transitionId,
      fromStatus: outcome.fromStatus,
      toStatus: outcome.toStatus,
      lockVersion: outcome.lockVersion,
      historyId: outcome.historyId,
      eventIds: outcome.eventIds,
    };
  }

  /**
   * Like `transition`, for a system job that fires when a timer is due: if the booking is gone
   * or no longer in one of `statuses`, nothing is written and `{ applied: false }` comes back
   * (the timer "does nothing if the state has moved on", BOOKING_STATE_MACHINE.md section 3).
   * Everything else, including a frozen booking, still throws.
   */
  transitionIfStatus(
    tx: Prisma.TransactionClient,
    command: BookingTransitionCommand,
    statuses: BookingStatus | readonly BookingStatus[],
  ): Promise<TransitionOutcome> {
    return this.run(tx, command, typeof statuses === 'string' ? [statuses] : statuses);
  }

  /**
   * T-01: inserts the booking in REQUESTED. The row is written here, not by the caller, so that
   * `status` is written in one place. The guards and effects of T-01 run after the insert, in
   * the same transaction, so a refusal still leaves nothing behind.
   */
  async submit(
    tx: Prisma.TransactionClient,
    command: BookingSubmitCommand,
  ): Promise<TransitionResult> {
    const transition = findTransition('T-01');
    const now = this.services.clock.now();
    const caller = await readCallerContext(tx);
    const data = command.booking;
    const parties: BookingParties = {
      customerOrgId: data.customerOrgId,
      labOrgId: data.labOrgId,
      labSiteId: data.labSiteId,
      requesterUserId: data.requesterUserId,
    };
    const decision = authorizeActor(transition, command.actor, caller, parties);
    if (!decision.allowed) throw forbidden(transition.id, decision.reason);
    if (command.actor.kind === 'USER') {
      // The requester is the signed-in customer, or Ops say who they act for and for whom.
      const actingAsOps = partyOf(command.actor) === 'PLATFORM';
      const consistent = actingAsOps
        ? data.onBehalfByUserId === command.actor.userId
        : data.requesterUserId === command.actor.userId;
      if (!consistent) throw forbidden(transition.id, 'REQUESTER_MISMATCH');
    }

    const id = data.id ?? uuidv7(now.getTime());
    await setTransitionId(tx, transition.id);
    const created = await tx.booking.create({ data: { ...data, id, status: transition.to } });
    await clearTransitionId(tx);

    const commandAsTransition: BookingTransitionCommand = {
      bookingId: id,
      transitionId: transition.id,
      actor: command.actor,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      ...(command.input === undefined ? {} : { input: command.input }),
      ...(command.requestContext === undefined ? {} : { requestContext: command.requestContext }),
    };
    const context: TransitionContext = {
      tx,
      booking: created,
      fromStatus: null,
      transition,
      command: commandAsTransition,
      clock: this.services.clock,
      now,
      services: this.services,
    };
    for (const guard of this.registry.guardsFor(transition.id)) await guard.run(context);
    return this.finish(context, caller.orgId, created);
  }

  private async run(
    tx: Prisma.TransactionClient,
    command: BookingTransitionCommand,
    onlyIn: readonly BookingStatus[] | undefined,
  ): Promise<TransitionOutcome> {
    if (!isTransitionId(command.transitionId)) {
      throw new BookingError('VALIDATION_FAILED', {
        detail: 'Unknown transition.',
        meta: { fields: ['transitionId'] },
      });
    }
    const transition = findTransition(command.transitionId);
    if (transition.from.length === 0) {
      throw new BookingError('INVALID_STATE_TRANSITION', {
        detail: `${transition.id} creates a booking: use submit().`,
        meta: { transitionId: transition.id },
      });
    }
    const now = this.services.clock.now();

    // 1-2. caller's context, lock, load.
    const caller = await readCallerContext(tx);
    const notFound = (): TransitionOutcome => {
      if (onlyIn) return { applied: false, reason: 'NOT_FOUND' };
      throw new BookingError('NOT_FOUND', { detail: 'The booking was not found.' });
    };
    if (!UUID.test(command.bookingId)) return notFound();
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM booking WHERE id = ${command.bookingId}::uuid FOR UPDATE`;
    if (locked.length === 0) return notFound();
    // The lock is held, so under READ COMMITTED this read sees the latest committed row.
    const booking = await tx.booking.findUnique({ where: { id: command.bookingId } });
    if (!booking) return notFound();
    const current: BookingStatus = booking.status;

    if (onlyIn && !onlyIn.includes(current)) {
      return { applied: false, reason: 'STATE_CHANGED', currentState: current };
    }

    // 3. from-state.
    if (!transition.from.includes(current)) {
      throw new BookingError('INVALID_STATE_TRANSITION', {
        detail: `${transition.id} cannot leave ${current}.`,
        meta: { currentState: current, transitionId: transition.id },
      });
    }

    // 4. frozen (EC-01): only T-25 to T-27 and Ops actions.
    const isOps = command.actor.kind === 'USER' && command.actor.role === 'PLATFORM_OPS';
    if (booking.frozenAt !== null && !OPEN_WHILE_FROZEN.has(transition.id) && !isOps) {
      throw new BookingError('INVALID_STATE_TRANSITION', {
        detail: 'The booking is frozen.',
        meta: { currentState: current, transitionId: transition.id, frozen: true },
      });
    }

    // 5. actor.
    const decision = authorizeActor(transition, command.actor, caller, {
      customerOrgId: booking.customerOrgId,
      labOrgId: booking.labOrgId,
      labSiteId: booking.labSiteId,
      requesterUserId: booking.requesterUserId,
    });
    if (!decision.allowed) throw forbidden(transition.id, decision.reason);

    // 6. optimistic concurrency.
    if (
      command.expectedLockVersion !== undefined &&
      command.expectedLockVersion !== booking.lockVersion
    ) {
      throw new BookingError('CONCURRENT_MODIFICATION', {
        detail: 'The booking was changed by someone else.',
        meta: { currentLockVersion: booking.lockVersion },
      });
    }

    const context: TransitionContext = {
      tx,
      booking,
      fromStatus: current,
      transition,
      command,
      clock: this.services.clock,
      now,
      services: this.services,
    };

    // 7. guards.
    for (const guard of this.registry.guardsFor(transition.id)) await guard.run(context);

    // 8. columns.
    const columns = await this.collectColumns(context);

    // 9. the status change.
    await setTransitionId(tx, transition.id);
    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { ...columns, status: transition.to, lockVersion: { increment: 1 } },
    });
    await clearTransitionId(tx);

    const result = await this.finish(context, caller.orgId, updated);
    return { applied: true, ...result };
  }

  private async collectColumns(context: TransitionContext): Promise<BookingColumns> {
    const merged: Record<string, unknown> = { ...(await statusColumns(context)) };
    for (const contributor of this.registry.columnsFor(context.transition.id)) {
      const columns: Record<string, unknown> = { ...(await contributor.build(context)) };
      for (const key of Object.keys(columns)) {
        if (ENGINE_COLUMNS.has(key)) {
          throw new Error(`The column contributor "${contributor.name}" may not set ${key}.`);
        }
        if (key in merged) {
          throw new Error(`The column ${key} is set twice for ${context.transition.id}.`);
        }
      }
      Object.assign(merged, columns);
    }
    return merged;
  }

  /** Steps 10 to 13, shared by `transition` and `submit`. */
  private async finish(
    context: TransitionContext,
    contextOrgId: string | null,
    updated: Booking,
  ): Promise<TransitionResult> {
    const { tx, booking, transition, command, now, services } = context;
    const { actor, requestContext } = command;

    // 10. history (append-only).
    const historyId = uuidv7(now.getTime());
    const metadata: Prisma.InputJsonObject = {
      ...(actor.kind === 'USER' && actor.membershipId !== undefined
        ? { membershipId: actor.membershipId }
        : {}),
      ...(requestContext?.requestId === undefined ? {} : { requestId: requestContext.requestId }),
    };
    await tx.bookingStatusHistory.create({
      data: {
        id: historyId,
        bookingId: updated.id,
        customerOrgId: updated.customerOrgId,
        labOrgId: updated.labOrgId,
        transitionId: transition.id,
        fromStatus: context.fromStatus,
        toStatus: transition.to,
        actorUserId: actor.kind === 'USER' ? actor.userId : null,
        actorRole: actor.kind === 'USER' ? actor.role : null,
        actorParty: partyOf(actor),
        reason: command.reason ?? null,
        occurredAt: now,
        ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
        createdByUserId: actor.kind === 'USER' ? actor.userId : null,
      },
    });

    // 11. effects.
    const effectContext: EffectContext = { ...context, booking, updated, historyId };
    for (const effect of this.registry.effectsFor(transition.id)) await effect.run(effectContext);

    // 12. audit.
    const auditActor: AuditEntry['actor'] =
      actor.kind === 'SYSTEM'
        ? 'SYSTEM'
        : {
            userId: actor.userId,
            role: actor.role,
            ...(actor.membershipId === undefined ? {} : { membershipId: actor.membershipId }),
            ...(contextOrgId === null ? {} : { orgId: contextOrgId }),
          };
    await services.audit.record(tx, {
      actor: auditActor,
      action: AUDIT_ACTIONS.BOOKING_TRANSITION,
      entityType: 'booking',
      entityId: updated.id,
      before: { status: context.fromStatus },
      after: { status: transition.to, transitionId: transition.id },
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      ...(requestContext?.requestId === undefined ? {} : { requestId: requestContext.requestId }),
      ...(requestContext?.ip === undefined ? {} : { ipAddress: requestContext.ip }),
      ...(requestContext?.userAgent === undefined ? {} : { userAgent: requestContext.userAgent }),
    });

    // 13. events (ids, states, transition id and the actor only).
    const eventActor: EventActor | 'SYSTEM' =
      actor.kind === 'SYSTEM'
        ? 'SYSTEM'
        : {
            userId: actor.userId,
            role: actor.role,
            ...(contextOrgId === null ? {} : { orgId: contextOrgId }),
          };
    const eventIds: string[] = [];
    for (const type of eventTypesFor(transition.id, actor)) {
      const event: NewEvent = {
        type,
        aggregate: { type: 'booking', id: updated.id },
        actor: eventActor,
        data: {
          bookingId: updated.id,
          fromStatus: context.fromStatus,
          toStatus: transition.to,
          transitionId: transition.id,
        },
      };
      eventIds.push((await services.outbox.enqueue(tx, event)).id);
    }

    return {
      bookingId: updated.id,
      transitionId: transition.id,
      fromStatus: context.fromStatus,
      toStatus: transition.to,
      lockVersion: updated.lockVersion,
      historyId,
      eventIds,
    };
  }
}

function forbidden(transitionId: TransitionId, reason: string): BookingError {
  return new BookingError('FORBIDDEN', {
    detail: 'You are not allowed to do this.',
    meta: { transitionId, reason },
  });
}

function setTransitionId(tx: Prisma.TransactionClient, id: TransitionId): Promise<unknown> {
  return tx.$executeRaw`SELECT set_config('app.transition_id', ${id}, true)`;
}

function clearTransitionId(tx: Prisma.TransactionClient): Promise<unknown> {
  return tx.$executeRaw`SELECT set_config('app.transition_id', '', true)`;
}
