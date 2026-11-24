import { describe, expect, it } from 'vitest';

import {
  BOOKING_COMMANDS,
  BOOKING_LINE_STATE_MACHINE,
  BOOKING_STATUSES,
  BOOKING_TRANSITION_ROWS,
  BOOKING_TRANSITIONS,
  type BookingStatus,
  canSubTransition,
  canTransition,
  findTransition,
  isBookingStatus,
  isTerminalStatus,
  isTransitionId,
  PACKAGE_STATE_MACHINE,
  PAYMENT_ORDER_STATE_MACHINE,
  RECEIPT_RECORD_STATE_MACHINE,
  REPORT_VERSION_STATE_MACHINE,
  type SubStateMachine,
  TERMINAL_BOOKING_STATUSES,
  TRANSITION_IDS,
  transitionsFrom,
} from '../src/booking-state-machine.js';

describe('booking transitions', () => {
  it('list every TransitionId exactly once, in order', () => {
    expect(BOOKING_TRANSITIONS.map((t) => t.id)).toEqual(TRANSITION_IDS);
    expect(TRANSITION_IDS).toEqual(
      Array.from({ length: 28 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('use every command, and only T-01 has no from-state', () => {
    const used = new Set(BOOKING_TRANSITIONS.flatMap((t) => t.commands.map((c) => c.name)));
    expect([...used].sort()).toEqual([...BOOKING_COMMANDS].sort());
    expect(BOOKING_TRANSITIONS.filter((t) => t.from.length === 0).map((t) => t.id)).toEqual([
      'T-01',
    ]);
    for (const t of BOOKING_TRANSITIONS) expect(t.commands.length).toBeGreaterThan(0);
  });

  it('give every non-terminal state an outgoing transition', () => {
    for (const status of BOOKING_STATUSES.filter((s) => !isTerminalStatus(s))) {
      expect(transitionsFrom(status).length, status).toBeGreaterThan(0);
    }
  });

  it('never leave a terminal state', () => {
    for (const status of TERMINAL_BOOKING_STATUSES) {
      expect(transitionsFrom(status), status).toEqual([]);
    }
    expect([...TERMINAL_BOOKING_STATUSES].sort()).toEqual(
      ['CANCELLED', 'COMPLETED', 'EXPIRED', 'EXPIRED_UNPAID', 'NO_SHOW', 'REJECTED'].sort(),
    );
  });

  it('reach every state from T-01', () => {
    const reached = new Set<BookingStatus>([findTransition('T-01').to]);
    const queue: BookingStatus[] = [...reached];
    for (let status = queue.shift(); status !== undefined; status = queue.shift()) {
      for (const t of transitionsFrom(status)) {
        if (!reached.has(t.to)) {
          reached.add(t.to);
          queue.push(t.to);
        }
      }
    }
    expect([...reached].sort()).toEqual([...BOOKING_STATUSES].sort());
  });

  it('reach a terminal state from every state', () => {
    for (const start of BOOKING_STATUSES) {
      const seen = new Set<BookingStatus>([start]);
      const queue: BookingStatus[] = [start];
      for (let status = queue.shift(); status !== undefined; status = queue.shift()) {
        for (const t of transitionsFrom(status)) {
          if (!seen.has(t.to)) {
            seen.add(t.to);
            queue.push(t.to);
          }
        }
      }
      expect([...seen].some(isTerminalStatus), start).toBe(true);
    }
  });

  it('flatten to 33 rows, one per (transition, from-state)', () => {
    expect(BOOKING_TRANSITION_ROWS).toHaveLength(33);
    expect(BOOKING_TRANSITION_ROWS[0]).toEqual({
      transitionId: 'T-01',
      fromStatus: null,
      toStatus: 'REQUESTED',
    });
    expect(BOOKING_TRANSITION_ROWS.filter((r) => r.transitionId === 'T-27')).toHaveLength(4);
  });
});

describe('canTransition', () => {
  it('equals the rows exactly, for every id × from × to', () => {
    const rows = new Set(
      BOOKING_TRANSITION_ROWS.map((r) => `${r.transitionId}:${r.fromStatus ?? ''}>${r.toStatus}`),
    );
    let allowed = 0;
    for (const id of TRANSITION_IDS) {
      for (const from of [null, ...BOOKING_STATUSES]) {
        for (const to of BOOKING_STATUSES) {
          const expected = rows.has(`${id}:${from ?? ''}>${to}`);
          expect(canTransition(id, from, to), `${id} ${String(from)} → ${to}`).toBe(expected);
          if (expected) allowed += 1;
        }
      }
    }
    expect(allowed).toBe(33);
  });

  it('separates transitions that share an edge by id', () => {
    expect(canTransition('T-27', 'SAMPLE_RECORDED', 'CANCELLED')).toBe(true);
    expect(canTransition('T-28', 'SAMPLE_RECORDED', 'CANCELLED')).toBe(true);
    expect(canTransition('T-28', 'ON_HOLD', 'CANCELLED')).toBe(false);
    expect(canTransition('T-25', 'HANDOVER_SET', 'CANCELLED')).toBe(false);
  });
});

describe('lookups and guards', () => {
  it('findTransition returns the transition with that id', () => {
    for (const id of TRANSITION_IDS) expect(findTransition(id).id).toBe(id);
    expect(findTransition('T-08').commands.map((c) => c.name)).toEqual([
      'DeclineCounter',
      'ExpireCounter',
    ]);
  });

  it('transitionsFrom lists the transitions leaving a state, in table order', () => {
    expect(transitionsFrom('REQUESTED').map((t) => t.id)).toEqual([
      'T-02',
      'T-03',
      'T-04',
      'T-05',
      'T-06',
      'T-25',
    ]);
    expect(transitionsFrom('PAID').map((t) => t.id)).toEqual(['T-11']);
  });

  it('type guards accept only known values', () => {
    expect(isBookingStatus('PAID')).toBe(true);
    expect(isBookingStatus('IN_TRANSIT')).toBe(false);
    expect(isBookingStatus(1)).toBe(false);
    expect(isTransitionId('T-28')).toBe(true);
    expect(isTransitionId('T-29')).toBe(false);
    expect(isTransitionId(null)).toBe(false);
  });
});

describe('sub-state machines', () => {
  const machines: Record<string, SubStateMachine<string>> = {
    paymentOrder: PAYMENT_ORDER_STATE_MACHINE,
    package: PACKAGE_STATE_MACHINE,
    receiptRecord: RECEIPT_RECORD_STATE_MACHINE,
    reportVersion: REPORT_VERSION_STATE_MACHINE,
    bookingLine: BOOKING_LINE_STATE_MACHINE,
  };

  for (const [name, machine] of Object.entries(machines)) {
    it(`${name}: edges use known states, without duplicates, and every state is connected`, () => {
      const edges = machine.transitions.map(([from, to]) => `${from}>${to}`);
      expect(new Set(edges).size).toBe(edges.length);
      const touched = new Set(machine.transitions.flat());
      expect([...touched].sort()).toEqual([...machine.states].sort());
    });
  }

  it('canSubTransition follows the edges only', () => {
    expect(canSubTransition(PAYMENT_ORDER_STATE_MACHINE, 'PENDING', 'CAPTURED')).toBe(true);
    expect(canSubTransition(PAYMENT_ORDER_STATE_MACHINE, 'CREATED', 'CAPTURED')).toBe(false);
    expect(canSubTransition(REPORT_VERSION_STATE_MACHINE, 'RELEASED', 'SUPERSEDED')).toBe(true);
    expect(canSubTransition(REPORT_VERSION_STATE_MACHINE, 'SUPERSEDED', 'RELEASED')).toBe(false);
    expect(canSubTransition(BOOKING_LINE_STATE_MACHINE, 'DONE', 'CANCELLED')).toBe(false);
  });
});
