import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TimerType } from '@labconnect/database';
import { insert } from '../../../database/test/db/helpers.js';
import {
  BookingNotificationContext,
  consumeNotificationsQueue,
  createBookingTimerHandlers,
  createHasPendingPayment,
  type EventEnvelope,
  InMemoryEmailSender,
  InMemoryQueueConsumer,
  InMemoryQueuePublisher,
  QUEUES,
  registerBookingTimerHandlers,
  relayOutbox,
  runDueTimers,
  runEmailDeliveries,
  TimerHandlerRegistry,
} from '../../src/index.js';
import { type Caller, NOW } from './booking-support.js';
import { HOUR, usePaymentsHarness } from './payments-support.js';

// P3 wiring: the booking engine, the timer handlers, the outbox relay, the notifications
// consumer with the booking adapter and the email delivery pass, on a real PostgreSQL and the
// in-memory queue and email fakes (no AWS). The pieces are put together here the way the worker
// module puts them together (apps/worker/src/modules/booking and notifications).

const MINUTE = 60_000;
const WEB = 'https://app.labconnect.test';
/** Text that must never leave the booking: it is in the item name and the lab snapshot. */
const CANARY = 'CANARY-4711';

describe('the booking flow through the worker pieces', () => {
  const h = usePaymentsHarness();
  const { as, callers } = h;
  let counter = 0;

  /** Users beyond the booking world, to show that nobody else is told. */
  const extra = { unassignedChecker: '', customerColleague: '' };

  const person = async (email: string, orgId: string, role: string): Promise<string> => {
    const db = h.db();
    const userId = await insert(db, 'app_user', {
      email,
      full_name: email.split('@')[0],
      status: 'ACTIVE',
    });
    const membership = await insert(db, 'membership', {
      user_id: userId,
      organisation_id: orgId,
      status: 'ACTIVE',
    });
    await insert(db, 'membership_role', { membership_id: membership, role });
    return userId;
  };

  beforeAll(async () => {
    const w = h.world();
    // Makers and Checkers are site-bound: the fixture lab's two people work at its site.
    for (const membershipId of [w.memberships.maker, w.memberships.checker]) {
      await insert(h.db(), 'membership_site', {
        membership_id: membershipId,
        lab_site_id: w.lab.site,
      });
    }
    extra.unassignedChecker = await person(
      'unassigned.checker@example.test',
      w.orgs.lab,
      'LAB_CHECKER',
    );
    extra.customerColleague = await person(
      'colleague.admin@example.test',
      w.orgs.customer,
      'CUSTOMER_ADMIN',
    );
  });

  // ---- the pieces, wired like the worker wires them
  const engine = () => h.engine(h.registry());
  const timerHandlers = (options: { withHandlers?: boolean; withPaymentCheck?: boolean } = {}) => {
    const registry = new TimerHandlerRegistry();
    if (options.withHandlers === false) return registry;
    registerBookingTimerHandlers(
      registry,
      createBookingTimerHandlers({
        engine: engine(),
        outbox: h.services.outbox,
        ...(options.withPaymentCheck === false
          ? {}
          : {
              hasPendingPayment: createHasPendingPayment({
                clock: h.clock,
                timers: h.services.timers,
              }),
            }),
      }),
    );
    return registry;
  };
  const runTimers = (registry = timerHandlers()) => runDueTimers(h.worker(), h.clock, registry);

  const consumer = new InMemoryQueueConsumer();
  const sender = new InMemoryEmailSender();

  /** Relay the outbox, hand the notification events to the consumer, run it dry. */
  const pump = async (): Promise<EventEnvelope[]> => {
    const publisher = new InMemoryQueuePublisher();
    await relayOutbox(h.worker(), publisher, h.clock, { batchSize: 200 });
    const envelopes: EventEnvelope[] = [];
    for (const message of publisher.published) {
      if (message.queue !== QUEUES.notifications) continue;
      envelopes.push(message.envelope);
      consumer.send(QUEUES.notifications, JSON.stringify(message.envelope));
    }
    const deps = {
      prisma: h.worker(),
      clock: h.clock,
      context: new BookingNotificationContext(h.worker()),
    };
    for (;;) {
      const result = await consumeNotificationsQueue(consumer, deps, { maxMessages: 10 });
      if (result.received === 0) break;
      expect(result.failed).toBe(0);
    }
    return envelopes;
  };
  const deliverEmails = () =>
    runEmailDeliveries(
      { prisma: h.worker(), clock: h.clock, sender, webBaseUrl: WEB },
      { batchSize: 100 },
    );

  // ---- facts
  const submit = async (): Promise<string> => {
    h.clock.set(NOW);
    counter += 1;
    const w = h.world();
    const customer = callers.customerAdmin();
    const submitted = await as(customer, (tx) =>
      engine().submit(tx, {
        actor: customer.actor,
        booking: {
          bookingNo: `LC-2611-8${String(counter).padStart(4, '0')}`,
          customerOrgId: w.orgs.customer,
          requesterUserId: w.users.customerAdmin,
          labSiteId: w.lab.site,
          labOrgId: w.lab.org,
          itemName: `${CANARY} cement`,
          declaredPackageCount: 1,
          preferredDropDate: new Date('2026-12-01T00:00:00Z'),
          priceListId: w.lab.priceList,
          subtotalPaise: 100_000n,
          gstPaise: 18_000n,
          totalPaise: 118_000n,
          labSnapshot: { labName: 'DEMO Lab One', siteName: 'DEMO Site', address: CANARY },
        },
      }),
    );
    return submitted.bookingId;
  };
  const move = (
    caller: Caller,
    bookingId: string,
    transitionId: 'T-03',
    input: Record<string, unknown> = {},
  ) =>
    as(caller, (tx) =>
      engine().transition(tx, { bookingId, transitionId, actor: caller.actor, input }),
    );
  const accepted = async (): Promise<string> => {
    const id = await submit();
    h.clock.advance(5 * MINUTE);
    await move(callers.checker(), id, 'T-03');
    return id;
  };

  const timersOf = (bookingId: string) =>
    h.rows<{ timer_type: TimerType; status: string; due_at: Date }>(
      'SELECT timer_type::text AS timer_type, status::text AS status, due_at FROM timer WHERE aggregate_id = $1 ORDER BY due_at, timer_type',
      [bookingId],
    );
  const timerStatus = async (bookingId: string) =>
    (await timersOf(bookingId)).map((t) => `${t.timer_type}:${t.status}`);
  const eventTypes = async (bookingId: string) =>
    (
      await h.rows<{ event_type: string }>(
        'SELECT event_type FROM outbox_event WHERE aggregate_id = $1 ORDER BY occurred_at, id',
        [bookingId],
      )
    ).map((row) => row.event_type);

  type Notified = {
    event_type: string;
    recipient_user_id: string;
    organisation_id: string;
    channel: string;
    status: string;
  };
  const notified = (bookingId: string, type?: string) =>
    h.rows<Notified>(
      `SELECT o.event_type, n.recipient_user_id::text AS recipient_user_id,
              n.organisation_id::text AS organisation_id, n.channel::text AS channel,
              n.status::text AS status
         FROM notification n JOIN outbox_event o ON o.id = n.event_id
        WHERE o.aggregate_id = $1 AND ($2::text IS NULL OR o.event_type = $2)
        ORDER BY o.event_type, n.recipient_user_id, n.channel`,
      [bookingId, type ?? null],
    );
  const people = (rows: Notified[]) =>
    rows
      .map((row) => `${row.recipient_user_id}@${row.organisation_id}:${row.channel}:${row.status}`)
      .sort();

  // ---- logs
  const captured: string[] = [];
  const capture = () => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      });
    }
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    });
  };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request, accept, notify, send, then let the payment window lapse', () => {
    it('notifies the right people only, sends each email once, and the timers expire the booking', async () => {
      capture();
      const w = h.world();
      const id = await accepted();

      // The engine scheduled the payment timers (T-03).
      expect(await timerStatus(id)).toEqual(['PAYMENT_REMINDER:PENDING', 'PAYMENT_DUE:PENDING']);

      await pump();
      expect(await eventTypes(id)).toEqual(['booking.requested', 'booking.accepted']);

      const customer = `${w.users.customerAdmin}@${w.orgs.customer}`;
      expect(people(await notified(id, 'booking.requested'))).toEqual(
        [
          `${customer}:IN_APP:SENT`,
          `${customer}:EMAIL:QUEUED`,
          `${w.users.maker}@${w.orgs.lab}:IN_APP:SENT`,
          `${w.users.checker}@${w.orgs.lab}:IN_APP:SENT`,
          `${w.users.checker}@${w.orgs.lab}:EMAIL:QUEUED`,
        ].sort(),
      );
      expect(people(await notified(id, 'booking.accepted'))).toEqual(
        [`${customer}:IN_APP:SENT`, `${customer}:EMAIL:QUEUED`].sort(),
      );
      // Nobody else of any organisation: not the other lab's or customer's people, not the
      // customer's colleague, not a Checker of the lab at no site, not platform staff.
      const everyone = new Set((await notified(id)).map((row) => row.recipient_user_id));
      expect([...everyone].sort()).toEqual(
        [w.users.customerAdmin, w.users.maker, w.users.checker].sort(),
      );
      for (const outsider of [
        w.users.otherChecker,
        w.users.otherCustomerAdmin,
        w.users.ops,
        w.users.admin,
        extra.unassignedChecker,
        extra.customerColleague,
      ]) {
        expect(everyone.has(outsider)).toBe(false);
      }

      // The delivery pass sends each queued email once.
      const first = await deliverEmails();
      expect(first.sent).toBe(3);
      expect(sender.sent).toHaveLength(3);
      const second = await deliverEmails();
      expect(second.sent).toBe(0);
      expect(sender.sent).toHaveLength(3);
      expect(sender.sent.map((message) => message.to).sort()).toEqual([
        'checker@example.test',
        'customer.admin@example.test',
        'customer.admin@example.test',
      ]);

      // A timer the booking no longer needs is cancelled by the expiry.
      await as(callers.system(), (tx) =>
        h.services.timers.schedule(tx, {
          type: 'LAB_DECISION_REMINDER_50',
          aggregate: { type: 'booking', id },
          dueAt: new Date(h.clock.now().getTime() + 30 * HOUR),
        }),
      );

      // 25 hours later: the reminder (22 h) and then the due timer (24 h) fire.
      h.clock.advance(25 * HOUR);
      const fired = await runTimers();
      expect(fired).toMatchObject({ fired: 2, retried: 0, failed: 0 });
      expect(await h.bookingStatus(id)).toBe('EXPIRED_UNPAID');
      expect(await timerStatus(id)).toEqual(
        expect.arrayContaining([
          'PAYMENT_REMINDER:FIRED',
          'PAYMENT_DUE:FIRED',
          'LAB_DECISION_REMINDER_50:CANCELLED',
        ]),
      );
      expect((await timerStatus(id)).some((entry) => entry.endsWith(':PENDING'))).toBe(false);
      expect(await eventTypes(id)).toEqual([
        'booking.requested',
        'booking.accepted',
        'payment.window_ending',
        'payment.expired',
      ]);

      // Those events are notified too.
      await pump();
      expect(people(await notified(id, 'payment.window_ending'))).toEqual(
        [`${customer}:IN_APP:SENT`, `${customer}:EMAIL:QUEUED`].sort(),
      );
      expect(people(await notified(id, 'payment.expired'))).toEqual(
        [
          `${customer}:IN_APP:SENT`,
          `${customer}:EMAIL:QUEUED`,
          `${w.users.checker}@${w.orgs.lab}:IN_APP:SENT`,
        ].sort(),
      );
      expect((await deliverEmails()).sent).toBe(2);
      expect(sender.sent).toHaveLength(5);
      expect((await deliverEmails()).sent).toBe(0);

      // No personal data and nothing of the booking's content in what was logged, in any event
      // payload, notification payload or email.
      const emails = ['@example.test', 'customer.admin', 'checker@'];
      const everything = [
        ...captured,
        ...(await h.rows<{ p: string }>('SELECT payload::text AS p FROM outbox_event')).map(
          (row) => row.p,
        ),
        ...(await h.rows<{ p: string }>('SELECT payload::text AS p FROM notification')).map(
          (row) => row.p,
        ),
        ...sender.sent.flatMap((message) => [message.subject, message.text, message.html ?? '']),
      ].join('\n');
      expect(everything).not.toContain(CANARY);
      const withoutAddresses = [
        ...captured,
        ...(await h.rows<{ p: string }>('SELECT payload::text AS p FROM outbox_event')).map(
          (row) => row.p,
        ),
        ...(await h.rows<{ p: string }>('SELECT payload::text AS p FROM notification')).map(
          (row) => row.p,
        ),
      ].join('\n');
      for (const fragment of emails) expect(withoutAddresses).not.toContain(fragment);
    });
  });

  describe('a pending payment at the end of the window (BR-032, OQ-100)', () => {
    it('reschedules PAYMENT_DUE instead of expiring, and expires when the reconcile window ends', async () => {
      const id = await accepted();
      const { orderId } = await h.startPayment(id);
      const order = (
        await h.rows<{ reconcile_until: Date }>(
          'SELECT reconcile_until FROM payment_order WHERE id = $1',
          [orderId],
        )
      )[0];
      const reconcileUntil = order?.reconcile_until;
      expect(reconcileUntil).toBeDefined();

      // Just after the window: the order is PENDING and inside its reconcile window.
      h.clock.advance(24 * HOUR + 10 * MINUTE);
      const result = await runTimers();
      expect(result).toMatchObject({ retried: 0, failed: 0 });
      expect(await h.bookingStatus(id)).toBe('ACCEPTED');
      const due = (await timersOf(id)).filter((t) => t.timer_type === 'PAYMENT_DUE');
      expect(due.map((t) => t.status).sort()).toEqual(['FIRED', 'PENDING']);
      expect(due.find((t) => t.status === 'PENDING')?.due_at.toISOString()).toBe(
        reconcileUntil?.toISOString(),
      );
      expect(await eventTypes(id)).not.toContain('payment.expired');

      // Past the reconcile window with no capture: the booking expires (T-10).
      h.clock.set(new Date((reconcileUntil?.getTime() ?? 0) + MINUTE));
      await runTimers();
      expect(await h.bookingStatus(id)).toBe('EXPIRED_UNPAID');
      expect(await eventTypes(id)).toContain('payment.expired');
    });

    it('without the payments check the PAYMENT_DUE timer is left alone (OQ-100)', async () => {
      const id = await accepted();
      h.clock.advance(25 * HOUR);
      const result = await runTimers(timerHandlers({ withPaymentCheck: false }));
      expect(await h.bookingStatus(id)).toBe('ACCEPTED');
      expect(result.unhandled.PAYMENT_DUE).toBeGreaterThanOrEqual(1);
    });
  });

  describe('a captured payment', () => {
    it('moves the booking by T-09 through the fake gateway and cancels the payment timers', async () => {
      const id = await accepted();
      const { orderId } = await h.startPayment(id);
      const ref = h.gateway.orderRefFor(orderId) ?? '';
      await h.deliver(h.gateway.completePayment(ref, { eventId: `cap-${id}` }));
      await h.processAll();
      expect(await h.bookingStatus(id)).toBe('PAID');
      expect(await h.t09Count(id)).toBe(1);
      expect(await timerStatus(id)).toEqual(
        expect.arrayContaining(['PAYMENT_REMINDER:CANCELLED', 'PAYMENT_DUE:CANCELLED']),
      );

      // Long after the window nothing expires the booking: the timers are gone.
      h.clock.advance(48 * HOUR);
      const result = await runTimers();
      expect(await h.bookingStatus(id)).toBe('PAID');
      expect(result.unhandled).toEqual({});
    });
  });

  describe('the timers on a frozen booking (OQ-97)', () => {
    it('fail and are retried, they do not move the booking, and the failure holds no booking data', async () => {
      const id = await accepted();
      await h
        .db()
        .query(`UPDATE booking SET frozen_at = now(), frozen_reason = 'EC-01 test' WHERE id = $1`, [
          id,
        ]);
      h.clock.advance(25 * HOUR);
      const result = await runTimers();
      expect(result.retried).toBeGreaterThanOrEqual(1);
      expect(await h.bookingStatus(id)).toBe('ACCEPTED');
      const errors = await h.rows<{ last_error: string | null }>(
        `SELECT last_error FROM timer WHERE aggregate_id = $1 AND attempts > 0`,
        [id],
      );
      expect(errors.length).toBeGreaterThanOrEqual(1);
      for (const row of errors) expect(row.last_error ?? '').not.toContain(CANARY);
    });
  });

  describe('BookingNotificationContext', () => {
    it('takes the parties from the booking row, and gives no context for an unknown or foreign subject', async () => {
      const w = h.world();
      const id = await submit();
      const context = new BookingNotificationContext(h.worker());
      const envelope = (
        type: string,
        aggregateType: string,
        aggregateId: string,
      ): EventEnvelope => ({
        id: '00000000-0000-7000-8000-000000000001',
        type,
        version: 1,
        occurredAt: NOW,
        aggregate: { type: aggregateType, id: aggregateId },
        actor: 'SYSTEM',
        // Data that names someone else's organisation must not matter.
        data: { bookingId: id, customerOrgId: w.orgs.otherCustomer, labOrgId: w.orgs.otherLab },
      });
      const resolved = await context.resolve(envelope('booking.requested', 'booking', id));
      expect(resolved).toMatchObject({
        bookingId: id,
        labName: 'DEMO Lab One',
        customers: [{ organisationId: w.orgs.customer, userIds: [w.users.customerAdmin] }],
        lab: { organisationId: w.orgs.lab, siteId: w.lab.site },
      });
      expect(resolved?.bookingNo).toMatch(/^LC-2611-8/);
      expect(
        await context.resolve(
          envelope('booking.requested', 'booking', '00000000-0000-7000-8000-0000000000ff'),
        ),
      ).toBeNull();
      expect(await context.resolve(envelope('dispute.decided', 'dispute', id))).toBeNull();
    });
  });
});
