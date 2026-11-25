import {
  consumeBatch,
  type ConsumeResult,
  type MessageDisposition,
  type QueueConsumer,
  type QueueMessage,
  type ReceiveOptions,
} from '../platform/queue-consumer.js';
import { QUEUES } from '../platform/routes.js';
import type { FileScanProcessor } from './scan-processor.js';
import { parseScanResultMessage } from './scanner.js';

/**
 * One message of the `lc-files` queue. A scan result is processed (`FileScanProcessor`) and
 * acknowledged. A message of any other type is left: the queue will also carry validation and
 * stamping messages, and deleting one this consumer does not understand would lose it. A
 * `file.scan_result` message that cannot be used throws, so it is redelivered and ends in the
 * dead-letter queue where someone sees it. A failure of the processing throws too, for the
 * same reason (redelivery is the retry).
 */
export async function handleFilesQueueMessage(
  processor: FileScanProcessor,
  message: QueueMessage,
): Promise<MessageDisposition> {
  const parsed = parseScanResultMessage(message.body);
  if (!parsed) return 'leave';
  await processor.handle(parsed);
  return 'acknowledge';
}

/** One pass over the `lc-files` queue. */
export function consumeFilesQueue(
  consumer: QueueConsumer,
  processor: FileScanProcessor,
  options?: ReceiveOptions,
): Promise<ConsumeResult> {
  return consumeBatch(
    consumer,
    QUEUES.files,
    (message) => handleFilesQueueMessage(processor, message),
    options,
  );
}
