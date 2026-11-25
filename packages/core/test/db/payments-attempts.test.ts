import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CoreError, createHasPendingPayment, createBookingTimerHandlers } from '../../src/index.js';
import {
  runDueTimers,
  TimerHandlerRegistry,
  registerBookingTimerHandlers,
} from '../../src/index.js';
import { HOUR, usePaymentsHarness } from './payments-support.js';

// P3-09: starting a payment (the attempt row), under the real roles, RLS and triggers.

const code = (error: unknown): string | undefined =>
  error instanceof CoreError ? error.code : undefined;

describe('payment attempts', () => {
  const h = usePaymentsHarness();
  const { as, callers } = h;

  it('creates an attempt for exactly the booking total, in CREATED, then opens the checkout to PENDING', async () => {
    const bookingId = await h.acceptedBooking();
    const { created, opened } = await h.startPayment(bookingId);
    expect(created.reused).toBe(false);
    expect(created.attempt).toMatchObject({
      bookingId,
      attemptNo: 1,
      gateway: 'FAKE',
      status: 'CREATED',
      amountPaise: 118_000n,
    });
    expect(created.attempt.checkoutExpiresAt?.toISOString()).toBe('2026-11-26T10:00:00.000Z');
    expect(opened.kind).toBe('OPEN');
    if (opened.kind !== 'OPEN') return;
    expect(opened.attempt.status).toBe('PENDING');
    expect(opened.checkout).toMatchObject({
      fakeOrderRef: expect.stringMatching(/^fake_ord_/) as unknown,
    });
    const row = await h.orderRow(created.attempt.id);
    expect(row?.gateway_order_ref).toMatch(/^fake_ord_/);
    expect(row?.amount_paise).toBe('118000');
    // The reconciliation window is the payment window plus 2 hours (BR-032).
    const [order] = await h.rows<{ reconcile_until: Date }>(
      'SELECT reconcile_until FROM payment_order WHERE id = $1',
      [created.attempt.id],
    );
    expect(order?.reconcile_until.toISOString()).toBe('2026-11-26T12:00:00.000Z');
    // Booking untouched: only a verified capture moves it.
    expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
  });

  it('numbers attempts per booking and returns the same attempt for the same key', async () => {
    const bookingId = await h.acceptedBooking();
    const key = randomUUID();
    const first = await h.startPayment(bookingId, key);
    const again = await as(h.customer(), (tx) =>
      h.service.createAttempt(tx, {
        bookingId,
        idempotencyKey: key,
        initiatedByUserId: h.customerUserId(),
      }),
    );
    expect(again.reused).toBe(true);
    expect(again.attempt.id).toBe(first.orderId);
    const second = await h.startPayment(bookingId);
    expect(second.created.attempt.attemptNo).toBe(2);
    const [count] = await h.rows<{ n: string }>(
      'SELECT count(*) AS n FROM payment_order WHERE booking_id = $1',
      [bookingId],
    );
    expect(count?.n).toBe('2');
  });

  it('refuses a key used for another booking, and a key of another organisation', async () => {
    const a = await h.acceptedBooking();
    const b = await h.acceptedBooking();
    const key = randomUUID();
    await h.startPayment(a, key);
    const reuse = await as(h.customer(), (tx) =>
      h.service.createAttempt(tx, {
        bookingId: b,
        idempotencyKey: key,
        initiatedByUserId: h.customerUserId(),
      }),
    ).catch((error: unknown) => error);
    expect(code(reuse)).toBe('IDEMPOTENCY_KEY_REUSED');

    // The other customer organisation cannot see the booking at all (NOT_FOUND), and a key
    // that collides with an attempt it cannot see is refused without revealing it.
    const other = callers.colleague('CUSTOMER_ADMIN');
    const otherCustomer = { context: h.contexts.otherCustomer(), actor: other.actor };
    const stranger = await as(otherCustomer, (tx) =>
      h.service.createAttempt(tx, {
        bookingId: a,
        idempotencyKey: randomUUID(),
        initiatedByUserId: h.world().users.otherCustomerAdmin,
      }),
    ).catch((error: unknown) => error);
    expect(code(stranger)).toBe('NOT_FOUND');
  });

  it('is refused for the lab (not found), platform staff, the system and a user that is not the caller', async () => {
    const bookingId = await h.acceptedBooking();
    const attempt = (caller: Parameters<typeof as>[0], userId: string) =>
      as(caller, (tx) =>
        h.service.createAttempt(tx, {
          bookingId,
          idempotencyKey: randomUUID(),
          initiatedByUserId: userId,
        }),
      ).catch((error: unknown) => error);
    // The lab sees the booking but is not its customer: not found, never a way to pay.
    expect(code(await attempt(callers.checker(), h.world().users.checker))).toBe('NOT_FOUND');
    expect(code(await attempt(callers.ops(), h.world().users.ops))).toBe('FORBIDDEN');
    expect(code(await attempt(callers.system(), h.world().users.customerAdmin))).toBe('FORBIDDEN');
    // A claimed user that is not the context's user.
    expect(code(await attempt(callers.customerAdmin(), h.world().users.checker))).toBe('FORBIDDEN');
    const [none] = await h.rows<{ n: string }>(
      'SELECT count(*) AS n FROM payment_order WHERE booking_id = $1',
      [bookingId],
    );
    expect(none?.n).toBe('0');
  });

  it.each(['REQUESTED', 'PAID', 'EXPIRED_UNPAID', 'CANCELLED'] as const)(
    'is refused while the booking is %s, naming the current state',
    async (status) => {
      const bookingId = await h.placeBooking(status);
      const error = await as(h.customer(), (tx) =>
        h.service.createAttempt(tx, {
          bookingId,
          idempotencyKey: randomUUID(),
          initiatedByUserId: h.customerUserId(),
        }),
      ).catch((e: unknown) => e);
      expect(code(error)).toBe('INVALID_STATE_TRANSITION');
      expect((error as CoreError).meta).toEqual({ currentState: status });
    },
  );

  it('is refused after the payment window has closed', async () => {
    const bookingId = await h.acceptedBooking(-HOUR);
    const error = await as(h.customer(), (tx) =>
      h.service.createAttempt(tx, {
        bookingId,
        idempotencyKey: randomUUID(),
        initiatedByUserId: h.customerUserId(),
      }),
    ).catch((e: unknown) => e);
    expect(code(error)).toBe('INVALID_STATE_TRANSITION');
  });

  it('marks the attempt FAILED and does not throw when the gateway is unavailable', async () => {
    const bookingId = await h.acceptedBooking();
    h.gateway.failNextCreateOrder();
    const { opened, orderId } = await h.startPayment(bookingId);
    expect(opened.kind).toBe('UNAVAILABLE');
    expect((await h.orderRow(orderId))?.status).toBe('FAILED');
    // A new attempt is allowed and gets the next number.
    const retry = await h.startPayment(bookingId);
    expect(retry.created.attempt.attemptNo).toBe(2);
    expect(retry.opened.kind).toBe('OPEN');
  });

  it('cannot open the same attempt twice, and an attempt is private to the paying organisation and its lab', async () => {
    const bookingId = await h.acceptedBooking();
    const { orderId } = await h.startPayment(bookingId);
    const again = await as(h.customer(), (tx) =>
      h.service.openCheckout(tx, {
        paymentOrderId: orderId,
        userId: h.customerUserId(),
        customer: { name: 'C', email: 'c@example.test' },
        returnUrl: 'https://app.example.test/payments/return',
      }),
    ).catch((e: unknown) => e);
    expect(code(again)).toBe('INVALID_STATE_TRANSITION');

    const visible = (caller: Parameters<typeof as>[0]) =>
      as(
        caller,
        (tx) =>
          tx.$queryRaw<
            { id: string }[]
          >`SELECT id::text AS id FROM payment_order WHERE id = ${orderId}::uuid`,
      );
    expect(await visible(callers.customerAdmin())).toHaveLength(1);
    expect(await visible(callers.checker())).toHaveLength(1);
    expect(
      await visible({ context: h.contexts.otherCustomer(), actor: callers.customerAdmin().actor }),
    ).toHaveLength(0);
    expect(
      await visible({ context: h.contexts.otherChecker(), actor: callers.checker().actor }),
    ).toHaveLength(0);
  });

  it('puts only the order id in the return URL it gives the gateway', async () => {
    const bookingId = await h.acceptedBooking();
    const { orderId } = await h.startPayment(bookingId);
    // The fake keeps no URL, so build it as the service does.
    const { buildReturnUrl } = await import('../../src/index.js');
    expect(buildReturnUrl('https://app.example.test/payments/return?x=1#frag', orderId)).toBe(
      `https://app.example.test/payments/return?orderRef=${orderId}`,
    );
    expect(() => buildReturnUrl('ftp://x.example.test/', orderId)).toThrow();
    expect(() => buildReturnUrl('https://user:pw@x.example.test/', orderId)).toThrow();
  });

  describe('hasPendingPayment (BR-032, OQ-100)', () => {
    const handlers = (
      hasPending = createHasPendingPayment({ clock: h.clock, timers: h.services.timers }),
    ) => {
      const registry = new TimerHandlerRegistry();
      registerBookingTimerHandlers(
        registry,
        createBookingTimerHandlers({
          engine: h.engine(),
          outbox: h.services.outbox,
          hasPendingPayment: hasPending,
        }),
      );
      return registry;
    };
    const scheduleDue = (bookingId: string, at: Date) =>
      as(callers.system(), (tx) =>
        h.services.timers.schedule(tx, {
          type: 'PAYMENT_DUE',
          aggregate: { type: 'booking', id: bookingId },
          dueAt: at,
        }),
      );
    const dueTimers = (bookingId: string) =>
      h.rows<{ status: string; due_at: Date }>(
        `SELECT status::text AS status, due_at FROM timer WHERE aggregate_id = $1 AND timer_type = 'PAYMENT_DUE' ORDER BY due_at`,
        [bookingId],
      );

    it('does not expire a booking with a pending attempt, extends the window, and expires it afterwards', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const bookingId = await h.acceptedBooking(HOUR);
      await h.startPayment(bookingId);
      await scheduleDue(bookingId, new Date('2026-11-25T11:00:00Z'));

      h.clock.set('2026-11-25T11:00:01Z'); // the window has ended, the attempt is still PENDING
      await runDueTimers(h.worker(), h.clock, handlers());
      expect(await h.bookingStatus(bookingId)).toBe('ACCEPTED');
      const timers = await dueTimers(bookingId);
      expect(timers.map((t) => t.status)).toEqual(['FIRED', 'PENDING']);
      expect(timers[1]?.due_at.toISOString()).toBe('2026-11-25T13:00:00.000Z'); // window + 2 h

      h.clock.set('2026-11-25T13:00:01Z'); // reconciliation window over
      await runDueTimers(h.worker(), h.clock, handlers());
      expect(await h.bookingStatus(bookingId)).toBe('EXPIRED_UNPAID');
      h.clock.set('2026-11-25T10:00:00Z');
    });

    it('expires a booking whose attempts are not pending (failed, or none)', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const none = await h.acceptedBooking(HOUR);
      const failed = await h.acceptedBooking(HOUR);
      h.gateway.failNextCreateOrder();
      await h.startPayment(failed);
      await scheduleDue(none, new Date('2026-11-25T11:00:00Z'));
      await scheduleDue(failed, new Date('2026-11-25T11:00:00Z'));
      h.clock.set('2026-11-25T11:00:01Z');
      await runDueTimers(h.worker(), h.clock, handlers());
      expect(await h.bookingStatus(none)).toBe('EXPIRED_UNPAID');
      expect(await h.bookingStatus(failed)).toBe('EXPIRED_UNPAID');
      h.clock.set('2026-11-25T10:00:00Z');
    });
  });
});
