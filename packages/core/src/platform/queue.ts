import type { EventEnvelope } from './events.js';
import type { QueueName } from './routes.js';

/** Where the relay sends events. The SQS adapter is the real one; tests use the in-memory one. */
export interface QueuePublisher {
  publish(queue: QueueName, envelope: EventEnvelope): Promise<void>;
}

export interface PublishedMessage {
  queue: QueueName;
  envelope: EventEnvelope;
}

/** Keeps what it was given, in order. `failWith` makes chosen messages fail, for retry tests. */
export class InMemoryQueuePublisher implements QueuePublisher {
  readonly published: PublishedMessage[] = [];

  constructor(
    private readonly failWith?: (queue: QueueName, envelope: EventEnvelope) => Error | undefined,
  ) {}

  publish(queue: QueueName, envelope: EventEnvelope): Promise<void> {
    const failure = this.failWith?.(queue, envelope);
    if (failure) return Promise.reject(failure);
    this.published.push({ queue, envelope });
    return Promise.resolve();
  }
}
