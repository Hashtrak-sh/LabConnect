import { withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { BookingError, type FakeNotification } from '../../src/index.js';
import { usePaymentsHarness } from './payments-support.js';

// P3-09: processing of stored gateway notifications: the attempt's status, T-09 exactly once,
// and the exception path for everything that is not an exact, first, in-time capture.

describe('gateway event processing', () => {
  const h = usePaymentsHarness();

  /** An ACCEPTED booking with a PENDING attempt at the fake gateway. */
  const pending = async (dueInMs?: number) => {
    const bookingId = await h.acceptedBooking(dueInMs);
    const { orderId } = await h.startPayment(bookingId);
    const ref = h.gateway.orderRefFor(orderId) ?? '';
    return { bookingId, orderId, ref };
  };
  const exceptionsOf = (orderId: string) =>
    h.rows<{ error: string; processing_status: string }>(
      `SELECT g.error, g.processing_status::text AS processing_status
         FROM gateway_webhook_event g
        WHERE g.processing_status = 'FAILED' AND g.id IN (
          SELECT (aggregate_id) FROM outbox_event
           WHERE event_type = 'payment.exception_raised' AND payload -> 'data' ->> 'paymentOrderId' = $1)`,
      [orderId],
    );
  const raised = (rowId: string) =>
    h.rows<{ payload: { data: Record<string, unknown> } }>(
      `SELECT payload FROM outbox_event WHERE event_type = 'payment.exception_raised' AND aggregate_id = $1`,
      [rowId],
    );
  const statusOf = async (eventId: string) =>
    (await h.eventRows(`WHERE event_id = '${eventId}'`))[0];

  /** Delivers the notification and runs the worker over it. */
  const run = async (note: FakeNotification) => {
    await h.deliver(note);
    return h.processAll();
  };

  describe('a capture of exactly the booking total', () => {
    it('captures the attempt, records the transaction and moves the booking by T-09 once', async () => {
      const { bookingId, orderId, ref } = await pending();
      const outcome = await run(h.gateway.completePayment(ref, { eventId: 'cap-1' }));
      expect(outcome.processed).toBeGreaterThanOrEqual(1);
      expect((await h.orderRow(orderId))?.status).toBe('CAPTURED');
      expect(await h.bookingStatus(bookingId)).toBe('PAID');
      expect(await h.t09Count(bookingId)).toBe(1);
      expect(await statusOf('cap-1')).toMatchObject({
        processing_status: 'PROCESSED',
        error: null,
      });
      const txns = await h.transactions(orderId);
      expect(txns).toEqual([
        expect.objectContaining({
          amount_paise: '118000',
          is_duplicate: false,
          status: 'SUCCESS',
          raw_summary: { outcome: 'CAPTURED', currency: 'INR' },
        }),
      ]);
      // The history row says the payments system did it.
      const [history] = await h.rows<{
        actor_user_id: string | null;
        actor_party: string;
        reason: string;
      }>(
        `SELECT actor_user_id, actor_party::text AS actor_party, reason FROM booking_status_history WHERE booking_id = $1 AND transition_id = 'T-09'`,
        [bookingId],
      );
      expect(history).toMatchObject({ actor_user_id: null, reason: 'Payment captured' });
      expect(
        await h.rows(
          `SELECT 1 FROM audit_log WHERE action = 'payment.captured' AND entity_id = $1`,
          [orderId],
        ),
      ).toHaveLength(1);
    });

    it('cancels the payment timers of the booking (the default effect of leaving ACCEPTED)', async () => {
      const { bookingId, orderId, ref } = await pending();
      await h.as(h.callers.system(), (tx) =>
        h.services.timers.schedule(tx, {
          type: 'PAYMENT_DUE',
          aggregate: { type: 'booking', id: bookingId },
          dueAt: new Date('2026-11-26T10:00:00Z'),
        }),
      );
      await run(h.gateway.completePayment(ref));
      expect((await h.orderRow(orderId))?.status).toBe('CAPTURED');
      const timers = await h.rows<{ status: string }>(
        `SELECT status::text AS status FROM timer WHERE aggregate_id = $1`,
        [bookingId],
      );
      expect(timers.map((t) => t.status)).toEqual(['CANCELLED']);
    });

    it('applies a duplicate delivery of the same event exactly once', async () => {
      const { bookingId, orderId, ref } = await pending();
      const note = h.gateway.completePayment(ref, { eventId: 'dup-event-1' });
      await run(note);
      await run(note);
      await run(note);
      expect(await h.t09Count(bookingId)).toBe(1);
      expect(await h.transactions(orderId)).toHaveLength(1);
      expect(await h.eventRows(`WHERE event_id = 'dup-event-1'`)).toHaveLength(1);
    });

    it('treats the same capture under a new event id as a harmless repeat', async () => {
      const { bookingId, orderId, ref } = await pending();
      const first = h.gateway.completePayment(ref, {
        eventId: 'rep-a',
        paymentRef: 'fake_pay_same',
      });
      await run(first);
      const again = h.gateway.buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: orderId,
        eventId: 'rep-b',
        paymentRef: 'fake_pay_same',
        amountPaise: 118_000n,
      });
      await run(again);
      expect(await h.t09Count(bookingId)).toBe(1);
      expect(await h.transactions(orderId)).toHaveLength(1);
      expect(await statusOf('rep-b')).toMatchObject({ processing_status: 'PROCESSED' });
      expect(await raised((await statusOf('rep-b'))?.id ?? '')).toHaveLength(0);
    });

    it('applies one notification once however many workers race for it', async () => {
      const { bookingId, orderId, ref } = await pending();
      await h.deliver(h.gateway.completePayment(ref, { eventId: 'race-1' }));
      const results = await Promise.all(Array.from({ length: 4 }, () => h.processAll()));
      expect(results.reduce((sum, r) => sum + r.retried, 0)).toBe(0);
      expect(await h.t09Count(bookingId)).toBe(1);
      expect(await h.transactions(orderId)).toHaveLength(1);
    });

    it('also holds when the same row is processed in two transactions at once', async () => {
      const { bookingId, ref } = await pending();
      await h.deliver(h.gateway.completePayment(ref, { eventId: 'race-2' }));
      const id = (await statusOf('race-2'))?.id ?? '';
      const one = () =>
        withDbContext(h.worker(), { kind: 'system' }, (tx) =>
          h.service.processGatewayEvent(tx, id),
        );
      const [a, b] = await Promise.all([one(), one()]);
      expect([a.status, b.status].sort()).toEqual(['PROCESSED', 'SKIPPED']);
      expect(await h.t09Count(bookingId)).toBe(1);
    });

    it('survives out-of-order delivery: a failure that arrives after the capture changes nothing', async () => {
      const { bookingId, orderId, ref } = await pending();
      const failed = h.gateway.failPayment(ref, { eventId: 'ooo-fail' });
      const captured = h.gateway.completePayment(ref, { eventId: 'ooo-cap' });
      await run(captured);
      await run(failed);
      expect((await h.orderRow(orderId))?.status).toBe('CAPTURED');
      expect(await h.bookingStatus(bookingId)).toBe('PAID');
      expect(await h.t09Count(bookingId)).toBe(1);
      expect(await statusOf('ooo-fail')).toMatchObject({
        processing_status: 'IGNORED',
        error: 'OUT_OF_ORDER',
      });
    });

    it('does not run T-09 if the engine would be asked without a captured order (the guard)', async () => {
      const { bookingId, orderId } = await pending();
      const move = (input?: Record<string, unknown>) =>
        h.as(h.callers.system('PAYMENTS'), (tx) =>
          h.engine().transition(tx, {
            bookingId,
            transitionId: 'T-09',
            actor: { kind: 'SYSTEM', source: 'PAYMENTS' },
            ...(input ? { input } : {}),
          }),
        );
      const refused = await move().catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(BookingError);
      expect((refused as BookingError).code).toBe('PAYMENT_AMOUNT_MISMATCH');
      // Naming an order that is still PENDING is no better.
      const pendingOrder = await move({ paymentOrderId: orderId }).catch((e: unknown) => e);
      expect((pendingOrder as BookingError).code).toBe('PAYMENT_AMOUNT_MISMATCH');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      // Only the SYSTEM source PAYMENTS may run it.
      const other = await h
        .as(h.callers.system('EC-01'), (tx) =>
          h.engine().transition(tx, {
            bookingId,
            transitionId: 'T-09',
            actor: { kind: 'SYSTEM', source: 'EC-01' },
            input: { paymentOrderId: orderId },
          }),
        )
        .catch((e: unknown) => e);
      expect((other as BookingError).code).toBe('FORBIDDEN');
    });
  });

  describe('failures and expiries', () => {
    it('a failure event fails the attempt and leaves the booking alone', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.failPayment(ref, { eventId: 'fail-1' }));
      expect((await h.orderRow(orderId))?.status).toBe('FAILED');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      expect(await h.t09Count(bookingId)).toBe(0);
      expect(await statusOf('fail-1')).toMatchObject({ processing_status: 'PROCESSED' });
      // The customer can try again.
      const retry = await h.startPayment(bookingId);
      expect(retry.created.attempt.attemptNo).toBe(2);
    });

    it('an expiry event expires the attempt and leaves the booking alone', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.expirePayment(ref, { eventId: 'exp-1' }));
      expect((await h.orderRow(orderId))?.status).toBe('EXPIRED');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
    });

    it('a failure for something we do not know is ignored: no money moved', async () => {
      const note = h.gateway.buildNotification({
        type: 'PAYMENT_FAILED',
        merchantReference: '0192a000-0000-7000-8000-00000000dead',
        amountPaise: 5n,
        eventId: 'fail-unknown',
      });
      await run(note);
      expect(await statusOf('fail-unknown')).toMatchObject({
        processing_status: 'IGNORED',
        error: 'UNKNOWN_REFERENCE',
      });
    });
  });

  describe('the exception path', () => {
    it('an amount mismatch moves nothing, is recorded as a transaction fact and goes to Finance', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.completePayment(ref, { eventId: 'mm-1', amountPaise: 117_999n }));
      expect((await h.orderRow(orderId))?.status).toBe('PENDING');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      expect(await h.t09Count(bookingId)).toBe(0);
      const row = await statusOf('mm-1');
      expect(row).toMatchObject({ processing_status: 'FAILED', error: 'PAYMENT_AMOUNT_MISMATCH' });
      expect((await raised(row?.id ?? ''))[0]?.payload.data).toMatchObject({
        code: 'PAYMENT_AMOUNT_MISMATCH',
        paymentOrderId: orderId,
        bookingId,
        recommendedAction: 'REFUND_FULL',
      });
      expect(await h.transactions(orderId)).toEqual([
        expect.objectContaining({
          amount_paise: '117999',
          is_duplicate: false,
          raw_summary: expect.objectContaining({
            outcome: 'AMOUNT_MISMATCH',
            expectedAmountPaise: '118000',
          }) as unknown,
        }),
      ]);
      expect(
        await h.rows(
          `SELECT 1 FROM audit_log WHERE action = 'payment.exception' AND entity_id = $1`,
          [row?.id],
        ),
      ).toHaveLength(1);
      // Never refunded here.
      expect(
        await h.rows('SELECT 1 FROM refund WHERE payment_order_id = $1', [orderId]),
      ).toHaveLength(0);
    });

    it('a failed row is not retried by the worker', async () => {
      const { ref } = await pending();
      await run(h.gateway.completePayment(ref, { eventId: 'mm-2', amountPaise: 1n }));
      const again = await h.processAll();
      expect(again.exceptions).toBe(0);
      expect(await statusOf('mm-2')).toMatchObject({ processing_status: 'FAILED' });
    });

    it('an amount of zero is an exception and writes no transaction', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.completePayment(ref, { eventId: 'mm-zero', amountPaise: 0n }));
      expect(await statusOf('mm-zero')).toMatchObject({ error: 'PAYMENT_AMOUNT_MISMATCH' });
      expect(await h.transactions(orderId)).toHaveLength(0);
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
    });

    it('an amount above the total is a mismatch too', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.completePayment(ref, { eventId: 'mm-over', amountPaise: 118_001n }));
      expect(await statusOf('mm-over')).toMatchObject({ error: 'PAYMENT_AMOUNT_MISMATCH' });
      expect((await h.orderRow(orderId))?.status).toBe('PENDING');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
    });

    it('another currency is an exception and is never recorded as paise', async () => {
      const { bookingId, orderId } = await pending();
      await run(
        h.gateway.buildNotification({
          type: 'PAYMENT_CAPTURED',
          merchantReference: orderId,
          amountPaise: 118_000n,
          currency: 'USD',
          eventId: 'cur-1',
        }),
      );
      expect(await statusOf('cur-1')).toMatchObject({
        processing_status: 'FAILED',
        error: 'CURRENCY_MISMATCH',
      });
      expect(await h.transactions(orderId)).toHaveLength(0);
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      expect((await h.orderRow(orderId))?.status).toBe('PENDING');
    });

    it('an unknown reference is an exception, with nothing attached to any booking', async () => {
      const note = h.gateway.buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: '0192a000-0000-7000-8000-00000000beef',
        amountPaise: 118_000n,
        eventId: 'unk-1',
      });
      await run(note);
      const row = await statusOf('unk-1');
      expect(row).toMatchObject({ processing_status: 'FAILED', error: 'UNKNOWN_REFERENCE' });
      expect((await raised(row?.id ?? ''))[0]?.payload.data).toMatchObject({
        code: 'UNKNOWN_REFERENCE',
        recommendedAction: 'REVIEW',
      });
      const garbage = h.gateway.buildNotification({
        type: 'PAYMENT_CAPTURED',
        merchantReference: "'; DROP TABLE booking; --",
        amountPaise: 1n,
        eventId: 'unk-2',
      });
      await run(garbage);
      expect(await statusOf('unk-2')).toMatchObject({ error: 'UNKNOWN_REFERENCE' });
    });

    it('a reference that exists but belongs to no order of this gateway is unknown', async () => {
      // A booking id is not a payment order id.
      const bookingId = await h.acceptedBooking();
      await run(
        h.gateway.buildNotification({
          type: 'PAYMENT_CAPTURED',
          merchantReference: bookingId,
          amountPaise: 118_000n,
          eventId: 'unk-3',
        }),
      );
      expect(await statusOf('unk-3')).toMatchObject({ error: 'UNKNOWN_REFERENCE' });
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
    });

    it('a second capture on the booking is a duplicate: recorded, flagged, the booking not moved twice', async () => {
      const bookingId = await h.acceptedBooking();
      const first = await h.startPayment(bookingId);
      const second = await h.startPayment(bookingId);
      const refOf = (id: string) => h.gateway.orderRefFor(id) ?? '';
      await run(h.gateway.completePayment(refOf(first.orderId), { eventId: 'dc-1' }));
      await run(h.gateway.completePayment(refOf(second.orderId), { eventId: 'dc-2' }));
      expect(await h.t09Count(bookingId)).toBe(1);
      expect((await h.orderRow(first.orderId))?.status).toBe('CAPTURED');
      expect((await h.orderRow(second.orderId))?.status).toBe('PENDING');
      expect(await statusOf('dc-2')).toMatchObject({
        processing_status: 'FAILED',
        error: 'DUPLICATE_CAPTURE',
      });
      expect(await h.transactions(second.orderId)).toEqual([
        expect.objectContaining({ is_duplicate: true, amount_paise: '118000' }),
      ]);
      const [row] = await h.eventRows(`WHERE event_id = 'dc-2'`);
      expect((await raised(row?.id ?? ''))[0]?.payload.data).toMatchObject({
        recommendedAction: 'REFUND_FULL',
      });
      // A second capture on the already captured order, with another payment reference, is the same.
      await run(
        h.gateway.buildNotification({
          type: 'PAYMENT_CAPTURED',
          merchantReference: first.orderId,
          amountPaise: 118_000n,
          eventId: 'dc-3',
          paymentRef: 'fake_pay_other',
        }),
      );
      expect(await statusOf('dc-3')).toMatchObject({ error: 'DUPLICATE_CAPTURE' });
      expect(await h.t09Count(bookingId)).toBe(1);
    });

    it('a capture after the booking expired unpaid is recorded and handed to Finance, the booking untouched', async () => {
      const { bookingId, orderId, ref } = await pending();
      // The window closes and the booking expires (T-10), the attempt still PENDING at the gateway.
      await h.as(h.callers.system(), (tx) =>
        h.engine().transition(tx, { bookingId, transitionId: 'T-10', actor: { kind: 'SYSTEM' } }),
      );
      expect(await h.bookingStatus(bookingId)).toBe('EXPIRED_UNPAID');
      await run(h.gateway.completePayment(ref, { eventId: 'late-1' }));
      expect(await h.bookingStatus(bookingId)).toBe('EXPIRED_UNPAID');
      expect(await h.t09Count(bookingId)).toBe(0);
      const row = await statusOf('late-1');
      expect(row).toMatchObject({ processing_status: 'FAILED', error: 'LATE_CAPTURE' });
      expect((await raised(row?.id ?? ''))[0]?.payload.data).toMatchObject({
        code: 'LATE_CAPTURE',
        recommendedAction: 'REFUND_FULL',
        paymentOrderId: orderId,
      });
      // The money is a fact: the attempt is captured and refundable, and nothing refunded it here.
      expect((await h.orderRow(orderId))?.status).toBe('CAPTURED');
      expect(await h.transactions(orderId)).toEqual([
        expect.objectContaining({
          is_duplicate: false,
          raw_summary: { outcome: 'LATE_CAPTURE', currency: 'INR' },
        }),
      ]);
      expect(
        await h.rows('SELECT 1 FROM refund WHERE payment_order_id = $1', [orderId]),
      ).toHaveLength(0);
    });

    it('a capture reported for an attempt we already failed is an exception, not a payment', async () => {
      const { bookingId, orderId, ref } = await pending();
      await run(h.gateway.failPayment(ref, { eventId: 'cl-fail' }));
      await run(h.gateway.completePayment(ref, { eventId: 'cl-cap' }));
      expect((await h.orderRow(orderId))?.status).toBe('FAILED');
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      expect(await statusOf('cl-cap')).toMatchObject({
        processing_status: 'FAILED',
        error: 'CAPTURE_ON_CLOSED_ORDER',
      });
    });

    it('an unreadable stored body is an exception and does not stop the others', async () => {
      const { bookingId, ref } = await pending();
      await h.deliver(h.gateway.completePayment(ref, { eventId: 'unr-1' }));
      // Corrupt the stored ciphertext as the owner would never do; processing must not trust it.
      await h
        .db()
        .query(
          `UPDATE gateway_webhook_event SET payload_ciphertext = '\\x00' WHERE event_id = 'unr-1'`,
        );
      const next = await pending();
      await h.deliver(h.gateway.completePayment(next.ref, { eventId: 'unr-2' }));
      await h.processAll();
      expect(await statusOf('unr-1')).toMatchObject({
        processing_status: 'FAILED',
        error: 'PAYLOAD_UNREADABLE',
      });
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      expect(await h.bookingStatus(next.bookingId)).toBe('PAID');
    });

    it('leaves a notification RECEIVED, to be retried, when the booking engine refuses (a frozen booking)', async () => {
      const { bookingId, orderId, ref } = await pending();
      await h
        .db()
        .query(`UPDATE booking SET frozen_at = now(), frozen_reason = 'test' WHERE id = $1`, [
          bookingId,
        ]);
      await h.deliver(h.gateway.completePayment(ref, { eventId: 'frozen-1' }));
      const first = await h.processAll();
      expect(first.retried).toBeGreaterThanOrEqual(1);
      // Everything rolled back: the order is not captured and nothing is recorded.
      expect((await h.orderRow(orderId))?.status).toBe('PENDING');
      expect(await h.transactions(orderId)).toHaveLength(0);
      expect(await statusOf('frozen-1')).toMatchObject({ processing_status: 'RECEIVED' });
      await h
        .db()
        .query(`UPDATE booking SET frozen_at = NULL, frozen_reason = NULL WHERE id = $1`, [
          bookingId,
        ]);
      await h.processAll();
      expect(await h.bookingStatus(bookingId)).toBe('PAID');
      expect(await h.t09Count(bookingId)).toBe(1);
    });
  });

  describe('isolation', () => {
    it('one organisation cannot read the transactions or attempts of another', async () => {
      const { orderId, ref } = await pending();
      await run(h.gateway.completePayment(ref, { eventId: 'iso-1' }));
      const asOther = {
        context: h.contexts.otherCustomer(),
        actor: h.callers.customerAdmin().actor,
      };
      const seen = await h.as(asOther, (tx) =>
        Promise.all([
          tx.$queryRaw<unknown[]>`SELECT 1 FROM payment_order WHERE id = ${orderId}::uuid`,
          tx.$queryRaw<
            unknown[]
          >`SELECT 1 FROM payment_transaction WHERE payment_order_id = ${orderId}::uuid`,
        ]),
      );
      expect(seen.map((rows) => rows.length)).toEqual([0, 0]);
      // Gateway notifications are readable only in the system and platform contexts.
      const events = await h.as(
        h.callers.customerAdmin(),
        (tx) => tx.$queryRaw<unknown[]>`SELECT 1 FROM gateway_webhook_event`,
      );
      expect(events).toHaveLength(0);
    });
  });

  it('exceptionsOf finds what Finance has to look at', async () => {
    const { orderId, ref } = await pending();
    await run(h.gateway.completePayment(ref, { eventId: 'fin-1', amountPaise: 2n }));
    expect(await exceptionsOf(orderId)).toEqual([
      { error: 'PAYMENT_AMOUNT_MISMATCH', processing_status: 'FAILED' },
    ]);
  });
});
