import { type GatewayCode, type Prisma, uuidv7 } from '@labconnect/database';
import type { BookingStatus } from '@labconnect/shared';
import { GATEWAY_CURRENCY, type GatewayEvent } from './gateway.js';
import { payloadContext } from './intake.js';
import {
  GATEWAY_EVENT_AGGREGATE,
  PAYMENT_EVENTS,
  PAYMENT_ORDER_AGGREGATE,
  type PaymentExceptionCode,
  type PaymentServiceDeps,
  type ProcessResult,
} from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERROR = 500;

interface EventRow {
  id: string;
  gateway: GatewayCode;
  event_id: string;
  signature_valid: boolean;
  processing_status: string;
  payload_ciphertext: Uint8Array;
}

interface OrderRow {
  id: string;
  booking_id: string;
  status: string;
  amount_paise: bigint;
}

interface BookingRow {
  id: string;
  status: BookingStatus;
  total_paise: bigint;
}

type Finish = { status: 'PROCESSED' | 'IGNORED' | 'FAILED'; code: string };

const CAPTURED_STATUSES = ['CAPTURED', 'REFUNDED_PARTIAL', 'REFUNDED_FULL'];

/**
 * Processes one stored gateway notification (PAYMENTS_AND_LEDGER.md section 2 "tx: ...",
 * BOOKING_STATE_MACHINE.md T-09, ERROR_HANDLING.md section 3). Separate from intake: the
 * notification is already stored and acknowledged. Run it in the system context.
 *
 * Idempotent through the row itself. The row is locked (`FOR UPDATE`) and only a row that is
 * `RECEIVED` is processed; the result is written in the same transaction as every other
 * change, so a notification is applied exactly once, however many times it is delivered or
 * how many workers race for it. A transient error (the database, the booking engine refusing
 * a frozen booking) throws and rolls everything back, leaving the row `RECEIVED` to be
 * retried. A permanent problem is a result, not a throw:
 *
 * - `PROCESSED`: applied (or a harmless repeat).
 * - `IGNORED`: nothing to do (a failure for an order that is already settled, a late
 *   "failed" after a capture).
 * - `FAILED`: needs a person (the exception path, `PaymentExceptionCode`). The money is
 *   never silently dropped and never refunded here: the row, an audit entry and a
 *   `payment.exception_raised` event say what Finance has to decide (OQ-127, OQ-128).
 *
 * Money rules: the captured amount must equal the order's amount, in paise, and the currency
 * must be INR, or nothing moves. Only an exact capture of an order that can still be paid,
 * for a booking that is still `ACCEPTED`, runs T-09, with the SYSTEM / PAYMENTS actor.
 */
export async function processGatewayEvent(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  rowId: string,
): Promise<ProcessResult> {
  const rows = await tx.$queryRaw<EventRow[]>`
    SELECT id::text AS id, gateway::text AS gateway, event_id, signature_valid,
           processing_status::text AS processing_status, payload_ciphertext
      FROM gateway_webhook_event
     WHERE id = ${rowId}::uuid
       FOR UPDATE`;
  const row = rows[0];
  if (!row || row.processing_status !== 'RECEIVED')
    return { status: 'SKIPPED', code: 'NOT_WAITING' };
  if (!row.signature_valid) {
    // Never reached by intake (it stores these as IGNORED); a belt for a row made by hand.
    await finish(tx, deps, row.id, { status: 'IGNORED', code: 'SIGNATURE_INVALID' });
    return { status: 'IGNORED', code: 'SIGNATURE_INVALID' };
  }

  const event = await readEvent(deps, row);
  if (event === undefined) {
    return exception(deps, tx, row, 'PAYLOAD_UNREADABLE', {});
  }

  if (!UUID.test(event.merchantReference)) {
    return unknownReference(deps, tx, row, event);
  }
  const orders = await tx.$queryRaw<OrderRow[]>`
    SELECT id::text AS id, booking_id::text AS booking_id, status::text AS status, amount_paise
      FROM payment_order
     WHERE id = ${event.merchantReference}::uuid AND gateway = ${row.gateway}::gateway_code
       FOR UPDATE`;
  const order = orders[0];
  if (!order) return unknownReference(deps, tx, row, event);

  switch (event.type) {
    case 'PAYMENT_FAILED':
      return closeOrder(deps, tx, row, order, 'FAILED');
    case 'PAYMENT_EXPIRED':
      return closeOrder(deps, tx, row, order, 'EXPIRED');
    case 'PAYMENT_CAPTURED':
      return capture(deps, tx, row, order, event);
  }
}

async function readEvent(
  deps: PaymentServiceDeps,
  row: EventRow,
): Promise<GatewayEvent | undefined> {
  try {
    const body = await deps.cipher.decrypt(row.payload_ciphertext, payloadContext(row.id));
    const events = deps.gateway.parseVerifiedWebhookBody(Buffer.from(body));
    return events.find((candidate) => candidate.gatewayEventId === row.event_id);
  } catch {
    return undefined;
  }
}

