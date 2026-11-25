import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import {
  FAKE_REPLAY_TOLERANCE_SECONDS,
  FAKE_SIGNATURE_HEADER,
  FAKE_TIMESTAMP_HEADER,
  FakePaymentGateway,
  fakeSign,
} from './fake-gateway.js';
import {
  DEFAULT_GATEWAY_CAPABILITIES,
  GatewayPayloadError,
  GatewayUnavailableError,
  type GatewayCreateOrderInput,
} from './gateway.js';

const SECRET = 'fake-test-secret-0123456789';
const ORDER_ID = '0192a000-0000-7000-8000-000000000001';

function setup() {
  const clock = new FixedClock('2026-11-25T10:00:00Z');
  const gateway = new FakePaymentGateway({ clock, secret: SECRET });
  const input: GatewayCreateOrderInput = {
    paymentOrderId: ORDER_ID,
    bookingNo: 'LC-2611-0000001',
    amountPaise: 123_456n,
    customer: { name: 'A', email: 'a@example.test' },
    returnUrl: 'https://app.example.test/payments/return?orderRef=x',
    expiresAt: new Date('2026-11-26T10:00:00Z'),
  };
  return { clock, gateway, input };
}

describe('FakePaymentGateway', () => {
  it('names itself FAKE and starts from the most conservative capabilities', () => {
    const { gateway } = setup();
    expect(gateway.code).toBe('FAKE');
    expect(DEFAULT_GATEWAY_CAPABILITIES).toEqual({
      supportsStatusEnquiry: false,
      supportsRefundApi: false,
      supportsPartialRefund: false,
      supportsSplitSettlement: false,
      supportsDelayedSettlement: false,
      supportsPayoutApi: false,
      supportsSettlementReport: false,
    });
    // What the fake simulates is on; what nobody has confirmed stays off.
    expect(gateway.capabilities.supportsRefundApi).toBe(true);
    expect(gateway.capabilities.supportsSplitSettlement).toBe(false);
    expect(gateway.capabilities.supportsDelayedSettlement).toBe(false);
    expect(gateway.capabilities.supportsPayoutApi).toBe(false);
    expect(gateway.payouts).toBeNull();
    expect(Object.isFrozen(gateway.capabilities)).toBe(true);
  });

  it('refuses a short secret', () => {
    expect(() => new FakePaymentGateway({ clock: new FixedClock(0), secret: 'short' })).toThrow();
  });

  it('creates deterministic sessions with an opaque checkout and no personal data in it', async () => {
    const { gateway, input } = setup();
    const first = await gateway.createOrder(input);
    const second = await gateway.createOrder({ ...input, paymentOrderId: 'other' });
    expect(first.gatewayOrderRef).toBe('fake_ord_000001');
    expect(second.gatewayOrderRef).toBe('fake_ord_000002');
    expect(JSON.stringify(first.checkout)).not.toContain('example.test');
    expect(gateway.orderRefFor(ORDER_ID)).toBe('fake_ord_000001');
  });

  it('refuses a non-positive amount and can be told to be unavailable once', async () => {
    const { gateway, input } = setup();
    await expect(gateway.createOrder({ ...input, amountPaise: 0n })).rejects.toThrow(RangeError);
    gateway.failNextCreateOrder();
    await expect(gateway.createOrder(input)).rejects.toThrow(GatewayUnavailableError);
    await expect(gateway.createOrder(input)).resolves.toBeDefined();
  });

  it('reports the session state through fetchStatus, and NOT_FOUND for a stranger', async () => {
    const { gateway, input } = setup();
    const { gatewayOrderRef } = await gateway.createOrder(input);
    expect((await gateway.fetchStatus({ gatewayOrderRef })).state).toBe('PENDING');
    gateway.completePayment(gatewayOrderRef);
    const status = await gateway.fetchStatus({ gatewayOrderRef });
    expect(status).toMatchObject({ state: 'CAPTURED', amountPaise: 123_456n, currency: 'INR' });
    expect(status.gatewayPaymentRef).toMatch(/^fake_pay_/);
    expect((await gateway.fetchStatus({ gatewayOrderRef: 'nope' })).state).toBe('NOT_FOUND');
  });

  describe('signature verification', () => {
    it('accepts a notification it signed and returns neutral events', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const note = gateway.completePayment(gatewayOrderRef);
      const result = await gateway.verifyAndParseWebhook(note);
      expect(result.valid).toBe(true);
      expect(result.events).toHaveLength(1);
      expect(result.eventId).toBe(result.events[0]?.gatewayEventId);
      expect(result.events[0]).toMatchObject({
        type: 'PAYMENT_CAPTURED',
        merchantReference: ORDER_ID,
        amountPaise: 123_456n,
        currency: 'INR',
        method: 'UPI',
      });
    });

    it('rejects a tampered body', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const note = gateway.completePayment(gatewayOrderRef);
      const tampered = Buffer.from(note.body.toString('utf8').replace('123456', '1'), 'utf8');
      const result = await gateway.verifyAndParseWebhook({ headers: note.headers, body: tampered });
      expect(result).toEqual({ valid: false, events: [] });
    });

    it('rejects a signature made with another secret', async () => {
      const { clock, gateway, input } = setup();
      const other = new FakePaymentGateway({ clock, secret: 'another-secret-0123456789' });
      const { gatewayOrderRef } = await other.createOrder(input);
      const note = other.completePayment(gatewayOrderRef);
      expect((await gateway.verifyAndParseWebhook(note)).valid).toBe(false);
    });

    it('rejects missing, malformed and truncated signature headers', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const note = gateway.completePayment(gatewayOrderRef);
      const without = (name: string) => {
        const headers = Object.fromEntries(
          Object.entries(note.headers).filter(([key]) => key !== name),
        );
        return { headers, body: note.body };
      };
      expect((await gateway.verifyAndParseWebhook(without(FAKE_SIGNATURE_HEADER))).valid).toBe(
        false,
      );
      expect((await gateway.verifyAndParseWebhook(without(FAKE_TIMESTAMP_HEADER))).valid).toBe(
        false,
      );
      const bad = { ...note.headers, [FAKE_SIGNATURE_HEADER]: 'zz' };
      expect((await gateway.verifyAndParseWebhook({ headers: bad, body: note.body })).valid).toBe(
        false,
      );
      const half = note.headers[FAKE_SIGNATURE_HEADER]?.slice(0, 32) ?? '';
      const short = { ...note.headers, [FAKE_SIGNATURE_HEADER]: half };
      expect((await gateway.verifyAndParseWebhook({ headers: short, body: note.body })).valid).toBe(
        false,
      );
      const stamp = { ...note.headers, [FAKE_TIMESTAMP_HEADER]: 'abc' };
      expect((await gateway.verifyAndParseWebhook({ headers: stamp, body: note.body })).valid).toBe(
        false,
      );
    });

    it('rejects a replay outside the tolerance, in either direction, and accepts one inside it', async () => {
      const { clock, gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const note = gateway.completePayment(gatewayOrderRef);
      clock.advance((FAKE_REPLAY_TOLERANCE_SECONDS - 5) * 1000);
      expect((await gateway.verifyAndParseWebhook(note)).valid).toBe(true);
      clock.advance(10 * 1000);
      expect((await gateway.verifyAndParseWebhook(note)).valid).toBe(false);
      // A timestamp from the future is as bad.
      const future = gateway.signBody(note.body, Math.floor(clock.now().getTime() / 1000) + 1000);
      expect((await gateway.verifyAndParseWebhook(future)).valid).toBe(false);
    });

    it('treats an authentic body it cannot understand as valid with no events', async () => {
      const { gateway } = setup();
      const note = gateway.signBody(Buffer.from('not json', 'utf8'));
      expect(await gateway.verifyAndParseWebhook(note)).toEqual({ valid: true, events: [] });
      const empty = gateway.signBody(Buffer.from('{"fakeEvents":[{"fakeType":"x"}]}', 'utf8'));
      expect((await gateway.verifyAndParseWebhook(empty)).events).toEqual([]);
    });

    it('binds the signature to the timestamp', async () => {
      const { clock, gateway } = setup();
      const body = Buffer.from('{"fakeEvents":[]}', 'utf8');
      const stamp = Math.floor(clock.now().getTime() / 1000);
      const note = {
        headers: {
          [FAKE_TIMESTAMP_HEADER]: String(stamp + 1),
          [FAKE_SIGNATURE_HEADER]: fakeSign(SECRET, stamp, body),
        },
        body,
      };
      expect((await gateway.verifyAndParseWebhook(note)).valid).toBe(false);
    });
  });

  describe('scenarios a test can drive', () => {
    it('sends a duplicate by reusing the event id', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const first = gateway.completePayment(gatewayOrderRef, { eventId: 'dup-1' });
      const second = gateway.buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: ORDER_ID,
        eventId: 'dup-1',
        paymentRef: 'p1',
        amountPaise: 123_456n,
      });
      const a = await gateway.verifyAndParseWebhook(first);
      const b = await gateway.verifyAndParseWebhook(second);
      expect(a.eventId).toBe('dup-1');
      expect(b.eventId).toBe('dup-1');
    });

    it('can send a wrong amount, an unknown reference, another currency and a failure or an expiry', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      const wrong = await gateway.verifyAndParseWebhook(
        gateway.completePayment(gatewayOrderRef, { amountPaise: 1n }),
      );
      expect(wrong.events[0]?.amountPaise).toBe(1n);
      const stranger = await gateway.verifyAndParseWebhook(
        gateway.buildNotification({
          type: 'PAYMENT_CAPTURED',
          merchantReference: 'unknown',
          amountPaise: 5n,
          currency: 'USD',
        }),
      );
      expect(stranger.events[0]).toMatchObject({ merchantReference: 'unknown', currency: 'USD' });
      const failed = await gateway.verifyAndParseWebhook(gateway.failPayment(gatewayOrderRef));
      expect(failed.events[0]?.type).toBe('PAYMENT_FAILED');
      const expired = await gateway.verifyAndParseWebhook(gateway.expirePayment(gatewayOrderRef));
      expect(expired.events[0]?.type).toBe('PAYMENT_EXPIRED');
    });

    it('carries several events in one notification, in the order given', async () => {
      const { gateway } = setup();
      const note = gateway.buildNotification(
        { type: 'PAYMENT_FAILED', merchantReference: ORDER_ID, amountPaise: 9n, eventId: 'e-2' },
        { type: 'PAYMENT_CAPTURED', merchantReference: ORDER_ID, amountPaise: 9n, eventId: 'e-1' },
      );
      const result = await gateway.verifyAndParseWebhook(note);
      expect(result.events.map((event) => event.gatewayEventId)).toEqual(['e-2', 'e-1']);
      expect(result.eventId).toBeUndefined();
    });

    it('parses a stored body without authenticating it, and refuses garbage', () => {
      const { gateway } = setup();
      const note = gateway.buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: ORDER_ID,
        amountPaise: 7n,
      });
      expect(gateway.parseVerifiedWebhookBody(note.body)[0]?.amountPaise).toBe(7n);
      expect(() => gateway.parseVerifiedWebhookBody(Buffer.from('x'))).toThrow(GatewayPayloadError);
      expect(() =>
        gateway.parseVerifiedWebhookBody(
          Buffer.from(JSON.stringify({ fakeEvents: [{ fakeAmountPaise: '1.5' }] })),
        ),
      ).toThrow(GatewayPayloadError);
    });
  });

  describe('refund', () => {
    it('refunds partly and fully, never beyond the capture, and is idempotent on the refund id', async () => {
      const { gateway, input } = setup();
      const { gatewayOrderRef } = await gateway.createOrder(input);
      gateway.completePayment(gatewayOrderRef);
      const { gatewayPaymentRef } = await gateway.fetchStatus({ gatewayOrderRef });
      const ref = gatewayPaymentRef ?? '';
      const part = await gateway.refund({
        gatewayTxnRef: ref,
        amountPaise: 100n,
        refundId: 'r1',
        reason: 'x',
      });
      expect(part.status).toBe('SUCCEEDED');
      expect(
        await gateway.refund({
          gatewayTxnRef: ref,
          amountPaise: 100n,
          refundId: 'r1',
          reason: 'x',
        }),
      ).toEqual(part);
      await expect(
        gateway.refund({ gatewayTxnRef: ref, amountPaise: 99n, refundId: 'r1', reason: 'x' }),
      ).rejects.toThrow(RangeError);
      await expect(
        gateway.refund({ gatewayTxnRef: ref, amountPaise: 123_457n, refundId: 'r2', reason: 'x' }),
      ).rejects.toThrow(RangeError);
      await expect(
        gateway.refund({ gatewayTxnRef: ref, amountPaise: 123_356n, refundId: 'r3', reason: 'x' }),
      ).resolves.toMatchObject({ status: 'SUCCEEDED' });
      await expect(
        gateway.refund({ gatewayTxnRef: 'unknown', amountPaise: 1n, refundId: 'r4', reason: 'x' }),
      ).rejects.toThrow(RangeError);
    });
  });
});
