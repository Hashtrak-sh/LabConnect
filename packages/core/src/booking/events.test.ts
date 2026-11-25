import { TRANSITION_IDS } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';
import { eventTypesFor, TRANSITIONS_WITHOUT_EVENT } from './events.js';

const user = { kind: 'USER', userId: 'u', role: 'CUSTOMER_REQUESTER' } as const;

describe('eventTypesFor', () => {
  it('maps the transitions as NOTIFICATIONS_MATRIX.md triggers say (pinned literally)', () => {
    const expected: Record<string, string[]> = {
      'T-01': ['booking.requested'],
      'T-02': [],
      'T-03': ['booking.accepted'],
      'T-04': ['booking.countered'],
      'T-05': ['booking.rejected'],
      'T-06': ['booking.expired'],
      'T-07': ['booking.accepted', 'booking.counter_response'],
      'T-09': [],
      'T-10': ['payment.expired'],
      'T-11': ['payment.succeeded'],
      'T-12': ['booking.no_show'],
      'T-13': ['receipt.recorded'],
      'T-14': ['receipt.approved'],
      'T-15': ['receipt.on_hold'],
      'T-16': ['receipt.approved'],
      'T-17': ['receipt.recorded'],
      'T-18': ['testing.started'],
      'T-19': ['report.submitted'],
      'T-20': ['report.returned'],
      'T-21': ['report.released'],
      'T-22': ['dispute.opened'],
      'T-23': [],
      'T-24': [],
      'T-25': ['booking.cancelled'],
      'T-26': ['booking.cancelled'],
      'T-27': ['booking.cancelled'],
      'T-28': ['booking.cancelled'],
    };
    for (const [id, types] of Object.entries(expected)) {
      expect(eventTypesFor(id as 'T-01', user), id).toEqual(types);
    }
  });

  it('T-08: a decline is also a counter response, a lapse is not', () => {
    expect(eventTypesFor('T-08', user)).toEqual(['booking.expired', 'booking.counter_response']);
    expect(eventTypesFor('T-08', { kind: 'SYSTEM' })).toEqual(['booking.expired']);
  });

  it('only uses codes of the notifications matrix, and lists the transitions without one', () => {
    for (const id of TRANSITION_IDS) {
      for (const type of eventTypesFor(id, user))
        expect(NOTIFICATION_EVENT_TYPES.has(type), type).toBe(true);
    }
    expect(TRANSITIONS_WITHOUT_EVENT).toEqual(['T-02', 'T-09', 'T-23', 'T-24']);
  });
});
