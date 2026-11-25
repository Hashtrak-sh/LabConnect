import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { EventEnvelope } from './events.js';
import type { QueuePublisher } from './queue.js';
import { QUEUES, type QueueName } from './routes.js';

/** The part of `SQSClient` the publisher uses, so tests can pass a stub. */
export interface SqsSender {
  send(command: SendMessageCommand): Promise<unknown>;
}

export type QueueUrls = Partial<Record<QueueName, string>>;

/**
 * Reads queue URLs from the environment: `QUEUE_URL_<NAME>`, where NAME is the queue name
 * in capitals with every other character replaced by `_`, for example
 * `QUEUE_URL_LC_NOTIFICATIONS_FIFO`. Queues without a variable are left out; publishing to
 * one fails, and the relay retries (nothing is dropped).
 */
export function queueUrlsFromEnv(env: Record<string, string | undefined> = process.env): QueueUrls {
  const urls: QueueUrls = {};
  for (const name of Object.values(QUEUES)) {
    const value = env[`QUEUE_URL_${name.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`];
    if (value) urls[name] = value;
  }
  return urls;
}

/**
 * Publishes to SQS. The message body is the JSON envelope. FIFO queues (name ends in
 * `.fifo`) get `MessageGroupId` = the aggregate id, which keeps one aggregate's events in
 * order, and `MessageDeduplicationId` = the event id, so a retry after a lost
 * acknowledgement inside SQS's five-minute window is not delivered twice.
 */
export class SqsQueuePublisher implements QueuePublisher {
  constructor(
    private readonly client: SqsSender,
    private readonly urls: QueueUrls,
  ) {}

  async publish(queue: QueueName, envelope: EventEnvelope): Promise<void> {
    const queueUrl = this.urls[queue];
    if (!queueUrl) throw new Error(`No URL is configured for queue ${queue}.`);
    const fifo = queue.endsWith('.fifo');
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(envelope),
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: envelope.type },
        },
        ...(fifo
          ? { MessageGroupId: envelope.aggregate.id, MessageDeduplicationId: envelope.id }
          : {}),
      }),
    );
  }
}
