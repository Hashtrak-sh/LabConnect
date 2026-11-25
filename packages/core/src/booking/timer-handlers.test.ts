import type { Prisma, TimerType } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import type { OutboxService } from '../platform/outbox.js';
import { type DueTimer, TimerHandlerRegistry } from '../platform/timers.js';
import type { BookingEngine } from './engine.js';
import { createBookingTimerHandlers, registerBookingTimerHandlers } from './timer-handlers.js';

const clock = new FixedClock('2026-11-25T10:00:00Z');
const timer = (type: TimerType, aggregateType = 'booking'): DueTimer => ({
  id: 't',
  type,
  aggregate: { type: aggregateType, id: 'b1' },
  dueAt: clock.now(),
  attempts: 0,
  payload: null,
});

function fakes(status: string | null) {
  const calls: { transitionId: string; statuses: unknown; actor: unknown }[] = [];
  const events: { type: string; data: unknown; actor: unknown }[] = [];
  const engine = {
    transitionIfStatus: (
      _tx: unknown,
      command: { transitionId: string; actor: unknown },
      statuses: unknown,
    ) => {
      calls.push({ transitionId: command.transitionId, statuses, actor: command.actor });
      return Promise.resolve({ applied: false });
    },
  } as unknown as BookingEngine;
  const outbox = {
    enqueue: (_tx: unknown, event: { type: string; data: unknown; actor: unknown }) => {
      events.push(event);
      return Promise.resolve({ id: 'e' });
    },
  } as unknown as OutboxService;
  const tx = {
    booking: { findUnique: () => Promise.resolve(status === null ? null : { status }) },
  } as unknown as Prisma.TransactionClient;
  return { engine, outbox, tx, calls, events };
}

describe('createBookingTimerHandlers', () => {
  it('has a handler for every expiry and reminder timer, and none for REPORT_DUE or PAYMENT_RECONCILE', () => {
    const { engine, outbox } = fakes('REQUESTED');
    const handlers = createBookingTimerHandlers({
      engine,
      outbox,
      hasPendingPayment: () => Promise.resolve(false),
    });
    expect(Object.keys(handlers).sort()).toEqual(
      [
        'LAB_DECISION_DUE',
        'COUNTER_RESPONSE_DUE',
        'PAYMENT_DUE',
        'NO_SHOW_DUE',
        'DISPUTE_WINDOW_END',
        'LAB_DECISION_REMINDER_50',
        'LAB_DECISION_REMINDER_90',
        'PAYMENT_REMINDER',
        'DROP_REMINDER',
        'DROP_DEADLINE',
        'RECEIPT_APPROVAL_REMINDER',
        'REPORT_APPROVAL_REMINDER',
        'HOLD_DECISION_DUE',
      ].sort(),
    );
  });

  it('an expiry handler asks the engine for the documented transition from the documented state, as SYSTEM', async () => {
    const f = fakes('REQUESTED');
    const handlers = createBookingTimerHandlers({ engine: f.engine, outbox: f.outbox });
    const expected: [TimerType, string, string][] = [
      ['LAB_DECISION_DUE', 'T-06', 'REQUESTED'],
      ['COUNTER_RESPONSE_DUE', 'T-08', 'COUNTERED'],
      ['NO_SHOW_DUE', 'T-12', 'HANDOVER_SET'],
      ['DISPUTE_WINDOW_END', 'T-23', 'REPORT_RELEASED'],
    ];
    for (const [type, transitionId, from] of expected) {
      await handlers[type]?.(f.tx, timer(type), clock);
      expect(f.calls.at(-1)).toEqual({ transitionId, statuses: from, actor: { kind: 'SYSTEM' } });
    }
  });

  it('ignores a timer that is not on a booking', async () => {
    const f = fakes('REQUESTED');
    const handlers = createBookingTimerHandlers({ engine: f.engine, outbox: f.outbox });
    await handlers.LAB_DECISION_DUE?.(f.tx, timer('LAB_DECISION_DUE', 'payment_order'), clock);
    await handlers.PAYMENT_REMINDER?.(f.tx, timer('PAYMENT_REMINDER', 'payment_order'), clock);
    expect(f.calls).toEqual([]);
    expect(f.events).toEqual([]);
  });

  it('a reminder emits its event only in its state, with ids and the state only', async () => {
    const inState = fakes('ON_HOLD');
    const handlers = createBookingTimerHandlers({ engine: inState.engine, outbox: inState.outbox });
    await handlers.HOLD_DECISION_DUE?.(inState.tx, timer('HOLD_DECISION_DUE'), clock);
    expect(inState.events).toEqual([
      {
        type: 'hold.escalated',
        aggregate: { type: 'booking', id: 'b1' },
        actor: 'SYSTEM',
        data: { bookingId: 'b1', status: 'ON_HOLD', timerType: 'HOLD_DECISION_DUE' },
      },
    ]);
    expect(inState.calls).toEqual([]); // BR-047: no automatic cancellation

    for (const other of ['RECEIVED', null]) {
      const f = fakes(other);
      const h = createBookingTimerHandlers({ engine: f.engine, outbox: f.outbox });
      await h.HOLD_DECISION_DUE?.(f.tx, timer('HOLD_DECISION_DUE'), clock);
      expect(f.events).toEqual([]);
    }
  });

  it('registers into a TimerHandlerRegistry once per type', () => {
    const { engine, outbox } = fakes('REQUESTED');
    const registry = new TimerHandlerRegistry();
    const handlers = createBookingTimerHandlers({ engine, outbox });
    registerBookingTimerHandlers(registry, handlers);
    expect(registry.types()).toHaveLength(Object.keys(handlers).length);
    expect(() => {
      registerBookingTimerHandlers(registry, handlers);
    }).toThrow(/already registered/);
  });
});
