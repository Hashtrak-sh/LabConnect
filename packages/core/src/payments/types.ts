import type { GatewayCode } from '@labconnect/database';
import type { BookingEngine } from '../booking/engine.js';
import type { AuditService } from '../platform/audit.js';
import type { Clock } from '../platform/clock.js';
import type { OutboxService } from '../platform/outbox.js';
import type { TimerService } from '../platform/timers.js';
import type { PaymentGateway } from './gateway.js';

/**
 * Encrypts the raw body of a gateway notification before it is stored (SCHEMA_SPECIFICATION
 * section 10.3 `payload_ciphertext`). The same shape as `SecretCipher` (identity), so the
 * app can hand it the same implementation, and the KMS adapter of P3-11 replaces it for
 * both. `context` is authenticated data: it ties a blob to its row.
 */
export interface PaymentPayloadCipher {
  encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array>;
  decrypt(blob: Uint8Array, context: string): Promise<Uint8Array>;
}

/**
 * The part of the booking engine the payments module uses. Payments reaches the booking only
 * through the engine's transition function (MODULE_BOUNDARIES rule 4, CLAUDE.md section 5):
 * it never writes `booking.status`.
 */
export type PaymentBookingEngine = Pick<BookingEngine, 'transitionIfStatus'>;

export interface PaymentServiceDeps {
  gateway: PaymentGateway;
  cipher: PaymentPayloadCipher;
  clock: Clock;
  audit: AuditService;
  outbox: OutboxService;
  timers: TimerService;
  engine: PaymentBookingEngine;
}

/** The aggregate type of a stored gateway notification in outbox events. */
export const GATEWAY_EVENT_AGGREGATE = 'gateway_webhook_event';
/** The aggregate type of a payment order in audit rows. */
export const PAYMENT_ORDER_AGGREGATE = 'payment_order';

/**
 * Event codes of the payments module. None is in NOTIFICATIONS_MATRIX.md, so none is routed
 * to notifications (`routes.ts` sends unknown codes to the analytics queue only). OQ-126.
 */
export const PAYMENT_EVENTS = {
  /** A verified gateway notification was stored and waits for processing. Ids only. */
  gatewayEventReceived: 'payment.gateway_event_received',
  /** A notification needs a person (Finance): mismatch, duplicate, late, unknown. Ids and a code only. */
  exceptionRaised: 'payment.exception_raised',
} as const;

/**
 * Why a stored notification needs a person. These are the "exception path" of
 * PAYMENTS_AND_LEDGER.md: the schema has no reconciliation exception table, so an exception is
 * a `gateway_webhook_event` row with `processing_status = FAILED` and one of these codes in
 * `error`, plus an audit row and the `payment.exception_raised` event (OQ-127).
 */
export type PaymentExceptionCode =
  /** `PAYMENT_AMOUNT_MISMATCH` (ERROR_HANDLING.md): the captured amount is not the order's. */
  | 'PAYMENT_AMOUNT_MISMATCH'
  /** The currency is not INR. */
  | 'CURRENCY_MISMATCH'
  /** No payment order of this gateway has the reference. */
  | 'UNKNOWN_REFERENCE'
  /** A second capture on a booking that already has one (BR-033). */
  | 'DUPLICATE_CAPTURE'
  /** A capture after the booking left ACCEPTED, for example EXPIRED_UNPAID (OQ-27). */
  | 'LATE_CAPTURE'
  /** A capture reported for an order that is already FAILED or EXPIRED here. */
  | 'CAPTURE_ON_CLOSED_ORDER'
  /** The stored body cannot be decrypted or understood. */
  | 'PAYLOAD_UNREADABLE';

export type IntakeOutcome =
  /** Stored, and waiting for processing. */
  | 'ACCEPTED'
  /** An event with this gateway event id was already stored; nothing new. */
  | 'DUPLICATE'
  /** Stored as not trustworthy (signature invalid, or nothing usable in the body); never processed. */
  | 'REJECTED';

export interface IntakeResult {
  outcome: IntakeOutcome;
  /** How many rows were newly stored. */
  stored: number;
  /** How many of the events in the body were already known. */
  duplicates: number;
}

export interface RecordGatewayEventInput {
  gateway: GatewayCode;
  /** Header names lower-cased. Used for verification only; never stored. */
  headers: Readonly<Record<string, string>>;
  /** The body exactly as received. */
  body: Buffer;
  requestId?: string;
}

export type ProcessStatus = 'PROCESSED' | 'IGNORED' | 'FAILED';

export interface ProcessResult {
  /** `SKIPPED` when the row was not waiting (already processed, or not found). */
  status: ProcessStatus | 'SKIPPED';
  /** Short code of what happened, safe to log. */
  code: string;
  paymentOrderId?: string;
  bookingId?: string;
}
