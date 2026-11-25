import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../platform/clock.js';
import {
  DEFAULT_GATEWAY_CAPABILITIES,
  GATEWAY_CURRENCY,
  GatewayPayloadError,
  GatewayUnavailableError,
  type GatewayCapabilities,
  type GatewayCreateOrderInput,
  type GatewayCreateOrderResult,
  type GatewayEvent,
  type GatewayEventType,
  type GatewayPaymentStatus,
  type GatewayRefundInput,
  type GatewayRefundResult,
  type GatewayWebhookInput,
  type GatewayWebhookResult,
  type PaymentGateway,
} from './gateway.js';

/** Header names of the fake gateway's own signing scheme. They belong to the fake and to nothing else. */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
export const FAKE_TIMESTAMP_HEADER = 'x-fake-timestamp';
/** A notification older (or newer) than this many seconds is a replay and is refused. */
export const FAKE_REPLAY_TOLERANCE_SECONDS = 300;

/**
 * The fake's signature: hex HMAC-SHA256 over `<timestamp seconds>.<body bytes>` under the
 * shared fake secret. This is an invention for development and tests; it is not any real
 * gateway's scheme and says nothing about how one signs.
 */
export function fakeSign(secret: string, timestampSeconds: number, body: Buffer): string {
  return createHmac('sha256', secret)
    .update(`${String(timestampSeconds)}.`)
    .update(body)
    .digest('hex');
}

/** A notification as the fake gateway would send it: what a test posts to the webhook endpoint. */
export interface FakeNotification {
  headers: Record<string, string>;
  body: Buffer;
}

/** Wire names of the fake's body. Prefixed `fake` on purpose. */
interface FakeWireEvent {
  fakeEventId: string;
  fakeType: string;
  fakePaymentRef: string;
  fakeMerchantReference: string;
  /** Decimal digits, as a string, so a bigint survives JSON. */
  fakeAmountPaise: string;
  fakeCurrency: string;
  fakeMethod: string | null;
  fakeOccurredAt: string;
}

const FAKE_TYPES: Readonly<Record<string, GatewayEventType>> = {
  'fake.payment.captured': 'PAYMENT_CAPTURED',
  'fake.payment.failed': 'PAYMENT_FAILED',
  'fake.payment.expired': 'PAYMENT_EXPIRED',
};
const FAKE_WIRE_TYPES: Readonly<Record<GatewayEventType, string>> = {
  PAYMENT_CAPTURED: 'fake.payment.captured',
  PAYMENT_FAILED: 'fake.payment.failed',
  PAYMENT_EXPIRED: 'fake.payment.expired',
};

interface FakeSession {
  gatewayOrderRef: string;
  merchantReference: string;
  amountPaise: bigint;
  expiresAt: Date;
  state: 'PENDING' | 'CAPTURED' | 'FAILED' | 'EXPIRED';
  paymentRef: string | null;
  refundedPaise: bigint;
}

export interface FakeGatewayOptions {
  clock: Clock;
  /** The fake HMAC key. Not a real secret, but still read from configuration, never hard-coded. */
  secret: string;
  /** Overrides the replay tolerance of the notification timestamp. */
  replayToleranceSeconds?: number;
}

/** What `buildNotification` can vary: everything a test needs to make a notification odd. */
export interface FakeEventSpec {
  type: GatewayEventType;
  merchantReference: string;
  /** Defaults to a fresh `fake_evt_NNNNNN`. Reuse one to send a duplicate. */
  eventId?: string;
  paymentRef?: string;
  amountPaise: bigint;
  currency?: string;
  method?: string | null;
  occurredAt?: Date;
}

