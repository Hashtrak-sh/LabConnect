import { type DbContext, type TimerType, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  BusinessCalendarLoader,
  FixedClock,
  loadBusinessCalendar,
  loadPlatformHolidays,
  runDueTimers,
  TimerHandlerRegistry,
  TimerService,
  type DueTimer,
  type RunDueOptions,
  type TimerHandler,
} from '../../src/index.js';
import { gate, usePlatform, uuid } from './support.js';

// P3-02: timers, connected as the real roles (app_rw schedules and cancels, app_worker fires).

const NOW = '2026-11-25T10:00:00Z';
const system = { kind: 'system' } as const;

describe('timers', () => {
  const { api, worker, db } = usePlatform();
  const clock = new FixedClock(NOW);
  const timers = new TimerService(clock);
  const tenant = (): DbContext => ({ kind: 'tenant', orgId: uuid(), userId: uuid() });
  const minutes = (n: number): Date => new Date(new Date(NOW).getTime() + n * 60_000);

  const schedule = (
    type: TimerType,
    dueAt: Date,
    aggregateId: string = uuid(),
    payload?: Record<string, string>,
  ) =>
    withDbContext(api(), tenant(), (tx) =>
      timers.schedule(tx, {
        type,
        aggregate: { type: 'booking', id: aggregateId },
        dueAt,
        ...(payload ? { payload } : {}),
      }),
    );

  const row = async (id: string) =>
    (
      await db().query<{
        status: string;
        attempts: number;
        fired_at: Date | null;
        last_error: string | null;
        lock_version: number;
      }>('SELECT status, attempts, fired_at, last_error, lock_version FROM timer WHERE id = $1', [
        id,
      ])
    ).rows[0];

  const reset = async () => {
    await db().query('DELETE FROM timer');
    await db().query('DELETE FROM outbox_event');
    clock.set(NOW);
  };

  const run = (handlers: TimerHandlerRegistry, options?: RunDueOptions) =>
    runDueTimers(worker(), clock, handlers, options);

  const registry = (handler: TimerHandler, ...types: TimerType[]) => {
    const handlers = new TimerHandlerRegistry();
    for (const type of types) handlers.register(type, handler);
    return handlers;
  };

  describe('schedule and cancel as the API role', () => {
    it('inserts a PENDING timer that the API cannot read back', async () => {
      await reset();
      const aggregateId = uuid();
      const { id } = await schedule('LAB_DECISION_DUE', minutes(240), aggregateId, { a: 'b' });
      const stored = (
        await db().query<Record<string, unknown>>('SELECT * FROM timer WHERE id = $1', [id])
      ).rows[0];
      expect(stored).toMatchObject({
        timer_type: 'LAB_DECISION_DUE',
        aggregate_type: 'booking',
        aggregate_id: aggregateId,
        status: 'PENDING',
        attempts: 0,
        payload: { a: 'b' },
        fired_at: null,
      });
      expect(new Date(stored?.due_at as Date).toISOString()).toBe(minutes(240).toISOString());
      // Row-level security hides every timer from a tenant.
      expect(await withDbContext(api(), tenant(), (tx) => tx.timer.count())).toBe(0);
    });

    it('rolls the timer back with the caller transaction', async () => {
      await reset();
      const aggregateId = uuid();
      await expect(
        withDbContext(api(), tenant(), async (tx) => {
          await timers.schedule(tx, {
            type: 'PAYMENT_DUE',
            aggregate: { type: 'booking', id: aggregateId },
            dueAt: minutes(5),
          });
          throw new Error('the booking change failed');
        }),
      ).rejects.toThrow('the booking change failed');
      const rows = await db().query('SELECT 1 FROM timer WHERE aggregate_id = $1', [aggregateId]);
      expect(rows.rowCount).toBe(0);
    });

    it('schedules after business time from the calendar', async () => {
      await reset();
      const calendar = new BusinessCalendar({
        3: [{ opensAtMinute: 540, closesAtMinute: 1080 }],
        4: [{ opensAtMinute: 540, closesAtMinute: 1080 }],
      });
      // 10:00 UTC is 15:30 IST on Wednesday: 150 minutes left today, then 90 on Thursday.
      const { id, dueAt } = await withDbContext(api(), tenant(), (tx) =>
        timers.scheduleAfterBusinessTime(tx, {
          type: 'LAB_DECISION_DUE',
          aggregate: { type: 'booking', id: uuid() },
          calendar,
          businessMinutes: 240,
        }),
      );
      expect(dueAt.toISOString()).toBe('2026-11-26T05:00:00.000Z'); // Thursday 10:30 IST
      const stored = (
        await db().query<{ due_at: Date }>('SELECT due_at FROM timer WHERE id = $1', [id])
      ).rows[0];
      expect(stored?.due_at.toISOString()).toBe(dueAt.toISOString());
    });

    it('cancels by id, once', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(5));
      expect(await withDbContext(api(), tenant(), (tx) => timers.cancel(tx, id))).toBe(true);
      expect(await withDbContext(api(), tenant(), (tx) => timers.cancel(tx, id))).toBe(false);
      expect(await withDbContext(api(), tenant(), (tx) => timers.cancel(tx, uuid()))).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'CANCELLED', lock_version: 1 });
    });

    it('cancels by aggregate and type, leaving the rest alone', async () => {
      await reset();
      const booking = uuid();
      const other = uuid();
      const a = await schedule('LAB_DECISION_REMINDER_50', minutes(60), booking);
      const b = await schedule('LAB_DECISION_REMINDER_90', minutes(120), booking);
      const c = await schedule('LAB_DECISION_DUE', minutes(240), booking);
      const d = await schedule('LAB_DECISION_DUE', minutes(240), other);
      const cancelled = await withDbContext(api(), tenant(), (tx) =>
        timers.cancelForAggregate(tx, { type: 'booking', id: booking }, [
          'LAB_DECISION_REMINDER_50',
          'LAB_DECISION_REMINDER_90',
        ]),
      );
      expect(cancelled).toBe(2);
      expect((await row(a.id))?.status).toBe('CANCELLED');
      expect((await row(b.id))?.status).toBe('CANCELLED');
      expect((await row(c.id))?.status).toBe('PENDING');
      expect((await row(d.id))?.status).toBe('PENDING');

      const rest = await withDbContext(api(), tenant(), (tx) =>
        timers.cancelForAggregate(tx, { type: 'booking', id: booking }),
      );
      expect(rest).toBe(1);
      expect((await row(c.id))?.status).toBe('CANCELLED');
      expect((await row(d.id))?.status).toBe('PENDING');
    });

    it('never cancels a timer that already fired or failed', async () => {
      await reset();
      const booking = uuid();
      const fired = await schedule('PAYMENT_DUE', minutes(-5), booking);
      await run(registry(() => Promise.resolve(), 'PAYMENT_DUE'));
      expect((await row(fired.id))?.status).toBe('FIRED');
      const cancelled = await withDbContext(api(), tenant(), (tx) =>
        timers.cancelForAggregate(tx, { type: 'booking', id: booking }),
      );
      expect(cancelled).toBe(0);
      expect(await withDbContext(api(), tenant(), (tx) => timers.cancel(tx, fired.id))).toBe(false);
      expect((await row(fired.id))?.status).toBe('FIRED');
    });

    it('cannot be bypassed: a direct UPDATE as the API changes nothing', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(5));
      const result = await withDbContext(api(), tenant(), (tx) =>
        tx.timer.updateMany({ data: { status: 'CANCELLED', dueAt: minutes(9999) } }),
      );
      expect(result.count).toBe(0);
      expect(await row(id)).toMatchObject({ status: 'PENDING' });
    });
  });

  describe('runDue as the worker', () => {
    it('fires only due timers, in due order, and leaves the others untouched', async () => {
      await reset();
      const late = await schedule('PAYMENT_DUE', minutes(-1));
      const early = await schedule('PAYMENT_DUE', minutes(-30));
      const exact = await schedule('PAYMENT_DUE', minutes(0));
      const future = await schedule('PAYMENT_DUE', minutes(1));
      const seen: string[] = [];
      const result = await run(
        registry((_tx, timer) => {
          seen.push(timer.id);
          return Promise.resolve();
        }, 'PAYMENT_DUE'),
      );
      expect(seen).toEqual([early.id, late.id, exact.id]);
      expect(result).toMatchObject({ fired: 3, retried: 0, failed: 0, unhandled: {} });
      for (const fired of [early, late, exact]) {
        const stored = await row(fired.id);
        expect(stored?.status).toBe('FIRED');
        expect(stored?.fired_at?.toISOString()).toBe(new Date(NOW).toISOString());
        expect(stored?.lock_version).toBe(1);
      }
      expect(await row(future.id)).toMatchObject({
        status: 'PENDING',
        fired_at: null,
        attempts: 0,
      });

      // Later, the future one is due and fires; the fired ones do not run again.
      clock.advance(120_000);
      seen.length = 0;
      await run(
        registry((_tx, timer) => {
          seen.push(timer.id);
          return Promise.resolve();
        }, 'PAYMENT_DUE'),
      );
      expect(seen).toEqual([future.id]);
    });

    it('hands the handler the timer, a transaction in the system context, and the clock', async () => {
      await reset();
      const aggregateId = uuid();
      const { id } = await schedule('DROP_DEADLINE', minutes(-1), aggregateId, { slot: 'x' });
      let received: DueTimer | undefined;
      let sawSystem: unknown;
      let sawClock: unknown;
      await run(
        registry(async (tx, timer, c) => {
          received = timer;
          sawClock = c;
          sawSystem = (
            await tx.$queryRaw<{ s: string }[]>`SELECT current_setting('app.is_system') AS s`
          )[0]?.s;
        }, 'DROP_DEADLINE'),
      );
      expect(received).toMatchObject({
        id,
        type: 'DROP_DEADLINE',
        aggregate: { type: 'booking', id: aggregateId },
        attempts: 0,
        payload: { slot: 'x' },
      });
      expect(sawSystem).toBe('true');
      expect(sawClock).toBe(clock);
    });

    it('commits the handler writes together with FIRED', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(-1));
      await run(
        registry(async (tx) => {
          await tx.outboxEvent.createMany({
            data: [
              {
                id: uuid(),
                aggregateType: 'booking',
                aggregateId: uuid(),
                eventType: 'booking.payment_expired',
                eventVersion: 1,
                payload: {},
                occurredAt: clock.now(),
              },
            ],
          });
        }, 'PAYMENT_DUE'),
      );
      expect((await row(id))?.status).toBe('FIRED');
      expect((await db().query('SELECT 1 FROM outbox_event')).rowCount).toBe(1);
    });

    it('respects the batch size', async () => {
      await reset();
      for (let i = 0; i < 5; i += 1) await schedule('PAYMENT_DUE', minutes(-10 + i));
      const first = await run(
        registry(() => Promise.resolve(), 'PAYMENT_DUE'),
        { batchSize: 2 },
      );
      expect(first.fired).toBe(2);
      const rest = await run(registry(() => Promise.resolve(), 'PAYMENT_DUE'));
      expect(rest.fired).toBe(3);
      await expect(
        run(
          registry(() => Promise.resolve(), 'PAYMENT_DUE'),
          { batchSize: 0 },
        ),
      ).rejects.toThrow(RangeError);
    });

    it('never fires a cancelled timer', async () => {
      await reset();
      const booking = uuid();
      await schedule('PAYMENT_DUE', minutes(-5), booking);
      const keep = await schedule('PAYMENT_DUE', minutes(-5));
      await withDbContext(api(), tenant(), (tx) =>
        timers.cancelForAggregate(tx, { type: 'booking', id: booking }),
      );
      const seen: string[] = [];
      await run(
        registry((_tx, timer) => {
          seen.push(timer.id);
          return Promise.resolve();
        }, 'PAYMENT_DUE'),
      );
      expect(seen).toEqual([keep.id]);
    });

    it('leaves a timer with no handler PENDING and reports it', async () => {
      await reset();
      const orphan = await schedule('NO_SHOW_DUE', minutes(-5));
      const orphan2 = await schedule('NO_SHOW_DUE', minutes(-4));
      const handled = await schedule('PAYMENT_DUE', minutes(-3));
      const tomorrow = await schedule('HOLD_DECISION_DUE', minutes(60));
      const result = await run(registry(() => Promise.resolve(), 'PAYMENT_DUE'));
      expect(result).toEqual({ fired: 1, retried: 0, failed: 0, unhandled: { NO_SHOW_DUE: 2 } });
      expect(await row(orphan.id)).toMatchObject({
        status: 'PENDING',
        attempts: 0,
        last_error: null,
      });
      expect((await row(orphan2.id))?.status).toBe('PENDING');
      expect((await row(handled.id))?.status).toBe('FIRED');
      expect((await row(tomorrow.id))?.status).toBe('PENDING');

      // With no handlers at all, nothing is touched and everything due is reported.
      const empty = await run(new TimerHandlerRegistry());
      expect(empty).toEqual({ fired: 0, retried: 0, failed: 0, unhandled: { NO_SHOW_DUE: 2 } });
      // When its handler arrives, the timer fires.
      const late = await run(registry(() => Promise.resolve(), 'NO_SHOW_DUE'));
      expect(late).toMatchObject({ fired: 2, unhandled: {} });
    });

    it('retries a failing timer, then marks it FAILED, without touching the others', async () => {
      await reset();
      const bad = await schedule('PAYMENT_DUE', minutes(-30), uuid(), {
        secret: 'SECRET-PAYLOAD-VALUE',
      });
      const good1 = await schedule('PAYMENT_DUE', minutes(-20));
      const good2 = await schedule('PAYMENT_DUE', minutes(-10));
      const calls: string[] = [];
      const handlers = registry(async (tx, timer) => {
        calls.push(timer.id);
        if (timer.id === bad.id) {
          await tx.outboxEvent.createMany({
            data: [
              {
                id: uuid(),
                aggregateType: 'booking',
                aggregateId: uuid(),
                eventType: 'must.be.rolled.back',
                eventVersion: 1,
                payload: {},
                occurredAt: clock.now(),
              },
            ],
          });
          throw new Error(`boom ${'x'.repeat(2000)}`);
        }
      }, 'PAYMENT_DUE');

      const first = await run(handlers, { maxAttempts: 3 });
      expect(first).toMatchObject({ fired: 2, retried: 1, failed: 0 });
      // The bad timer was tried once in the pass, not in a loop; the good ones ran after it.
      expect(calls).toEqual([bad.id, good1.id, good2.id]);
      const afterFirst = await row(bad.id);
      expect(afterFirst).toMatchObject({ status: 'PENDING', attempts: 1, fired_at: null });
      expect(afterFirst?.last_error?.startsWith('Error: boom')).toBe(true);
      expect(afterFirst?.last_error?.length).toBe(500);
      expect(afterFirst?.last_error).not.toContain('SECRET-PAYLOAD-VALUE');
      expect((await row(good1.id))?.status).toBe('FIRED');
      expect((await row(good2.id))?.status).toBe('FIRED');
      // The handler's own write was rolled back, the attempt was not.
      expect((await db().query('SELECT 1 FROM outbox_event')).rowCount).toBe(0);

      expect(await run(handlers, { maxAttempts: 3 })).toMatchObject({
        fired: 0,
        retried: 1,
        failed: 0,
      });
      const last = await run(handlers, { maxAttempts: 3 });
      expect(last).toMatchObject({ fired: 0, retried: 0, failed: 1 });
      expect(await row(bad.id)).toMatchObject({ status: 'FAILED', attempts: 3, fired_at: null });
      // A FAILED timer is not picked up again.
      expect(await run(handlers, { maxAttempts: 3 })).toMatchObject({
        fired: 0,
        retried: 0,
        failed: 0,
      });
      expect((await db().query('SELECT 1 FROM outbox_event')).rowCount).toBe(0);
    });

    it('fires on a later attempt once the handler succeeds', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(-1));
      let attempts = 0;
      const handlers = registry(() => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('temporary')) : Promise.resolve();
      }, 'PAYMENT_DUE');
      expect(await run(handlers)).toMatchObject({ fired: 0, retried: 1 });
      expect(await run(handlers)).toMatchObject({ fired: 1, retried: 0 });
      expect(await row(id)).toMatchObject({ status: 'FIRED', attempts: 1 });
    });

    it('survives a handler whose SQL statement fails inside the transaction', async () => {
      await reset();
      const bad = await schedule('PAYMENT_DUE', minutes(-2));
      const good = await schedule('PAYMENT_DUE', minutes(-1));
      const result = await run(
        registry(async (tx, timer) => {
          // An error that aborts the PostgreSQL transaction, not only the handler.
          if (timer.id === bad.id) await tx.$executeRaw`SELECT 1 / 0`;
        }, 'PAYMENT_DUE'),
      );
      expect(result).toMatchObject({ fired: 1, retried: 1 });
      expect(await row(bad.id)).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(await row(good.id)).toMatchObject({ status: 'FIRED' });
    });

    it('never runs a timer twice while another worker holds it', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(-1));
      const entered = gate();
      const release = gate();
      const calls: string[] = [];
      const slow = registry(async (_tx, timer) => {
        calls.push(timer.id);
        entered.open();
        await release.wait;
      }, 'PAYMENT_DUE');
      const first = run(slow);
      await entered.wait;

      // The second worker finds the row locked and does nothing.
      const second = await run(slow);
      expect(second).toMatchObject({ fired: 0, retried: 0, failed: 0 });
      expect(calls).toEqual([id]);

      release.open();
      expect(await first).toMatchObject({ fired: 1 });
      expect(calls).toEqual([id]);
      expect(await row(id)).toMatchObject({ status: 'FIRED' });
    });

    it('splits a backlog between two simultaneous passes without double firing', async () => {
      await reset();
      const ids: string[] = [];
      for (let i = 0; i < 24; i += 1)
        ids.push((await schedule('PAYMENT_DUE', minutes(-100 + i))).id);
      const counts = new Map<string, number>();
      const handlers = registry(async (_tx, timer) => {
        counts.set(timer.id, (counts.get(timer.id) ?? 0) + 1);
        await new Promise((resolve) => setImmediate(resolve));
      }, 'PAYMENT_DUE');
      const [a, b] = await Promise.all([run(handlers), run(handlers)]);
      expect(a.fired + b.fired).toBe(24);
      expect([...counts.keys()].sort()).toEqual([...ids].sort());
      expect([...counts.values()].every((n) => n === 1)).toBe(true);
    });

    it('lets a cancel that loses the race see FIRED and report false', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(-1));
      const entered = gate();
      const release = gate();
      const first = run(
        registry(async () => {
          entered.open();
          await release.wait;
        }, 'PAYMENT_DUE'),
      );
      await entered.wait;
      // Waits for the row lock the worker holds, then finds the timer no longer PENDING.
      const cancel = withDbContext(api(), tenant(), (tx) => timers.cancel(tx, id));
      release.open();
      await first;
      expect(await cancel).toBe(false);
      expect((await row(id))?.status).toBe('FIRED');
    });

    it('does not retry in a later pass of the same run a timer listed in skipIds', async () => {
      await reset();
      const bad = await schedule('PAYMENT_DUE', minutes(-5));
      const handlers = registry(() => Promise.reject(new Error('nope')), 'PAYMENT_DUE');
      const skipIds = new Set<string>();
      expect(await run(handlers, { skipIds })).toMatchObject({ retried: 1 });
      expect(skipIds).toEqual(new Set([bad.id]));
      expect(await run(handlers, { skipIds })).toMatchObject({ retried: 0, fired: 0 });
      expect((await row(bad.id))?.attempts).toBe(1);
    });

    it('also runs through TimerService.runDue', async () => {
      await reset();
      const { id } = await schedule('PAYMENT_DUE', minutes(-1));
      const result = await timers.runDue(
        worker(),
        registry(() => Promise.resolve(), 'PAYMENT_DUE'),
      );
      expect(result.fired).toBe(1);
      expect((await row(id))?.status).toBe('FIRED');
    });
  });

  describe('holidays for the calendar', () => {
    it('loads national and requested regional holidays in the IST window', async () => {
      await db().query('DELETE FROM holiday_calendar');
      await db().query(
        `INSERT INTO holiday_calendar (id, holiday_date, name, region_code) VALUES
         ($1, '2026-12-25', 'Christmas Day', NULL),
         ($2, '2026-12-26', 'Regional A', 'KA'),
         ($3, '2026-12-27', 'Regional B', 'DL'),
         ($4, '2027-01-26', 'Republic Day', NULL),
         ($5, '2026-12-24', 'Before the window', NULL)`,
        [uuid(), uuid(), uuid(), uuid(), uuid()],
      );
      // 18:30 UTC on the 24th is already the 25th in IST.
      const window = {
        from: new Date('2026-12-24T18:30:00Z'),
        to: new Date('2027-01-26T10:00:00Z'),
      };
      expect(
        await withDbContext(api(), tenant(), (tx) => loadPlatformHolidays(tx, window)),
      ).toEqual(['2026-12-25', '2027-01-26']);
      expect(
        await withDbContext(worker(), system, (tx) =>
          loadPlatformHolidays(tx, { ...window, regionCodes: ['KA'] }),
        ),
      ).toEqual(['2026-12-25', '2026-12-26', '2027-01-26']);

      const calendar = await withDbContext(api(), tenant(), (tx) =>
        loadBusinessCalendar(tx, {
          ...window,
          regionCodes: ['KA'],
          hours: {
            5: [{ opensAtMinute: 540, closesAtMinute: 1080 }],
            1: [{ opensAtMinute: 540, closesAtMinute: 1080 }],
          },
          closures: [{ startsOn: '2027-01-04', endsOn: '2027-01-08' }],
        }),
      );
      // Friday 25 Dec is a holiday, so the next opening is Monday 28 Dec; 4 to 8 Jan is closed.
      expect(calendar.nextOpening(new Date('2026-12-25T04:00:00Z')).toISOString()).toBe(
        '2026-12-28T03:30:00.000Z',
      );
      expect(calendar.isClosedDate('2026-12-26')).toBe(true);
      expect(calendar.isClosedDate('2027-01-06')).toBe(true);
      expect(calendar.isWorkingDate('2027-01-01')).toBe(true);

      // The loader builds the same window from the clock: 2026-11-25 + 400 days covers both holidays.
      const viaLoader = await withDbContext(api(), tenant(), (tx) =>
        new BusinessCalendarLoader(clock).forSite(tx, {
          hours: { 5: [{ opensAtMinute: 540, closesAtMinute: 1080 }] },
          regionCodes: ['DL'],
        }),
      );
      expect(viaLoader.isClosedDate('2026-12-25')).toBe(true);
      expect(viaLoader.isClosedDate('2026-12-27')).toBe(true);
      expect(viaLoader.isClosedDate('2026-12-26')).toBe(false);
      expect(viaLoader.isClosedDate('2027-01-26')).toBe(true);
    });
  });
});
