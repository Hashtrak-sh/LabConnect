import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { QueueName } from './routes.js';
import { type QueueUrls, queueUrlsFromEnv } from './sqs-publisher.js';

/** A message taken from a queue. `body` is what the publisher sent (the JSON envelope). */
export interface QueueMessage {
  /** The queue's own id for the message. */
  id: string;
  body: string;
  /** What `acknowledge` needs. Opaque. */
  receiptHandle: string;
}

export interface ReceiveOptions {
  /** At most 10 (the SQS limit). Default 10. */
  maxMessages?: number;
  /** Long-poll wait, in seconds. Default 0 (return at once), so a polling job never blocks its runner. */
  waitSeconds?: number;
}

/**
 * Where consumers read messages from: the other half of `QueuePublisher`. At-least-once, like
 * SQS: a received message that is not acknowledged is delivered again after its visibility
 * timeout, so consumers deduplicate on the event id (`processOnce`).
 */
export interface QueueConsumer {
  receive(queue: QueueName, options?: ReceiveOptions): Promise<QueueMessage[]>;
  /** Removes the message for good. Only call it once the work is committed. */
  acknowledge(queue: QueueName, message: QueueMessage): Promise<void>;
}

/** What a handler decides about a message it did not fail on. */
export type MessageDisposition = 'acknowledge' | 'leave';

export interface ConsumeResult {
  received: number;
  acknowledged: number;
  /** Handler threw: left for redelivery. */
  failed: number;
  /** Handler returned `'leave'`: left for redelivery, not an error. */
  left: number;
}

/**
 * One pass of a consumer: receives a batch and runs `handler` on each message in turn. A
 * message is acknowledged only when the handler returns `'acknowledge'`; if it
 * throws, or returns `'leave'`, the message stays on the queue and comes back after its
 * visibility timeout. One message's failure does not stop the others. Errors are counted, not
 * rethrown, and never logged here, because a message body may hold tenant data.
 */
export async function consumeBatch(
  consumer: QueueConsumer,
  queue: QueueName,
  handler: (message: QueueMessage) => Promise<MessageDisposition>,
  options: ReceiveOptions = {},
): Promise<ConsumeResult> {
  const messages = await consumer.receive(queue, options);
  const result: ConsumeResult = { received: messages.length, acknowledged: 0, failed: 0, left: 0 };
  for (const message of messages) {
    let disposition: MessageDisposition;
    try {
      disposition = await handler(message);
    } catch {
      result.failed += 1;
      continue;
    }
    if (disposition === 'leave') {
      result.left += 1;
      continue;
    }
    await consumer.acknowledge(queue, message);
    result.acknowledged += 1;
  }
  return result;
}

/**
 * A queue in memory. `send` adds a message; `receive` hands out visible messages and hides
 * them; an unacknowledged one becomes visible again when the test calls `redeliver()`, which
 * stands in for the visibility timeout. `deliveries` counts how often each message was handed
 * out, for redelivery assertions.
 */
export class InMemoryQueueConsumer implements QueueConsumer {
  private readonly visible = new Map<QueueName, QueueMessage[]>();
  private readonly hidden = new Map<QueueName, QueueMessage[]>();
  readonly deliveries = new Map<string, number>();
  private counter = 0;

  send(queue: QueueName, body: string): QueueMessage {
    this.counter += 1;
    const message: QueueMessage = {
      id: `m-${String(this.counter)}`,
      body,
      receiptHandle: `h-${String(this.counter)}`,
    };
    this.list(this.visible, queue).push(message);
    return message;
  }

  receive(queue: QueueName, options: ReceiveOptions = {}): Promise<QueueMessage[]> {
    const limit = Math.min(Math.max(options.maxMessages ?? 10, 1), 10);
    const taken = this.list(this.visible, queue).splice(0, limit);
    this.list(this.hidden, queue).push(...taken);
    for (const message of taken) {
      this.deliveries.set(message.id, (this.deliveries.get(message.id) ?? 0) + 1);
    }
    return Promise.resolve(taken);
  }

  acknowledge(queue: QueueName, message: QueueMessage): Promise<void> {
    const hidden = this.list(this.hidden, queue);
    const index = hidden.findIndex(
      (candidate) => candidate.receiptHandle === message.receiptHandle,
    );
    if (index >= 0) hidden.splice(index, 1);
    return Promise.resolve();
  }

  /** Makes every unacknowledged message of the queue visible again, as a visibility timeout would. */
  redeliver(queue: QueueName): void {
    this.list(this.visible, queue).push(...this.list(this.hidden, queue).splice(0));
  }

  /** Messages not yet acknowledged, visible or not. */
  pending(queue: QueueName): number {
    return this.list(this.visible, queue).length + this.list(this.hidden, queue).length;
  }

  private list(store: Map<QueueName, QueueMessage[]>, queue: QueueName): QueueMessage[] {
    let found = store.get(queue);
    if (!found) {
      found = [];
      store.set(queue, found);
    }
    return found;
  }
}

/** The part of `SQSClient` the consumer uses, so tests can pass a stub. */
export interface SqsReceiver {
  send(command: ReceiveMessageCommand | DeleteMessageCommand): Promise<unknown>;
}

/** Reads from SQS. Queue URLs come from `queueUrlsFromEnv`. */
export class SqsQueueConsumer implements QueueConsumer {
  constructor(
    private readonly client: SqsReceiver,
    private readonly urls: QueueUrls,
  ) {}

  async receive(queue: QueueName, options: ReceiveOptions = {}): Promise<QueueMessage[]> {
    const output = (await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.url(queue),
        MaxNumberOfMessages: Math.min(Math.max(options.maxMessages ?? 10, 1), 10),
        WaitTimeSeconds: Math.min(Math.max(options.waitSeconds ?? 0, 0), 20),
      }),
    )) as { Messages?: { MessageId?: string; Body?: string; ReceiptHandle?: string }[] };
    const messages: QueueMessage[] = [];
    for (const raw of output.Messages ?? []) {
      if (
        raw.MessageId === undefined ||
        raw.Body === undefined ||
        raw.ReceiptHandle === undefined
      ) {
        continue;
      }
      messages.push({ id: raw.MessageId, body: raw.Body, receiptHandle: raw.ReceiptHandle });
    }
    return messages;
  }

  async acknowledge(queue: QueueName, message: QueueMessage): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.url(queue), ReceiptHandle: message.receiptHandle }),
    );
  }

  private url(queue: QueueName): string {
    const url = this.urls[queue];
    if (!url) throw new Error(`No URL is configured for queue ${queue}.`);
    return url;
  }
}

/** The SQS consumer the worker uses: region, credentials and endpoint come from the environment when the first call is made. */
export function createSqsConsumerFromEnv(
  env: Record<string, string | undefined> = process.env,
): SqsQueueConsumer {
  return new SqsQueueConsumer(new SQSClient({}), queueUrlsFromEnv(env));
}
