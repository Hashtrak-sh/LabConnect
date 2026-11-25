import type { GatewayCode } from '@labconnect/database';

/**
 * The gateway-neutral contract between the payments module and a payment gateway adapter.
 *
 * Nothing here describes any real gateway. The official gateway documentation is not
 * available (OQ-01), so the shapes below are the ones the platform needs, taken from
 * PAYMENTS_AND_LEDGER.md (section 2, the payment flow) and ICICI_PAYMENT_INTEGRATION.md
 * (section 1 requirements G-1 to G-12 and the adapter sketch of section 4). An adapter for a
 * real gateway maps its own formats onto these types; the platform never sees them.
 *
 * Money is integer paise as `bigint`, the currency is INR (PAYMENTS_AND_LEDGER.md section 1).
 */

/** The only currency (CLAUDE.md section 6). */
export const GATEWAY_CURRENCY = 'INR';

/**
 * What an adapter can do, read by callers instead of assumed (CLAUDE.md section 5: no split
 * settlement, escrow or delayed payout is assumed). Every flag defaults to `false`; an
 * adapter turns on only what its gateway documentation confirms.
 */
export interface GatewayCapabilities {
  /** G-4: the gateway answers a status enquiry by order reference. */
  readonly supportsStatusEnquiry: boolean;
  /** G-5: refunds can be requested through an API at all. */
  readonly supportsRefundApi: boolean;
  /** G-5: a refund may be for less than the captured amount. */
  readonly supportsPartialRefund: boolean;
  /** G-8: marketplace or split settlement to lab bank accounts. Unknown (OQ-02). */
  readonly supportsSplitSettlement: boolean;
  /** G-9: held or delayed settlement (72 h after report release). Unknown (OQ-02). */
  readonly supportsDelayedSettlement: boolean;
  /** G-10: payouts to arbitrary verified bank accounts. Unknown (OQ-02). */
  readonly supportsPayoutApi: boolean;
  /** G-6: a settlement report the adapter can parse. */
  readonly supportsSettlementReport: boolean;
}

/** The most conservative capabilities: nothing is supported. Adapters override what they prove. */
export const DEFAULT_GATEWAY_CAPABILITIES: GatewayCapabilities = Object.freeze({
  supportsStatusEnquiry: false,
  supportsRefundApi: false,
  supportsPartialRefund: false,
  supportsSplitSettlement: false,
  supportsDelayedSettlement: false,
  supportsPayoutApi: false,
  supportsSettlementReport: false,
});

/** What the platform asks a gateway to create (FR-PAY-01, G-1, G-2). */
export interface GatewayCreateOrderInput {
  /** Our reference: the payment order id (`payment_order.id`). The gateway must echo it back. */
  paymentOrderId: string;
  /** The booking number, a human-readable reference. Never personal data. */
  bookingNo: string;
  amountPaise: bigint;
  /** Passed to the gateway only. Never stored, logged or put in a URL by the platform. */
  customer: { name: string; email: string; phone?: string };
  /** Where the browser returns after the hosted checkout. A web-app page (OQ-44). */
  returnUrl: string;
  /** When the hosted checkout stops accepting a payment (BR-030). */
  expiresAt: Date;
}

export interface GatewayCreateOrderResult {
  /** The gateway's reference for the order (`payment_order.gateway_order_ref`). */
  gatewayOrderRef: string;
  /**
   * Opaque: handed unchanged to the web component chosen by the order's gateway code. Never
   * carries card data (FR-PAY-02, hosted checkout only).
   */
  checkout: unknown;
}

/** What the gateway reports about one payment (the answer to a status enquiry, G-4). */
export type GatewayPaymentState =
  | 'PENDING'
  | 'CAPTURED'
  | 'FAILED'
  | 'EXPIRED'
  /** The gateway has no such order. Not an error: reconciliation treats it as "not paid". */
  | 'NOT_FOUND';

export interface GatewayPaymentStatus {
  state: GatewayPaymentState;
  /** The gateway's reference for the payment (not the order), when there is a payment. */
  gatewayPaymentRef: string | null;
  amountPaise: bigint | null;
  currency: string | null;
}

/** The kinds of notification the platform acts on. Anything else an adapter maps to `null` and drops. */
export type GatewayEventType = 'PAYMENT_CAPTURED' | 'PAYMENT_FAILED' | 'PAYMENT_EXPIRED';

/**
 * A verified notification in neutral form (G-3: signed server-to-server notification with a
 * unique event id). `raw` is the adapter's own parsed form, kept for the adapter's use; the
 * platform never logs it, never copies it into audit rows or events.
 */
export interface GatewayEvent {
  /** Unique per gateway. The replay and duplicate key (`gateway_webhook_event.event_id`). */
  gatewayEventId: string;
  type: GatewayEventType;
  /** The gateway's reference for the payment (`payment_transaction.gateway_txn_ref`). */
  gatewayPaymentRef: string;
  /** Our reference, as sent in `GatewayCreateOrderInput.paymentOrderId`. */
  merchantReference: string;
  amountPaise: bigint;
  /** ISO 4217. The platform accepts only `GATEWAY_CURRENCY`. */
  currency: string;
  /** How the customer paid as reported (UPI, card, netbanking), if reported. Not sensitive. */
  method: string | null;
  occurredAt: Date;
  raw: unknown;
}

