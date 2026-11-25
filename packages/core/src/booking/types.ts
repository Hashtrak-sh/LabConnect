import type { Booking, Prisma, RoleCode } from '@labconnect/database';
import type {
  BookingStatus,
  BookingTransition,
  SystemActorSource,
  TransitionId,
} from '@labconnect/shared';
import type { AuditService } from '../platform/audit.js';
import type { BusinessCalendar } from '../platform/business-calendar.js';
import type { Clock } from '../platform/clock.js';
import type { ConfigParameters } from '../platform/config-parameters.js';
import type { OutboxService } from '../platform/outbox.js';
import type { TimerService } from '../platform/timers.js';

/**
 * Who asks for a transition. The engine does not trust it on its own: it is checked against
 * the database context the caller already set (`app.user_id`, `app.org_id`, `app.is_platform`,
 * `app.is_system`), see `authorizeActor`.
 */
export type BookingActor =
  | {
      kind: 'USER';
      userId: string;
      membershipId?: string;
      role: RoleCode;
      /**
       * The organisation of the active membership. Optional and never an authority: the
       * database context decides, and a value that disagrees with it is refused.
       */
      orgId?: string;
      /**
       * The lab sites the membership is limited to, when it is limited. Needed for the
       * "of the site" actors (T-03, T-13). Absent means the membership covers the whole
       * organisation (OQ-98).
       */
      labSiteIds?: readonly string[];
    }
  | {
      kind: 'SYSTEM';
      /** Which part of the system acts, where the table names one (`PAYMENTS` for T-09, `EC-01`). */
      source?: SystemActorSource;
    };

export interface BookingRequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export interface BookingTransitionCommand {
  bookingId: string;
  transitionId: TransitionId;
  actor: BookingActor;
  /** The `lock_version` the caller read (`If-Match`). A different current value is refused. */
  expectedLockVersion?: number;
  /** Stored in the status history and the audit entry. Required by T-15 and T-28. */
  reason?: string;
  /**
   * Transition-specific data. The engine itself reads only `cancellationCodeNodeId` and
   * `cancellationNotes` (T-25 to T-28), `rejectionReasonNodeId` and `rejectionNotes` (T-05),
   * `expectedReportDate` (T-18) and `deviationNotes` (T-16); the rest is for the guards and
   * effects that feature modules register.
   */
  input?: Readonly<Record<string, unknown>>;
  requestContext?: BookingRequestContext;
}

/** What `BookingEngine.submit` (T-01) takes: the booking row without what the engine owns. */
export type NewBookingData = Omit<
  Prisma.BookingUncheckedCreateInput,
  'id' | 'status' | 'statusChangedAt' | 'lockVersion'
> & { id?: string };

export interface BookingSubmitCommand {
  booking: NewBookingData;
  actor: BookingActor;
  reason?: string;
  input?: Readonly<Record<string, unknown>>;
  requestContext?: BookingRequestContext;
}

export interface TransitionResult {
  bookingId: string;
  transitionId: TransitionId;
  /** `null` only for T-01. */
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  lockVersion: number;
  historyId: string;
  /** The outbox event ids, in the order they were enqueued. Possibly empty (T-02, T-23, T-24). */
  eventIds: string[];
}

export type TransitionOutcome =
  | ({ applied: true } & TransitionResult)
  | { applied: false; reason: 'NOT_FOUND' | 'STATE_CHANGED'; currentState?: BookingStatus };

/**
 * The lab site's calendar (receiving hours, closures, holidays). It belongs to the labs
 * module, so the booking module only has a port: the app wires an adapter that reads the
 * labs tables. No default effect needs it yet (OQ-96).
 */
export interface WorkingHoursProvider {
  calendarForSite(tx: Prisma.TransactionClient, labSiteId: string): Promise<BusinessCalendar>;
}

export interface BookingEngineServices {
  clock: Clock;
  audit: AuditService;
  outbox: OutboxService;
  timers: TimerService;
  config: ConfigParameters;
  workingHours?: WorkingHoursProvider;
}

export interface TransitionContext {
  tx: Prisma.TransactionClient;
  /**
   * The booking as it is before the transition. For T-01, whose guards and effects run after
   * the insert inside the same transaction, the row just created.
   */
  booking: Booking;
  fromStatus: BookingStatus | null;
  transition: BookingTransition;
  command: BookingTransitionCommand;
  clock: Clock;
  /** `clock.now()` read once at the start, so every row of one transition shares an instant. */
  now: Date;
  services: BookingEngineServices;
}

export interface EffectContext extends TransitionContext {
  /** The booking after the status change. */
  updated: Booking;
  historyId: string;
}

export type MaybePromise<T> = T | Promise<T>;

/** Throws a `BookingError` to refuse the transition. Runs before anything is written. */
export interface TransitionGuard {
  /** Unique among guards. */
  name: string;
  run(context: TransitionContext): MaybePromise<void>;
}

/** Runs after the status change and the history row, in the same transaction. A throw rolls everything back. */
export interface TransitionEffect {
  /** Unique among effects. */
  name: string;
  run(context: EffectContext): MaybePromise<void>;
}

/**
 * Columns of `booking` a feature wants set in the same UPDATE as the status. They exist
 * because CHECK constraints are evaluated at that UPDATE, so a column such as
 * `cancellation_code_node_id` cannot be written afterwards. `status` and the columns the
 * engine owns are refused.
 */
export type BookingColumns = Omit<
  Prisma.BookingUncheckedUpdateInput,
  'id' | 'status' | 'statusChangedAt' | 'lockVersion' | 'createdAt' | 'updatedAt'
>;

export interface ColumnContributor {
  /** Unique among contributors. */
  name: string;
  build(context: TransitionContext): MaybePromise<BookingColumns>;
}
