import { BOOKING_STATUSES, BOOKING_TRANSITIONS, isTerminalStatus } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import {
  registerDefaultBookingEffects,
  timersObsoleteIn,
  TIMER_LIVE_STATES,
} from './default-effects.js';
import { TransitionRegistry } from './registry.js';
import { addMinutes, partyOf } from './status-columns.js';

describe('timer liveness', () => {
  it('covers every timer type except PAYMENT_RECONCILE', () => {
    expect(Object.keys(TIMER_LIVE_STATES).sort()).toEqual(
      [
        'LAB_DECISION_REMINDER_50',
        'LAB_DECISION_REMINDER_90',
        'LAB_DECISION_DUE',
        'COUNTER_RESPONSE_DUE',
        'PAYMENT_REMINDER',
        'PAYMENT_DUE',
        'DROP_REMINDER',
        'DROP_DEADLINE',
        'NO_SHOW_DUE',
        'RECEIPT_APPROVAL_REMINDER',
        'HOLD_DECISION_DUE',
        'REPORT_DUE',
        'REPORT_APPROVAL_REMINDER',
        'DISPUTE_WINDOW_END',
      ].sort(),
    );
  });

  it('every terminal state makes every booking timer obsolete', () => {
    for (const status of BOOKING_STATUSES.filter(isTerminalStatus)) {
      expect(timersObsoleteIn(status)).toHaveLength(Object.keys(TIMER_LIVE_STATES).length);
    }
  });

  it('a timer is live in the states of the transition that its docs row schedules it for', () => {
    expect(timersObsoleteIn('ACCEPTED')).not.toContain('PAYMENT_DUE');
    expect(timersObsoleteIn('ACCEPTED')).toContain('COUNTER_RESPONSE_DUE');
    expect(timersObsoleteIn('UNDER_TEST')).not.toContain('REPORT_DUE');
    expect(timersObsoleteIn('REPORT_IN_REVIEW')).not.toContain('REPORT_DUE');
    expect(timersObsoleteIn('REPORT_RELEASED')).toContain('REPORT_DUE');
    expect(timersObsoleteIn('DISPUTED')).toContain('DISPUTE_WINDOW_END');
  });

  it('a transition never obsoletes the timers its own default effect schedules', () => {
    const schedules: Record<string, string[]> = {
      'T-03': ['PAYMENT_DUE', 'PAYMENT_REMINDER'],
      'T-07': ['PAYMENT_DUE', 'PAYMENT_REMINDER'],
      'T-04': ['COUNTER_RESPONSE_DUE'],
      'T-15': ['HOLD_DECISION_DUE'],
      'T-21': ['DISPUTE_WINDOW_END'],
    };
    for (const [id, types] of Object.entries(schedules)) {
      const to = BOOKING_TRANSITIONS.find((t) => t.id === id)?.to;
      if (!to) throw new Error(id);
      for (const type of types) expect(timersObsoleteIn(to)).not.toContain(type);
    }
  });
});

describe('registerDefaultBookingEffects', () => {
  it('registers the cancel effect for every transition and the timer effects for five', () => {
    const registry = registerDefaultBookingEffects(new TransitionRegistry());
    expect(registry.effectsFor('T-02').map((e) => e.name)).toEqual([
      'booking.cancel-obsolete-timers',
    ]);
    expect(registry.effectsFor('T-03').map((e) => e.name)).toEqual([
      'booking.cancel-obsolete-timers',
      'booking.schedule-payment-timers',
    ]);
    expect(registry.effectsFor('T-07')).toHaveLength(2);
    expect(registry.effectsFor('T-04')).toHaveLength(2);
    expect(registry.effectsFor('T-15')).toHaveLength(2);
    expect(registry.effectsFor('T-21')).toHaveLength(2);
    expect(registry.effectsFor('T-11')).toHaveLength(1);
    expect(() => registerDefaultBookingEffects(registry)).toThrow(/already registered/);
  });
});

describe('helpers', () => {
  it('addMinutes', () => {
    expect(addMinutes(new Date('2026-11-25T10:00:00Z'), 1440).toISOString()).toBe(
      '2026-11-26T10:00:00.000Z',
    );
    expect(addMinutes(new Date('2026-11-25T10:00:00Z'), -120).toISOString()).toBe(
      '2026-11-25T08:00:00.000Z',
    );
  });

  it('partyOf follows the role', () => {
    expect(partyOf({ kind: 'SYSTEM' })).toBe('SYSTEM');
    expect(partyOf({ kind: 'USER', userId: 'u', role: 'CUSTOMER_FINANCE' })).toBe('CUSTOMER');
    expect(partyOf({ kind: 'USER', userId: 'u', role: 'LAB_MAKER' })).toBe('LAB');
    expect(partyOf({ kind: 'USER', userId: 'u', role: 'PLATFORM_OPS' })).toBe('PLATFORM');
  });
});