export interface GatewayWebhookInput {
  /** Header names lower-cased. */
  headers: Readonly<Record<string, string>>;
  /** The body exactly as received: signatures cover bytes, not parsed objects. */
  body: Buffer;
}

export interface GatewayWebhookResult {
  /** True only if the notification is authentic. When false, `events` is empty. */
  valid: boolean;
  /** The notification's own id, when it has exactly one. */
  eventId?: string;
  events: GatewayEvent[];
}

export interface GatewayRefundInput {
  /** The gateway's reference for the captured payment (`payment_transaction.gateway_txn_ref`). */
  gatewayTxnRef: string;
  amountPaise: bigint;
  /** Our refund id (`refund.id`); the gateway must treat a repeat of it as the same refund. */
  refundId: string;
  reason: string;
}

export type GatewayRefundStatus = 'SUBMITTED' | 'SUCCEEDED' | 'FAILED';

export interface GatewayRefundResult {
  gatewayRefundRef: string;
  status: GatewayRefundStatus;
}

/**
 * Payout API (G-10). Its shape is not specified anywhere (OQ-02, ADR-009 pending), so it is
 * a marker: an adapter returns `null` until the shape is decided, and callers must handle
 * `null`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- placeholder until OQ-02 settles the shape
export interface GatewayPayouts {}

/** One line of a gateway settlement report (G-6): the columns of `settlement_report_line`. */
export interface SettlementLine {
  settlementDate: Date;
  gatewayTxnRef: string;
  grossPaise: bigint;
  feePaise: bigint;
  taxPaise: bigint;
  netPaise: bigint;
  utr: string | null;
}

/**
 * Adapter interface. A real gateway implements it in its own file; selection by configuration
 * is in `createPaymentGateway`. Each member says which document section requires it.
 */
export interface PaymentGateway {
  /** ICICI_PAYMENT_INTEGRATION.md section 4: `readonly code`. Matches `payment_order.gateway`. */
  readonly code: GatewayCode;

  /**
   * Capability flags (ICICI_PAYMENT_INTEGRATION.md section 1, G-4 to G-10). Read these; never
   * assume. Start from `DEFAULT_GATEWAY_CAPABILITIES`.
   */
  readonly capabilities: GatewayCapabilities;

  /**
   * Creates a hosted-checkout order for our reference and amount (PAYMENTS_AND_LEDGER.md
   * section 2 `createOrder()`; FR-PAY-01, G-1, G-2). Throws `GatewayUnavailableError` when the
   * gateway could not create it (safe to retry, `GATEWAY_UNAVAILABLE`).
   */
  createOrder(input: GatewayCreateOrderInput): Promise<GatewayCreateOrderResult>;

  /**
   * Authenticates a notification and turns it into neutral events (PAYMENTS_AND_LEDGER.md
   * section 2 "webhook (signed)"; ICICI_PAYMENT_INTEGRATION.md section 4
   * `verifyAndParseWebhook`; G-3, FR-PAY-07). Never throws for a notification that is merely
   * not authentic or not understood: it answers `valid: false` (or no events).
   */
  verifyAndParseWebhook(input: GatewayWebhookInput): Promise<GatewayWebhookResult>;

  /**
   * The parsing half of `verifyAndParseWebhook`, for a body that was verified when it arrived
   * and has been stored since (ICICI_PAYMENT_INTEGRATION.md section 4: "store the raw body
   * before parsing ... process in a transaction"). It must not authenticate, and it must
   * return the same events `verifyAndParseWebhook` returned for that body. Throws
   * `GatewayPayloadError` if the body cannot be understood. OQ-125.
   */
  parseVerifiedWebhookBody(body: Buffer): GatewayEvent[];

  /**
   * Asks the gateway for the state of an order (PAYMENTS_AND_LEDGER.md section 2 note:
   * "Reconciliation job polls PENDING orders"; EC-15; G-4). Only call it when
   * `capabilities.supportsStatusEnquiry`.
   */
  fetchStatus(ref: { gatewayOrderRef: string }): Promise<GatewayPaymentStatus>;

  /**
   * Refunds to the original method (PAYMENTS_AND_LEDGER.md section 4; FR-PAY-06; G-5). Only
   * call it when `capabilities.supportsRefundApi`; a partial amount only when
   * `capabilities.supportsPartialRefund`. The refund workflow itself is not part of the
   * gateway.
   */
  refund(input: GatewayRefundInput): Promise<GatewayRefundResult>;

  /**
   * Payout API, `null` when the gateway has none (ICICI_PAYMENT_INTEGRATION.md section 4 and
   * section 5; G-10, OQ-02). Callers must handle `null`.
   */
  readonly payouts?: GatewayPayouts | null;

  /**
   * Parses the gateway's settlement report (ICICI_PAYMENT_INTEGRATION.md section 4; G-6,
   * FR-FIN-03). Absent when `capabilities.supportsSettlementReport` is false.
   */
  parseSettlementReport?(file: Buffer): Promise<SettlementLine[]>;
}

/** The gateway could not be reached or refused to create the order. Maps to `GATEWAY_UNAVAILABLE`. */
export class GatewayUnavailableError extends Error {
  override name = 'GatewayUnavailableError';
}

/** A stored or received body cannot be understood by the adapter. */
export class GatewayPayloadError extends Error {
  override name = 'GatewayPayloadError';
}
