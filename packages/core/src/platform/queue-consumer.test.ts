import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';
import {
  consumeBatch,
  InMemoryQueueConsumer,
  type QueueMessage,
  SqsQueueConsumer,
  type SqsReceiver,
} from './queue-consumer.js';
import { QUEUES } from './routes.js';

describe('consumeBatch', () => {
  it('acknowledges what the handler finishes and leaves what it fails or leaves', async () => {
    const queue = new InMemoryQueueConsumer();
    for (const body of ['ok', 'boom', 'later', 'ok-2']) queue.send(QUEUES.files, body);

    const result = await consumeBatch(queue, QUEUES.files, (message) => {
      if (message.body === 'boom') return Promise.reject(new Error('boom'));
      if (message.body === 'later') return Promise.resolve('leave' as const);
      return Promise.resolve('acknowledge' as const);
    });

    expect(result).toEqual({ received: 4, acknowledged: 2, failed: 1, left: 1 });
    expect(queue.pending(QUEUES.files)).toBe(2);
  });

  it('redelivers an unacknowledged message (at least once)', async () => {
    const queue = new InMemoryQueueConsumer();
    const sent = queue.send(QUEUES.files, 'x');
    let attempts = 0;
    const handler = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('first try fails'))
        : Promise.resolve('acknowledge' as const);
    };
    await consumeBatch(queue, QUEUES.files, handler);
    expect(queue.pending(QUEUES.files)).toBe(1);
    queue.redeliver(QUEUES.files);
    await consumeBatch(queue, QUEUES.files, handler);
    expect(queue.pending(QUEUES.files)).toBe(0);
    expect(queue.deliveries.get(sent.id)).toBe(2);
  });

  it('does not hand a message to two receivers before it is redelivered', async () => {
    const queue = new InMemoryQueueConsumer();
    queue.send(QUEUES.files, 'x');
    expect(await queue.receive(QUEUES.files)).toHaveLength(1);
    expect(await queue.receive(QUEUES.files)).toHaveLength(0);
  });
});

describe('SqsQueueConsumer', () => {
  it('receives with the queue URL, a bounded batch and wait, and acknowledges by receipt handle', async () => {
    const send = vi.fn((command: ReceiveMessageCommand | DeleteMessageCommand) => {
      if (command instanceof ReceiveMessageCommand) {
        return Promise.resolve({
          Messages: [
            { MessageId: 'a', Body: '{"x":1}', ReceiptHandle: 'r1' },
            { MessageId: 'incomplete' },
          ],
        });
      }
      return Promise.resolve({});
    });
    const client: SqsReceiver = { send };
    const consumer = new SqsQueueConsumer(client, { [QUEUES.files]: 'http://q/lc-files' });

    const messages = await consumer.receive(QUEUES.files, { maxMessages: 50, waitSeconds: 99 });
    expect(messages).toEqual<QueueMessage[]>([{ id: 'a', body: '{"x":1}', receiptHandle: 'r1' }]);
    const received = send.mock.calls[0]?.[0] as ReceiveMessageCommand;
    expect(received.input).toMatchObject({
      QueueUrl: 'http://q/lc-files',
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    });

    await consumer.acknowledge(QUEUES.files, messages[0] as QueueMessage);
    const deleted = send.mock.calls[1]?.[0] as DeleteMessageCommand;
    expect(deleted.input).toEqual({ QueueUrl: 'http://q/lc-files', ReceiptHandle: 'r1' });
  });

  it('fails clearly for a queue with no URL', async () => {
    const consumer = new SqsQueueConsumer({ send: vi.fn() }, {});
    await expect(consumer.receive(QUEUES.files)).rejects.toThrow('No URL is configured');
  });
});
