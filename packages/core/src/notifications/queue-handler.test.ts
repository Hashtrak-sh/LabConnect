import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import type { EventEnvelope } from '../platform/events.js';
import { InMemoryQueueConsumer } from '../platform/queue-consumer.js';
import { QUEUES } from '../platform/routes.js';
import { InMemoryNotificationContext } from './context.js';
import { buildTemplateData } from './dispatch.js';
import {
  consumeNotificationsQueue,
  MalformedNotificationMessageError,
  parseNotificationMessage,
} from './queue-handler.js';

const uuid = (n: number): string => `0190b1f2-0000-7000-8000-${String(n).padStart(12, '0')}`;

function envelope(n: number, aggregateId: string, type = 'booking.accepted'): EventEnvelope {
  return {
    id: uuid(n),
    type,
    version: 1,
    occurredAt: '2026-11-25T10:00:00.000Z',
    aggregate: { type: 'booking', id: aggregateId },
    actor: 'SYSTEM',
    data: { bookingId: aggregateId },
  };
}

const deps = {
  prisma: { $transaction: () => Promise.reject(new Error('the database is not used here')) },
  clock: new FixedClock('2026-11-25T10:00:00Z'),
  context: new InMemoryNotificationContext(),
};

describe('parseNotificationMessage', () => {
  it('reads an envelope', () => {
    expect(parseNotificationMessage(JSON.stringify(envelope(1, 'b1'))).id).toBe(uuid(1));
  });

  it.each([
    ['not json', 'nope'],
    ['not an object', '[]'],
    [
      'no id',
      JSON.stringify({ type: 'booking.accepted', aggregate: { id: 'b', type: 'booking' } }),
    ],
    ['a bad id', JSON.stringify({ ...envelope(1, 'b'), id: 'x' })],
    ['no aggregate', JSON.stringify({ ...envelope(1, 'b'), aggregate: null })],
    ['no type', JSON.stringify({ ...envelope(1, 'b'), type: '' })],
  ])('refuses %s', (_label, body) => {
    expect(() => parseNotificationMessage(body)).toThrow(MalformedNotificationMessageError);
  });
});

describe('consumeNotificationsQueue', () => {
  const send = (queue: InMemoryQueueConsumer, ...events: EventEnvelope[]): void => {
    for (const event of events) queue.send(QUEUES.notifications, JSON.stringify(event));
  };

  it('handles messages in the order received and acknowledges them', async () => {
    const queue = new InMemoryQueueConsumer();
    send(queue, envelope(1, 'b1'), envelope(2, 'b1'), envelope(3, 'b2'));
    const seen: string[] = [];
    const result = await consumeNotificationsQueue(queue, deps, undefined, (_deps, event) => {
      seen.push(event.id);
      return Promise.resolve();
    });
    expect(seen).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(result).toMatchObject({ received: 3, acknowledged: 3, failed: 0, left: 0 });
    expect(queue.pending(QUEUES.notifications)).toBe(0);
  });

  it('leaves the later messages of a group when one fails, and carries on with other groups', async () => {
    const queue = new InMemoryQueueConsumer();
    send(queue, envelope(1, 'b1'), envelope(2, 'b1'), envelope(3, 'b2'), envelope(4, 'b1'));
    const seen: string[] = [];
    const result = await consumeNotificationsQueue(queue, deps, undefined, (_deps, event) => {
      seen.push(event.id);
      return event.id === uuid(1) ? Promise.reject(new Error('boom')) : Promise.resolve();
    });
    // b1's first message failed: its second and third were not even tried, b2's went through.
    expect(seen).toEqual([uuid(1), uuid(3)]);
    expect(result).toMatchObject({ received: 4, acknowledged: 1, failed: 1, left: 2 });
    expect(queue.pending(QUEUES.notifications)).toBe(3);

    // After the visibility timeout the group is redelivered in its original order.
    queue.redeliver(QUEUES.notifications);
    const again: string[] = [];
    await consumeNotificationsQueue(queue, deps, undefined, (_deps, event) => {
      again.push(event.id);
      return Promise.resolve();
    });
    expect(again).toEqual([uuid(1), uuid(2), uuid(4)]);
  });

  it('fails a message that is not an envelope, so it ends in the dead-letter queue', async () => {
    const queue = new InMemoryQueueConsumer();
    queue.send(QUEUES.notifications, 'garbage');
    const result = await consumeNotificationsQueue(queue, deps);
    expect(result).toMatchObject({ received: 1, acknowledged: 0, failed: 1 });
  });

  it('acknowledges an event that is not a notification event without touching the database', async () => {
    const queue = new InMemoryQueueConsumer();
    send(queue, envelope(1, 'f1', 'file.available'));
    const result = await consumeNotificationsQueue(queue, deps);
    expect(result).toMatchObject({ received: 1, acknowledged: 1, failed: 0 });
  });
});

describe('buildTemplateData', () => {
  const context = {
    bookingId: uuid(9),
    bookingNo: 'LC-2026-000123',
    labName: 'Precision Test Lab',
    organisationName: 'Acme',
  };

  it('keeps only the variables the event allows and formats dates and money', () => {
    expect(
      buildTemplateData('payment.succeeded', context, {
        deadlineAt: '2026-11-26T12:00:00Z',
        amountPaise: 123_456_789,
        reason: 'not allowed here',
      }),
    ).toEqual({
      bookingNo: 'LC-2026-000123',
      labName: 'Precision Test Lab',
      deadline: '26 Nov 2026, 5:30 pm IST',
      amount: '₹12,34,567.89',
      actionUrl: `/bookings/${uuid(9)}`,
    });
  });

  it('takes a reason only for events that show one, clipped and on one line', () => {
    const reason = `Capacity\r\nfull ${'x'.repeat(300)}`;
    const view = buildTemplateData('booking.rejected', context, { reason });
    expect(view.reason).toMatch(/^Capacity full x+…$/);
    expect(view.reason?.length).toBe(200);
    expect(buildTemplateData('booking.accepted', context, { reason })).not.toHaveProperty('reason');
  });

  it('ignores fields of the wrong type and never invents a value', () => {
    expect(
      buildTemplateData(
        'refund.processed',
        { bookingNo: 'LC-1' },
        { amountPaise: 1.5, deadlineAt: 'soon', reason: 42 },
      ),
    ).toEqual({ bookingNo: 'LC-1' });
  });

  it('puts no report content, secret or contact data in the view, whatever the event carries', () => {
    const view = buildTemplateData('report.released', context, {
      reportText: 'Result: 42 MPa',
      otp: '123456',
      token: 'abc',
      email: 'a@b.test',
      bankAccount: '123456789012',
    });
    expect(JSON.stringify(view)).not.toMatch(/MPa|123456|abc|a@b|bank/);
  });
});
