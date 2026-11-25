import type { GatewayCode, Prisma } from '@labconnect/database';
import { uuidv7 } from '@labconnect/database';
import { readCallerContext } from '../booking/actors.js';
import { BOOKING_AGGREGATE } from '../booking/default-effects.js';
import { CoreError } from '../platform/errors.js';
import type { Clock } from '../platform/clock.js';
import type { TimerService } from '../platform/timers.js';
import { GatewayUnavailableError } from './gateway.js';
import { PAYMENT_ORDER_AGGREGATE, type PaymentServiceDeps } from './types.js';

/** BR-032: reconciliation polls a pending payment for up to 2 hours past the window. */
export const PAYMENT_RECONCILE_WINDOW_MINUTES = 120;
const MAX_IDEMPOTENCY_KEY = 100;
const MINUTE_MS = 60_000;

/** A payment attempt as the platform exposes it: no gateway references, no idempotency key (contract `PaymentOrder`). */
export interface PaymentAttempt {
  id: string;
  bookingId: string;
  attemptNo: number;
  gateway: GatewayCode;
  status: string;
  amountPaise: bigint;
  checkoutExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAttemptInput {
  bookingId: string;
  /** The caller's `Idempotency-Key`. A repeat with the same key returns the same attempt. */
  idempotencyKey: string;
  /**
   * The signed-in user. Must be the user of the transaction's database context: it is checked,
   * never trusted. The organisation is not an input at all: it comes from the context.
   */
  initiatedByUserId: string;
}

export interface CreateAttemptResult {
  attempt: PaymentAttempt;
  /** True when the idempotency key had been used before and the existing attempt is returned. */
  reused: boolean;
}

interface BookingRow {
  id: string;
  booking_no: string;
  customer_org_id: string;
  lab_org_id: string;
  status: string;
  total_paise: bigint;
  payment_due_at: Date | null;
  frozen: boolean;
}

interface OrderRow {
  id: string;
  booking_id: string;
  customer_org_id: string;
  attempt_no: number;
  idempotency_key: string;
  initiated_by_user_id: string;
  gateway: GatewayCode;
  status: string;
  amount_paise: bigint;
  checkout_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const ORDER_COLUMNS = `id::text AS id, booking_id::text AS booking_id,
  customer_org_id::text AS customer_org_id, attempt_no, idempotency_key,
  initiated_by_user_id::text AS initiated_by_user_id, gateway::text AS gateway,
  status::text AS status, amount_paise, checkout_expires_at, created_at, updated_at`;

function toAttempt(row: OrderRow): PaymentAttempt {
  return {
    id: row.id,
    bookingId: row.booking_id,
    attemptNo: row.attempt_no,
    gateway: row.gateway,
    status: row.status,
    amountPaise: row.amount_paise,
    checkoutExpiresAt: row.checkout_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The signed-in customer user of the transaction; anything else may not pay (ROLES_AND_PERMISSIONS note 1: Ops cannot pay). */
async function requireCustomerCaller(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ orgId: string }> {
  const caller = await readCallerContext(tx);
  if (
    caller.isSystem ||
    caller.isPlatform ||
    caller.orgId === null ||
    caller.userId === null ||
    caller.userId !== userId
  ) {
    throw new CoreError('FORBIDDEN', { detail: 'Only a customer user may pay for a booking.' });
  }
  return { orgId: caller.orgId };
}

/**
 * Phase 1 of "start a payment" (PAYMENTS_AND_LEDGER.md section 2: "payment_order CREATED
 * (amount = booking.total)"; contract `createPaymentOrder`): inserts the attempt in
 * `CREATED`. It does not call the gateway, so no network call happens inside a database
 * transaction and a gateway outage leaves a plain attempt, never a half-made one.
 *
 * - The amount is the booking's stored total, read here; nothing about it comes from the
 *   client, and the database checks it again (C-65).
 * - The booking must be `ACCEPTED`, inside its payment window (`payment_due_at`, BR-030) and
 *   not frozen, else `INVALID_STATE_TRANSITION` with `meta.currentState`.
 * - The caller must be a user of the booking's customer organisation, from the database
 *   context. Which role may pay (`requester_can_pay`, ROLES_AND_PERMISSIONS note 3) is the
 *   permission guard's job (P3-04), before this is called.
 * - Idempotent on the key: the same key, booking and user returns the same attempt; the key
 *   used for anything else is `IDEMPOTENCY_KEY_REUSED`.
 *
 * Run it in the caller's tenant context.
 */
export async function createPaymentAttempt(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  input: CreateAttemptInput,
): Promise<CreateAttemptResult> {
  if (input.idempotencyKey.length === 0 || input.idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new CoreError('VALIDATION_FAILED', { detail: 'The idempotency key is not valid.' });
  }
  const { orgId } = await requireCustomerCaller(tx, input.initiatedByUserId);

  const bookings = await tx.$queryRaw<BookingRow[]>`
    SELECT id::text AS id, booking_no, customer_org_id::text AS customer_org_id,
           lab_org_id::text AS lab_org_id, status::text AS status, total_paise, payment_due_at,
           frozen_at IS NOT NULL AS frozen
      FROM booking WHERE id = ${input.bookingId}::uuid FOR UPDATE`;
  const booking = bookings[0];
  // A booking of another customer is invisible, not forbidden (ERROR_HANDLING: NOT_FOUND).
  if (!booking || booking.customer_org_id !== orgId) {
    throw new CoreError('NOT_FOUND', { detail: 'The booking was not found.' });
  }

  const existing = await tx.$queryRawUnsafe<OrderRow[]>(
    `SELECT ${ORDER_COLUMNS} FROM payment_order WHERE idempotency_key = $1`,
    input.idempotencyKey,
  );
  const earlier = existing[0];
  if (earlier) {
    if (
      earlier.booking_id !== booking.id ||
      earlier.initiated_by_user_id !== input.initiatedByUserId
    ) {
      throw new CoreError('IDEMPOTENCY_KEY_REUSED');
    }
    return { attempt: toAttempt(earlier), reused: true };
  }

  const now = deps.clock.now();
  if (
    booking.status !== 'ACCEPTED' ||
    booking.frozen ||
    booking.payment_due_at === null ||
    booking.payment_due_at.getTime() <= now.getTime()
  ) {
    throw new CoreError('INVALID_STATE_TRANSITION', {
      detail: 'The booking cannot be paid in its current state.',
      meta: { currentState: booking.status },
    });
  }

  const next = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next
      FROM payment_order WHERE booking_id = ${booking.id}::uuid`;
  const attemptNo = next[0]?.next ?? 1;
  const reconcileUntil = new Date(
    booking.payment_due_at.getTime() + PAYMENT_RECONCILE_WINDOW_MINUTES * MINUTE_MS,
  );
  const id = uuidv7(now.getTime());
  const inserted = await tx.$queryRawUnsafe<OrderRow[]>(
    `INSERT INTO payment_order
       (id, booking_id, customer_org_id, lab_org_id, attempt_no, idempotency_key, gateway,
        amount_paise, status, initiated_by_user_id, checkout_expires_at, reconcile_until,
        created_by_user_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::gateway_code, $8::bigint,
             'CREATED', $9::uuid, $10, $11, $9::uuid)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${ORDER_COLUMNS}`,
    id,
    booking.id,
    booking.customer_org_id,
    booking.lab_org_id,
    attemptNo,
    input.idempotencyKey,
    deps.gateway.code,
    booking.total_paise.toString(),
    input.initiatedByUserId,
    booking.payment_due_at,
    reconcileUntil,
  );
  const created = inserted[0];
  // The key belongs to an attempt this caller cannot see (another organisation's).
  if (!created) throw new CoreError('IDEMPOTENCY_KEY_REUSED');

  await deps.audit.record(tx, {
    actor: { userId: input.initiatedByUserId, orgId },
    action: 'payment.order_create',
    entityType: PAYMENT_ORDER_AGGREGATE,
    entityId: created.id,
    after: { bookingId: booking.id, attemptNo, amountPaise: booking.total_paise.toString() },
  });
  return { attempt: toAttempt(created), reused: false };
}

export interface OpenCheckoutInput {
  paymentOrderId: string;
  userId: string;
  /** Passed to the gateway only; never stored, logged or audited. */
  customer: { name: string; email: string; phone?: string };
  /**
   * The web app's payment return page (OQ-44), absolute `https:` (or `http:` for local). The
   * platform adds `orderRef=<payment order id>` and nothing else: no personal data in URLs.
   */
  returnUrl: string;
}

export type OpenCheckoutResult =
  | { kind: 'OPEN'; attempt: PaymentAttempt; checkout: unknown }
  /** The gateway could not create the order. The attempt is `FAILED`; the caller answers `GATEWAY_UNAVAILABLE`. */
  | { kind: 'UNAVAILABLE'; attempt: PaymentAttempt };

/** The return URL given to the gateway: the page and `orderRef`, nothing personal (contract `getPaymentReturnStatus`). */
export function buildReturnUrl(returnUrl: string, paymentOrderId: string): string {
  const url = new URL(returnUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RangeError('The return URL must be http or https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new RangeError('The return URL must not carry credentials.');
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set('orderRef', paymentOrderId);
  return url.toString();
}

/**
 * Phase 2 of "start a payment": asks the gateway to create the order for an attempt that is
 * still `CREATED`, and moves it to `PENDING` with the gateway's order reference
 * (PAYMENTS_AND_LEDGER.md section 2 `createOrder()`). Call it in its own transaction after
 * `createPaymentAttempt` committed, in the caller's tenant context. If the gateway is
 * unavailable the attempt becomes `FAILED` and the result says so (do not throw inside the
 * transaction, or the `FAILED` would roll back).
 */
export async function openPaymentCheckout(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  input: OpenCheckoutInput,
): Promise<OpenCheckoutResult> {
  const { orgId } = await requireCustomerCaller(tx, input.userId);
  const locked = await tx.$queryRawUnsafe<OrderRow[]>(
    `SELECT ${ORDER_COLUMNS} FROM payment_order WHERE id = $1::uuid FOR UPDATE`,
    input.paymentOrderId,
  );
  const order = locked[0];
  const bookingRows = order
    ? await tx.$queryRaw<{ booking_no: string; booking_status: string }[]>`
        SELECT booking_no, status::text AS booking_status
          FROM booking WHERE id = ${order.booking_id}::uuid`
    : [];
  const booking = bookingRows[0];
  const row = order && booking ? { ...order, ...booking } : undefined;
  if (!row || row.customer_org_id !== orgId || row.initiated_by_user_id !== input.userId) {
    throw new CoreError('NOT_FOUND', { detail: 'The payment was not found.' });
  }
  if (
    row.status !== 'CREATED' ||
    row.booking_status !== 'ACCEPTED' ||
    row.checkout_expires_at === null
  ) {
    throw new CoreError('INVALID_STATE_TRANSITION', {
      detail: 'The payment cannot be started in its current state.',
      meta: { currentState: row.status },
    });
  }
  if (row.checkout_expires_at.getTime() <= deps.clock.now().getTime()) {
    throw new CoreError('INVALID_STATE_TRANSITION', {
      detail: 'The payment window has closed.',
      meta: { currentState: row.booking_status },
    });
  }

  try {
    const created = await deps.gateway.createOrder({
      paymentOrderId: row.id,
      bookingNo: row.booking_no,
      amountPaise: row.amount_paise,
      customer: input.customer,
      returnUrl: buildReturnUrl(input.returnUrl, row.id),
      expiresAt: row.checkout_expires_at,
    });
    const updated = await tx.$queryRawUnsafe<OrderRow[]>(
      `UPDATE payment_order
          SET status = 'PENDING', gateway_order_ref = $2, lock_version = lock_version + 1
        WHERE id = $1::uuid
        RETURNING ${ORDER_COLUMNS}`,
      row.id,
      created.gatewayOrderRef.slice(0, 100),
    );
    const attempt = toAttempt(updated[0] ?? row);
    return { kind: 'OPEN', attempt, checkout: created.checkout };
  } catch (error) {
    if (!(error instanceof GatewayUnavailableError)) throw error;
    const failed = await tx.$queryRawUnsafe<OrderRow[]>(
      `UPDATE payment_order SET status = 'FAILED', lock_version = lock_version + 1
        WHERE id = $1::uuid RETURNING ${ORDER_COLUMNS}`,
      row.id,
    );
    return { kind: 'UNAVAILABLE', attempt: toAttempt(failed[0] ?? row) };
  }
}

/**
 * The `hasPendingPayment` port of the booking timer handler (T-10 guard "No pending payment
 * order, otherwise extend, BR-032"; OQ-100). True while an attempt of the booking is
 * `PENDING` and still inside its reconciliation window (`reconcile_until`, the payment
 * window plus 2 hours, BR-032). Because the booking module cannot see payments (rule 3), it
 * asks this function; and because it then does nothing, this function is the one that
 * extends the window: it schedules a new `PAYMENT_DUE` at `reconcile_until`, so the booking
 * is expired then unless the payment has been confirmed. Called once per `PAYMENT_DUE`
 * firing, in the timer's own transaction.
 */
export function createHasPendingPayment(deps: {
  clock: Clock;
  timers: TimerService;
}): (tx: Prisma.TransactionClient, bookingId: string) => Promise<boolean> {
  return async (tx, bookingId) => {
    const now = deps.clock.now();
    const pending = await tx.$queryRaw<{ reconcile_until: Date }[]>`
      SELECT reconcile_until FROM payment_order
       WHERE booking_id = ${bookingId}::uuid AND status = 'PENDING' AND reconcile_until > ${now}
       ORDER BY reconcile_until DESC LIMIT 1`;
    const latest = pending[0];
    if (!latest) return false;
    await deps.timers.schedule(tx, {
      type: 'PAYMENT_DUE',
      aggregate: { type: BOOKING_AGGREGATE, id: bookingId },
      dueAt: latest.reconcile_until,
    });
    return true;
  };
}
