import { randomBytes } from 'node:crypto';
import { withDbContext } from '@labconnect/database';
import {
  AesGcmSecretCipher,
  FakePaymentGateway,
  PaymentService,
  registerDefaultBookingEffects,
  registerPaymentBookingGuards,
  TransitionRegistry,
  type BookingEngine,
  type CreateAttemptResult,
  type FakeNotification,
  type IntakeResult,
  type OpenCheckoutResult,
  type ProcessPendingResult,
} from '../../src/index.js';
import { type BookingHarness, type Caller, NOW, useBookingHarness } from './booking-support.js';

export const FAKE_SECRET = 'fake-test-secret-0123456789';
export const HOUR = 3_600_000;

type Rows<T> = Promise<T[]>;

export interface EventRowView {
  id: string;
  event_id: string;
  event_type: string;
  signature_valid: boolean;
  processing_status: string;
  error: string | null;
}

export interface TransactionView {
  gateway_txn_ref: string;
  amount_paise: string;
  is_duplicate: boolean;
  status: string;
  raw_summary: unknown;
}

/** What the payments tests add to the booking harness. */
export interface PaymentsExtras {
  gateway: FakePaymentGateway;
  cipher: AesGcmSecretCipher;
  service: PaymentService;
  engine: () => BookingEngine;
  registry: () => TransitionRegistry;
  acceptedBooking: (dueInMs?: number) => Promise<string>;
  customer: () => Caller;
  customerUserId: () => string;
  startPayment: (
    bookingId: string,
    key?: string,
  ) => Promise<{ created: CreateAttemptResult; opened: OpenCheckoutResult; orderId: string }>;
  deliver: (note: FakeNotification, input?: { requestId?: string }) => Promise<IntakeResult>;
  processAll: () => Promise<ProcessPendingResult>;
  orderRow: (orderId: string) => Promise<
    | {
        status: string;
        gateway_order_ref: string | null;
        amount_paise: string;
        lock_version: number;
      }
    | undefined
  >;
  bookingStatus: (bookingId: string) => Promise<string | undefined>;
  eventRows: (extra?: string) => Rows<EventRowView>;
  t09Count: (bookingId: string) => Promise<number>;
  transactions: (orderId: string) => Rows<TransactionView>;
}

export type PaymentsHarness = BookingHarness & PaymentsExtras;

/**
 * The booking harness plus the payments module wired as the app will wire it: the fake
 * gateway, an AES-GCM cipher, and an engine whose registry holds the default booking effects
 * and the payments guard for T-09.
 */
export function usePaymentsHarness(): PaymentsHarness {
  const h = useBookingHarness();
  const gateway = new FakePaymentGateway({ clock: h.clock, secret: FAKE_SECRET });
  const cipherKey = randomBytes(32);
  const cipher = new AesGcmSecretCipher(cipherKey);
  const registry = () =>
    registerPaymentBookingGuards(registerDefaultBookingEffects(new TransitionRegistry()));
  const engine = () => h.engine(registry());
  const service = new PaymentService({
    gateway,
    cipher,
    clock: h.clock,
    audit: h.services.audit,
    outbox: h.services.outbox,
    timers: h.services.timers,
    engine: engine(),
  });

  /** A booking in ACCEPTED, due in 24 hours, as the engine would leave it after T-03. */
  const acceptedBooking = (dueInMs = 24 * HOUR): Promise<string> =>
    h.placeBooking('ACCEPTED', {
      payment_due_at: new Date(new Date(NOW).getTime() + dueInMs),
    });

  const customer = () => h.callers.customerAdmin();
  const customerUserId = () => h.world().users.customerAdmin;

  /** Starts a payment as the customer: both phases, in the tenant context on the API role. */
  const startPayment = async (bookingId: string, key: string = crypto.randomUUID()) => {
    const created = await h.as(customer(), (tx) =>
      service.createAttempt(tx, {
        bookingId,
        idempotencyKey: key,
        initiatedByUserId: customerUserId(),
      }),
    );
    const opened = await h.as(customer(), (tx) =>
      service.openCheckout(tx, {
        paymentOrderId: created.attempt.id,
        userId: customerUserId(),
        customer: { name: 'Customer', email: 'customer@example.test' },
        returnUrl: 'https://app.example.test/payments/return',
      }),
    );
    return { created, opened, orderId: created.attempt.id };
  };

  /** What the gateway's server would do: post the notification to the webhook intake (API role, system context). */
  const deliver = (note: FakeNotification, input: { requestId?: string } = {}) =>
    withDbContext(h.api(), { kind: 'system' }, (tx) =>
      service.recordGatewayEvent(tx, {
        gateway: 'FAKE',
        headers: note.headers,
        body: note.body,
        ...input,
      }),
    );

  /** One worker pass over everything waiting. */
  const processAll = () => service.processPending(h.worker());

  const orderRow = async (orderId: string) =>
    (
      await h.rows<{
        status: string;
        gateway_order_ref: string | null;
        amount_paise: string;
        lock_version: number;
      }>(
        'SELECT status::text AS status, gateway_order_ref, amount_paise::text AS amount_paise, lock_version FROM payment_order WHERE id = $1',
        [orderId],
      )
    )[0];
  const bookingStatus = async (bookingId: string) =>
    (
      await h.rows<{ status: string }>('SELECT status::text AS status FROM booking WHERE id = $1', [
        bookingId,
      ])
    )[0]?.status;
  const eventRows = (extra = '') =>
    h.rows<{
      id: string;
      event_id: string;
      event_type: string;
      signature_valid: boolean;
      processing_status: string;
      error: string | null;
    }>(
      `SELECT id::text AS id, event_id, event_type, signature_valid, processing_status::text AS processing_status, error
         FROM gateway_webhook_event ${extra} ORDER BY received_at, event_id`,
    );
  const t09Count = async (bookingId: string) =>
    Number(
      (
        await h.rows<{ n: string }>(
          `SELECT count(*) AS n FROM booking_status_history WHERE booking_id = $1 AND transition_id = 'T-09'`,
          [bookingId],
        )
      )[0]?.n,
    );
  const transactions = (orderId: string) =>
    h.rows<{
      gateway_txn_ref: string;
      amount_paise: string;
      is_duplicate: boolean;
      status: string;
      raw_summary: unknown;
    }>(
      `SELECT gateway_txn_ref, amount_paise::text AS amount_paise, is_duplicate, status::text AS status, raw_summary
         FROM payment_transaction WHERE payment_order_id = $1 ORDER BY created_at, gateway_txn_ref`,
      [orderId],
    );

  return {
    ...h,
    gateway,
    cipher,
    service,
    engine,
    registry,
    acceptedBooking,
    customer,
    customerUserId,
    startPayment,
    deliver,
    processAll,
    orderRow,
    bookingStatus,
    eventRows,
    t09Count,
    transactions,
  };
}
