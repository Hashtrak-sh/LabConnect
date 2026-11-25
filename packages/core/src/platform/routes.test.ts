import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES, QUEUES, queuesFor } from './routes.js';

describe('queuesFor', () => {
  it('sends a notification event to the notifications queue and the analytics stream', () => {
    expect(queuesFor('booking.accepted')).toEqual([QUEUES.notifications, QUEUES.analytics]);
  });

  it('sends an event no route mentions to analytics, never nowhere', () => {
    expect(queuesFor('something.new')).toEqual([QUEUES.analytics]);
  });

  it('keeps the OTP out of the event stream', () => {
    expect(NOTIFICATION_EVENT_TYPES.has('auth.otp')).toBe(false);
  });

  it('uses the queue names of the architecture document', () => {
    expect(Object.values(QUEUES).sort()).toEqual(
      ['lc-analytics', 'lc-files', 'lc-notifications.fifo', 'lc-search-sync', 'lc-timers'].sort(),
    );
  });
});
