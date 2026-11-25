import {
  consumeBatch,
  type ConsumeResult,
  type MessageDisposition,
  type QueueConsumer,
  type QueueMessage,
  type ReceiveOptions,
} from '../platform/queue-consumer.js';
import { QUEUES } from '../platform/routes.js';
import { type GuardDutyMalwareScanner, isGuardDutyEvent } from './guardduty.js';
import type { FileScanProcessor } from './scan-processor.js';
import { parseScanResultMessage } from './scanner.js';

export interface FilesQueueHandling {
  /**
   * The GuardDuty adapter. Without it a GuardDuty event is left on the queue (it is not a
   * message this consumer is set up to understand).
   */
  guardDuty?: GuardDutyMalwareScanner;
  /**
   * Accept the platform's own `file.scan_result` envelope (the dev path, with the fake
   * scanner). Default `true`. The worker sets it to `false` when the scanner is GuardDuty, so
   * that nothing but GuardDuty's result can mark a file clean in production; the envelope is
   * then left like any message of an unknown type.
   */
  acceptPlatformEnvelope?: boolean;
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * One message of the `lc-files` queue. It is either a GuardDuty "Object Scan Result" event
 * (EventBridge to SQS with no input transformer, so the body is the event; told apart by its
 * `source` of `aws.guardduty`) or the platform's `file.scan_result` envelope. A scan result is
 * processed (`FileScanProcessor`) and acknowledged; a GuardDuty result for another bucket or
 * prefix is acknowledged and ignored (counted by the adapter). A message of any other type is
 * left: the queue will also carry validation and stamping messages, and deleting one this
 * consumer does not understand would lose it. A scan result that cannot be used (an envelope
 * that is incomplete, a GuardDuty event that is not the documented structure) throws, so it is
 * redelivered and ends in the dead-letter queue where someone sees it. A failure of the
 * processing throws too, for the same reason (redelivery is the retry).
 */
export async function handleFilesQueueMessage(
  processor: FileScanProcessor,
  message: QueueMessage,
  handling: FilesQueueHandling = {},
): Promise<MessageDisposition> {
  const json = parseJson(message.body);
  if (isGuardDutyEvent(json)) {
    if (!handling.guardDuty) return 'leave';
    const outcome = handling.guardDuty.toScanMessage(json);
    if (outcome.kind === 'other') return 'leave';
    if (outcome.kind === 'ignored') return 'acknowledge';
    await processor.handle(outcome.message);
    return 'acknowledge';
  }

  const parsed = parseScanResultMessage(message.body);
  if (!parsed) return 'leave';
  if (handling.acceptPlatformEnvelope === false) return 'leave';
  await processor.handle(parsed);
  return 'acknowledge';
}

/** One pass over the `lc-files` queue. */
export function consumeFilesQueue(
  consumer: QueueConsumer,
  processor: FileScanProcessor,
  options?: ReceiveOptions,
  handling?: FilesQueueHandling,
): Promise<ConsumeResult> {
  return consumeBatch(
    consumer,
    QUEUES.files,
    (message) => handleFilesQueueMessage(processor, message, handling),
    options,
  );
}
