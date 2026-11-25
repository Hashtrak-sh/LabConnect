import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from './events.js';
import { QUEUES } from './routes.js';
import { queueUrlsFromEnv, SqsQueuePublisher } from './sqs-publisher.js';

const envelope: EventEnvelope = {
  id: '0193a000-0000-7000-8000-000000000001',
  type: 'booking.accepted',
  version: 1,
  occurredAt: '2026-11-25T10:00:00.000Z',
  aggregate: { type: 'booking', id: '0193a000-0000-7000-8000-0000000000b1' },
  actor: 'SYSTEM',
  data: { bookingNo: 'LC-1' },
};

function stub(): {
  sent: SendMessageCommand[];
  client: { send: (c: SendMessageCommand) => Promise<void> };
} {
  const sent: SendMessageCommand[] = [];
  return {
    sent,
    client: {
      send: (command) => {
        sent.push(command);
        return Promise.resolve();
      },
    },
  };
}

describe('SqsQueuePublisher', () => {
  const urls = {
    [QUEUES.notifications]: 'https://sqs.example/000/lc-notifications.fifo',
    [QUEUES.analytics]: 'https://sqs.example/000/lc-analytics',
  };

  it('gives a FIFO queue the aggregate id as group and the event id for deduplication', async () => {
    const { sent, client } = stub();
    await new SqsQueuePublisher(client, urls).publish(QUEUES.notifications, envelope);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input).toMatchObject({
      QueueUrl: urls[QUEUES.notifications],
      MessageGroupId: envelope.aggregate.id,
      MessageDeduplicationId: envelope.id,
    });
    expect(JSON.parse(sent[0]?.input.MessageBody ?? '')).toEqual(envelope);
  });

  it('sets neither on a standard queue', async () => {
    const { sent, client } = stub();
    await new SqsQueuePublisher(client, urls).publish(QUEUES.analytics, envelope);
    expect(sent[0]?.input.MessageGroupId).toBeUndefined();
    expect(sent[0]?.input.MessageDeduplicationId).toBeUndefined();
    expect(sent[0]?.input.MessageAttributes?.eventType?.StringValue).toBe('booking.accepted');
  });

  it('fails, so the relay retries, when a queue has no URL', async () => {
    const { sent, client } = stub();
    await expect(
      new SqsQueuePublisher(client, urls).publish(QUEUES.files, envelope),
    ).rejects.toThrow(/No URL/);
    expect(sent).toHaveLength(0);
  });

  it('passes on a failure of the client', async () => {
    const publisher = new SqsQueuePublisher(
      { send: () => Promise.reject(new Error('throttled')) },
      urls,
    );
    await expect(publisher.publish(QUEUES.analytics, envelope)).rejects.toThrow('throttled');
  });
});

describe('queueUrlsFromEnv', () => {
  it('reads QUEUE_URL_<NAME> and skips what is not set', () => {
    expect(
      queueUrlsFromEnv({
        QUEUE_URL_LC_NOTIFICATIONS_FIFO: 'https://q/n.fifo',
        QUEUE_URL_LC_ANALYTICS: 'https://q/a',
      }),
    ).toEqual({ 'lc-notifications.fifo': 'https://q/n.fifo', 'lc-analytics': 'https://q/a' });
    expect(queueUrlsFromEnv({})).toEqual({});
  });
});
