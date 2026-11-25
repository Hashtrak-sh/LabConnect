import type { ConsumeResult, DeliveryResult } from '@labconnect/core';
import type { JobLogger, PollingJob } from '../platform/polling-runner.js';

export interface NotificationsConsumerJobDeps {
  /** One pass over `lc-notifications.fifo`. */
  consume: () => Promise<ConsumeResult>;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Turns events from the notifications queue into notification rows. Logs counts only: an event
 * names a booking and the people involved, and nothing about them is logged. A message that failed
 * (or was left behind a failed one of its group) stays on the queue and comes back; the queue's
 * redrive policy moves a message that keeps failing to the dead-letter queue.
 */
export function createNotificationsConsumerJob(deps: NotificationsConsumerJobDeps): PollingJob {
  return {
    name: 'notifications-consumer',
    intervalMs: deps.intervalMs,
    async run() {
      const result = await deps.consume();
      if (result.failed > 0 || result.left > 0) {
        deps.logger.error(
          `notifications queue: ${String(result.failed)} messages failed, ${String(result.left)} left, ${String(result.acknowledged)} done`,
        );
      } else if (result.received > 0) {
        deps.logger.info(`notifications queue: ${String(result.acknowledged)} events processed`);
      }
    },
  };
}

export interface EmailDeliveryJobDeps {
  /** One pass of `runEmailDeliveries`. */
  deliver: () => Promise<DeliveryResult>;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Sends the emails that notification rows wait for. Logs counts only, never an address, a
 * subject or a body. An email that failed for the last time is logged as an error, so the alert on
 * "failed deliveries above the threshold" (NOTIFICATIONS.md section 1) has something to match.
 */
export function createEmailDeliveryJob(deps: EmailDeliveryJobDeps): PollingJob {
  return {
    name: 'email-delivery',
    intervalMs: deps.intervalMs,
    async run() {
      const result = await deps.deliver();
      if (result.failed > 0) {
        deps.logger.error(
          `email delivery: ${String(result.failed)} failed for good, ${String(result.retried)} to retry, ${String(result.sent)} sent`,
        );
      } else if (result.sent + result.retried + result.suppressed > 0) {
        deps.logger.info(
          `email delivery: ${String(result.sent)} sent, ${String(result.retried)} to retry, ${String(result.suppressed)} not sent`,
        );
      }
    },
  };
}