/**
 * A deterministic gateway for development, tests and UAT before a real gateway exists
 * (ICICI_PAYMENT_INTEGRATION.md section 4; TESTING_STRATEGY.md section 8). Sessions live in
 * memory of this instance and ids come from counters, so a run is repeatable.
 *
 * Driving it (the "driver" methods): `completePayment`, `failPayment` and `expirePayment`
 * change a session and return the signed notification the gateway would send. A test or a
 * dev tool posts it to the webhook endpoint, once, twice (duplicate), in the wrong order, or
 * after tampering with it. `buildNotification` builds any notification, including one for an
 * unknown reference or with a wrong amount, with or without a valid signature.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly code = 'FAKE' as const;
  readonly capabilities: GatewayCapabilities = Object.freeze({
    ...DEFAULT_GATEWAY_CAPABILITIES,
    supportsStatusEnquiry: true,
    supportsRefundApi: true,
    supportsPartialRefund: true,
  });
  readonly payouts = null;

  private readonly clock: Clock;
  private readonly secret: string;
  private readonly tolerance: number;
  private readonly sessions = new Map<string, FakeSession>();
  private readonly byMerchantReference = new Map<string, string>();
  private readonly refunds = new Map<string, GatewayRefundResult & { amountPaise: bigint }>();
  private orderCounter = 0;
  private paymentCounter = 0;
  private eventCounter = 0;
  private refundCounter = 0;
  /** Makes the next `createOrder` fail, to test the unavailable path. */
  private failNextCreate = false;

  constructor(options: FakeGatewayOptions) {
    if (options.secret.length < 16) {
      throw new Error('The fake gateway secret must be at least 16 characters.');
    }
    this.clock = options.clock;
    this.secret = options.secret;
    this.tolerance = options.replayToleranceSeconds ?? FAKE_REPLAY_TOLERANCE_SECONDS;
  }

  // ---------------------------------------------------------------------------------------
  // PaymentGateway
  // ---------------------------------------------------------------------------------------

  createOrder(input: GatewayCreateOrderInput): Promise<GatewayCreateOrderResult> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return Promise.reject(new GatewayUnavailableError('The fake gateway is set to be down.'));
    }
    if (input.amountPaise <= 0n) {
      return Promise.reject(new RangeError('The amount must be positive.'));
    }
    if (input.paymentOrderId.length === 0 || input.returnUrl.length === 0) {
      return Promise.reject(new RangeError('A reference and a return URL are required.'));
    }
    this.orderCounter += 1;
    const gatewayOrderRef = `fake_ord_${pad(this.orderCounter)}`;
    this.sessions.set(gatewayOrderRef, {
      gatewayOrderRef,
      merchantReference: input.paymentOrderId,
      amountPaise: input.amountPaise,
      expiresAt: input.expiresAt,
      state: 'PENDING',
      paymentRef: null,
      refundedPaise: 0n,
    });
    this.byMerchantReference.set(input.paymentOrderId, gatewayOrderRef);
    return Promise.resolve({
      gatewayOrderRef,
      // Opaque to the platform. No card data, no personal data.
      checkout: {
        fakeCheckoutUrl: `fake://checkout/${gatewayOrderRef}`,
        fakeOrderRef: gatewayOrderRef,
      },
    });
  }

  async verifyAndParseWebhook(input: GatewayWebhookInput): Promise<GatewayWebhookResult> {
    await Promise.resolve();
    if (!this.signatureIsValid(input)) return { valid: false, events: [] };
    let events: GatewayEvent[];
    try {
      events = this.parseVerifiedWebhookBody(input.body);
    } catch {
      // Authentic but not understood: valid, with nothing to act on.
      return { valid: true, events: [] };
    }
    const [only] = events;
    return events.length === 1 && only
      ? { valid: true, eventId: only.gatewayEventId, events }
      : { valid: true, events };
  }

  parseVerifiedWebhookBody(body: Buffer): GatewayEvent[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch (error) {
      throw new GatewayPayloadError('The fake notification is not JSON.', { cause: error });
    }
    const wire = (parsed as { fakeEvents?: unknown } | null)?.fakeEvents;
    if (!Array.isArray(wire)) throw new GatewayPayloadError('The fake notification has no events.');
    return wire.map((item) => toEvent(item));
  }

  fetchStatus(ref: { gatewayOrderRef: string }): Promise<GatewayPaymentStatus> {
    const session = this.sessions.get(ref.gatewayOrderRef);
    if (!session) {
      return Promise.resolve({
        state: 'NOT_FOUND',
        gatewayPaymentRef: null,
        amountPaise: null,
        currency: null,
      });
    }
    return Promise.resolve({
      state: session.state,
      gatewayPaymentRef: session.paymentRef,
      amountPaise: session.state === 'CAPTURED' ? session.amountPaise : null,
      currency: session.state === 'CAPTURED' ? GATEWAY_CURRENCY : null,
    });
  }

  refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    const earlier = this.refunds.get(input.refundId);
    if (earlier) {
      if (earlier.amountPaise !== input.amountPaise) {
        return Promise.reject(new RangeError('The refund id was used with another amount.'));
      }
      return Promise.resolve({
        gatewayRefundRef: earlier.gatewayRefundRef,
        status: earlier.status,
      });
    }
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.paymentRef === input.gatewayTxnRef && candidate.state === 'CAPTURED',
    );
    if (!session) return Promise.reject(new RangeError('No captured payment has that reference.'));
    if (
      input.amountPaise <= 0n ||
      session.refundedPaise + input.amountPaise > session.amountPaise
    ) {
      return Promise.reject(new RangeError('The refund exceeds what was captured.'));
    }
    session.refundedPaise += input.amountPaise;
    this.refundCounter += 1;
    const result = {
      gatewayRefundRef: `fake_ref_${pad(this.refundCounter)}`,
      status: 'SUCCEEDED' as const,
    };
    this.refunds.set(input.refundId, { ...result, amountPaise: input.amountPaise });
    return Promise.resolve(result);
  }

  // ---------------------------------------------------------------------------------------
  // Driver: what a test or a dev tool does to the fake gateway
  // ---------------------------------------------------------------------------------------

  /** The next `createOrder` fails with `GatewayUnavailableError`. */
  failNextCreateOrder(): void {
    this.failNextCreate = true;
  }

  /** Marks the session captured and returns the gateway's notification. `amountPaise` overrides the amount (mismatch). */
  completePayment(
    gatewayOrderRef: string,
    overrides: { amountPaise?: bigint; eventId?: string; paymentRef?: string } = {},
  ): FakeNotification {
    const session = this.need(gatewayOrderRef);
    this.paymentCounter += 1;
    session.paymentRef = overrides.paymentRef ?? `fake_pay_${pad(this.paymentCounter)}`;
    session.state = 'CAPTURED';
    return this.notify({
      type: 'PAYMENT_CAPTURED',
      merchantReference: session.merchantReference,
      paymentRef: session.paymentRef,
      amountPaise: overrides.amountPaise ?? session.amountPaise,
      method: 'UPI',
      ...(overrides.eventId === undefined ? {} : { eventId: overrides.eventId }),
    });
  }

  failPayment(gatewayOrderRef: string, overrides: { eventId?: string } = {}): FakeNotification {
    const session = this.need(gatewayOrderRef);
    this.paymentCounter += 1;
    session.paymentRef = `fake_pay_${pad(this.paymentCounter)}`;
    session.state = 'FAILED';
    return this.notify({
      type: 'PAYMENT_FAILED',
      merchantReference: session.merchantReference,
      paymentRef: session.paymentRef,
      amountPaise: session.amountPaise,
      ...(overrides.eventId === undefined ? {} : { eventId: overrides.eventId }),
    });
  }

  expirePayment(gatewayOrderRef: string, overrides: { eventId?: string } = {}): FakeNotification {
    const session = this.need(gatewayOrderRef);
    this.paymentCounter += 1;
    session.state = 'EXPIRED';
    return this.notify({
      type: 'PAYMENT_EXPIRED',
      merchantReference: session.merchantReference,
      paymentRef: `fake_pay_${pad(this.paymentCounter)}`,
      amountPaise: session.amountPaise,
      ...(overrides.eventId === undefined ? {} : { eventId: overrides.eventId }),
    });
  }

  /** The gateway order reference of one of our payment orders, if the fake has seen it. */
  orderRefFor(paymentOrderId: string): string | undefined {
    return this.byMerchantReference.get(paymentOrderId);
  }

  /** A correctly signed notification for any event, however odd (unknown reference, wrong amount, repeated id). */
  buildNotification(...specs: FakeEventSpec[]): FakeNotification {
    return this.notify(...specs);
  }

  /** A correctly signed notification with a given body, for hand-made bodies. */
  signBody(body: Buffer, timestampSeconds = this.nowSeconds()): FakeNotification {
    return {
      headers: {
        [FAKE_TIMESTAMP_HEADER]: String(timestampSeconds),
        [FAKE_SIGNATURE_HEADER]: fakeSign(this.secret, timestampSeconds, body),
        'content-type': 'application/json',
      },
      body,
    };
  }

  // ---------------------------------------------------------------------------------------

  private notify(...specs: FakeEventSpec[]): FakeNotification {
    const fakeEvents: FakeWireEvent[] = specs.map((spec) => {
      this.eventCounter += 1;
      this.paymentCounter += spec.paymentRef === undefined ? 1 : 0;
      return {
        fakeEventId: spec.eventId ?? `fake_evt_${pad(this.eventCounter)}`,
        fakeType: FAKE_WIRE_TYPES[spec.type],
        fakePaymentRef: spec.paymentRef ?? `fake_pay_${pad(this.paymentCounter)}`,
        fakeMerchantReference: spec.merchantReference,
        fakeAmountPaise: spec.amountPaise.toString(),
        fakeCurrency: spec.currency ?? GATEWAY_CURRENCY,
        fakeMethod: spec.method ?? null,
        fakeOccurredAt: (spec.occurredAt ?? this.clock.now()).toISOString(),
      };
    });
    return this.signBody(Buffer.from(JSON.stringify({ fakeEvents }), 'utf8'));
  }

  private need(gatewayOrderRef: string): FakeSession {
    const session = this.sessions.get(gatewayOrderRef);
    if (!session) throw new RangeError('The fake gateway has no such order.');
    return session;
  }

  private nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }

  private signatureIsValid(input: GatewayWebhookInput): boolean {
    const signature = input.headers[FAKE_SIGNATURE_HEADER];
    const stamp = input.headers[FAKE_TIMESTAMP_HEADER];
    if (signature === undefined || stamp === undefined || !/^\d{1,12}$/.test(stamp)) return false;
    const timestamp = Number(stamp);
    if (Math.abs(this.nowSeconds() - timestamp) > this.tolerance) return false; // replay or clock skew
    const expected = Buffer.from(fakeSign(this.secret, timestamp, input.body), 'hex');
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

function pad(counter: number): string {
  return String(counter).padStart(6, '0');
}

function toEvent(item: unknown): GatewayEvent {
  const wire = item as Partial<FakeWireEvent> | null;
  const type = typeof wire?.fakeType === 'string' ? FAKE_TYPES[wire.fakeType] : undefined;
  if (
    wire === null ||
    type === undefined ||
    typeof wire.fakeEventId !== 'string' ||
    typeof wire.fakePaymentRef !== 'string' ||
    typeof wire.fakeMerchantReference !== 'string' ||
    typeof wire.fakeAmountPaise !== 'string' ||
    !/^[0-9]{1,18}$/.test(wire.fakeAmountPaise) ||
    typeof wire.fakeCurrency !== 'string' ||
    typeof wire.fakeOccurredAt !== 'string'
  ) {
    throw new GatewayPayloadError('A fake notification event is malformed.');
  }
  const occurredAt = new Date(wire.fakeOccurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new GatewayPayloadError('A fake notification event has no valid time.');
  }
  return {
    gatewayEventId: wire.fakeEventId,
    type,
    gatewayPaymentRef: wire.fakePaymentRef,
    merchantReference: wire.fakeMerchantReference,
    amountPaise: BigInt(wire.fakeAmountPaise),
    currency: wire.fakeCurrency,
    method: typeof wire.fakeMethod === 'string' ? wire.fakeMethod : null,
    occurredAt,
    raw: wire,
  };
}