/** A failure or an expiry moves an order only while it is still open; otherwise it is out of order and ignored. */
async function closeOrder(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  row: EventRow,
  order: OrderRow,
  to: 'FAILED' | 'EXPIRED',
): Promise<ProcessResult> {
  const open = order.status === 'CREATED' || order.status === 'PENDING';
  if (open) {
    await setOrderStatus(tx, order.id, to);
    await deps.audit.record(tx, {
      actor: 'SYSTEM',
      action: `payment.${to.toLowerCase()}`,
      entityType: PAYMENT_ORDER_AGGREGATE,
      entityId: order.id,
      before: { status: order.status },
      after: { status: to },
    });
  }
  const finishWith: Finish = open
    ? { status: 'PROCESSED', code: to }
    : { status: 'IGNORED', code: 'OUT_OF_ORDER' };
  await finish(tx, deps, row.id, finishWith);
  return { ...finishWith, paymentOrderId: order.id, bookingId: order.booking_id };
}

async function capture(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  row: EventRow,
  order: OrderRow,
  event: GatewayEvent,
): Promise<ProcessResult> {
  const where = { paymentOrderId: order.id, bookingId: order.booking_id };

  // Currency first: an amount in another currency is not comparable and is never recorded as paise.
  if (event.currency !== GATEWAY_CURRENCY) {
    return exception(deps, tx, row, 'CURRENCY_MISMATCH', where);
  }

  // A repeat of a capture already recorded (same gateway payment reference): nothing to do.
  const known = await tx.$queryRaw<{ payment_order_id: string }[]>`
    SELECT payment_order_id::text AS payment_order_id
      FROM payment_transaction
     WHERE gateway = ${row.gateway}::gateway_code AND gateway_txn_ref = ${event.gatewayPaymentRef}
       AND txn_type = 'CAPTURE'`;
  const earlier = known[0];
  if (earlier) {
    if (earlier.payment_order_id === order.id) {
      const done: Finish = { status: 'PROCESSED', code: 'DUPLICATE_EVENT' };
      await finish(tx, deps, row.id, done);
      return { ...done, ...where };
    }
    return exception(deps, tx, row, 'DUPLICATE_CAPTURE', where);
  }

  const bookings = await tx.$queryRaw<BookingRow[]>`
    SELECT id::text AS id, status::text AS status, total_paise
      FROM booking WHERE id = ${order.booking_id}::uuid FOR UPDATE`;
  const booking = bookings[0];
  if (!booking) return exception(deps, tx, row, 'UNKNOWN_REFERENCE', where);

  // The amount must be exactly the order's, and the order's is exactly the booking's (C-65).
  if (event.amountPaise !== order.amount_paise || order.amount_paise !== booking.total_paise) {
    await recordCapture(deps, tx, order, event, row, false, 'AMOUNT_MISMATCH', {
      expectedAmountPaise: order.amount_paise.toString(),
    });
    return exception(deps, tx, row, 'PAYMENT_AMOUNT_MISMATCH', where);
  }

  // Only one capture counts per booking (BR-033, uq_payment_order_captured).
  const captured = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM payment_order
     WHERE booking_id = ${order.booking_id}::uuid AND status::text = ANY (${CAPTURED_STATUSES}::text[])`;
  if (captured.length > 0) {
    await recordCapture(deps, tx, order, event, row, true, 'DUPLICATE_CAPTURE', {});
    return exception(deps, tx, row, 'DUPLICATE_CAPTURE', where);
  }

  if (order.status === 'FAILED' || order.status === 'EXPIRED') {
    await recordCapture(deps, tx, order, event, row, false, 'CAPTURE_ON_CLOSED_ORDER', {});
    return exception(deps, tx, row, 'CAPTURE_ON_CLOSED_ORDER', where);
  }

  // From here the money is real, exactly right and the first for this booking: the order is captured.
  await setOrderStatus(tx, order.id, 'CAPTURED');
  const transactionId = await recordCapture(
    deps,
    tx,
    order,
    event,
    row,
    false,
    booking.status === 'ACCEPTED' ? 'CAPTURED' : 'LATE_CAPTURE',
    {},
  );
  await deps.audit.record(tx, {
    actor: 'SYSTEM',
    action: 'payment.captured',
    entityType: PAYMENT_ORDER_AGGREGATE,
    entityId: order.id,
    before: { status: order.status },
    after: { status: 'CAPTURED', amountPaise: order.amount_paise.toString() },
  });

  if (booking.status !== 'ACCEPTED') {
    // The booking left ACCEPTED (EXPIRED_UNPAID, CANCELLED, ...): recorded, not applied, and
    // handed to Finance for the refund OQ-27 calls for.
    return exception(deps, tx, row, 'LATE_CAPTURE', where);
  }

  const moved = await deps.engine.transitionIfStatus(
    tx,
    {
      bookingId: booking.id,
      transitionId: 'T-09',
      actor: { kind: 'SYSTEM', source: 'PAYMENTS' },
      reason: 'Payment captured',
      input: { paymentOrderId: order.id, paymentTransactionId: transactionId },
    },
    'ACCEPTED',
  );
  if (!moved.applied) {
    // Unreachable while the booking row is locked by this transaction.
    throw new Error('The booking left ACCEPTED while its payment was being applied.');
  }
  const done: Finish = { status: 'PROCESSED', code: 'CAPTURED' };
  await finish(tx, deps, row.id, done);
  return { ...done, ...where };
}

/** Records a capture the gateway reported, as the immutable transaction fact. Returns its id. */
async function recordCapture(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  order: OrderRow,
  event: GatewayEvent,
  row: EventRow,
  isDuplicate: boolean,
  outcome: string,
  extra: Record<string, string>,
): Promise<string | undefined> {
  if (event.amountPaise <= 0n) return undefined; // the table refuses it (C-66); the exception row remains
  const tenant = await tx.$queryRaw<{ customer_org_id: string; lab_org_id: string }[]>`
    SELECT customer_org_id::text AS customer_org_id, lab_org_id::text AS lab_org_id
      FROM payment_order WHERE id = ${order.id}::uuid`;
  const orgs = tenant[0];
  if (!orgs) return undefined;
  const id = uuidv7(deps.clock.now().getTime());
  const created = await tx.paymentTransaction.createManyAndReturn({
    data: [
      {
        id,
        customerOrgId: orgs.customer_org_id,
        labOrgId: orgs.lab_org_id,
        paymentOrderId: order.id,
        gateway: row.gateway,
        gatewayTxnRef: event.gatewayPaymentRef.slice(0, 100),
        txnType: 'CAPTURE',
        method: event.method?.slice(0, 30) ?? null,
        amountPaise: event.amountPaise,
        status: 'SUCCESS',
        isDuplicate,
        gatewayReportedAt: event.occurredAt,
        webhookEventId: row.id,
        // Non-sensitive fields only (SCHEMA_SPECIFICATION section 10.2). Never the raw body.
        rawSummary: { outcome, currency: event.currency, ...extra },
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return created[0]?.id;
}

async function setOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  status: 'CAPTURED' | 'FAILED' | 'EXPIRED',
): Promise<void> {
  await tx.$executeRaw`
    UPDATE payment_order
       SET status = ${status}::payment_order_status, lock_version = lock_version + 1
     WHERE id = ${orderId}::uuid`;
}

async function unknownReference(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  row: EventRow,
  event: GatewayEvent,
): Promise<ProcessResult> {
  // A failure or expiry for something we do not know moves no money: nothing to decide.
  if (event.type !== 'PAYMENT_CAPTURED') {
    const done: Finish = { status: 'IGNORED', code: 'UNKNOWN_REFERENCE' };
    await finish(tx, deps, row.id, done);
    return done;
  }
  return exception(deps, tx, row, 'UNKNOWN_REFERENCE', {});
}

/** The exception path: marks the row `FAILED` with the code, audits it and raises the event. */
async function exception(
  deps: PaymentServiceDeps,
  tx: Prisma.TransactionClient,
  row: EventRow,
  code: PaymentExceptionCode,
  where: { paymentOrderId?: string; bookingId?: string },
): Promise<ProcessResult> {
  await finish(tx, deps, row.id, { status: 'FAILED', code });
  await deps.audit.record(tx, {
    actor: 'SYSTEM',
    action: 'payment.exception',
    entityType: GATEWAY_EVENT_AGGREGATE,
    entityId: row.id,
    after: { code, ...where },
    reason: code,
  });
  await deps.outbox.enqueue(tx, {
    type: PAYMENT_EVENTS.exceptionRaised,
    aggregate: { type: GATEWAY_EVENT_AGGREGATE, id: row.id },
    actor: 'SYSTEM',
    data: {
      gatewayEventRowId: row.id,
      gateway: row.gateway,
      code,
      ...where,
      // What the documents say Finance should do (BR-033, OQ-27, ICICI_PAYMENT_INTEGRATION.md
      // section 4). Nothing here refunds: the refund workflow is not built (OQ-128).
      recommendedAction:
        code === 'UNKNOWN_REFERENCE' ||
        code === 'PAYLOAD_UNREADABLE' ||
        code === 'CURRENCY_MISMATCH'
          ? 'REVIEW'
          : 'REFUND_FULL',
    },
  });
  return { status: 'FAILED', code, ...where };
}

async function finish(
  tx: Prisma.TransactionClient,
  deps: PaymentServiceDeps,
  rowId: string,
  result: Finish,
): Promise<void> {
  const error = result.status === 'PROCESSED' ? null : result.code.slice(0, MAX_ERROR);
  await tx.$executeRaw`
    UPDATE gateway_webhook_event
       SET processing_status = ${result.status}::webhook_processing_status,
           processed_at = ${deps.clock.now()}, error = ${error}
     WHERE id = ${rowId}::uuid`;
}
