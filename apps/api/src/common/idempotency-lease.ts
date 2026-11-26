import type { Logger } from '@nestjs/common';
import {
  IDEMPOTENCY_HEARTBEAT_INTERVAL_MS,
  IDEMPOTENCY_MAX_LEASE_MS,
  type IdempotencyClaim,
  type IdempotencyService,
} from '@labconnect/core';

/** The heartbeat counts ticks, not wall time, so tests can drive it with fake timers. */
const MAX_TICKS = Math.ceil(IDEMPOTENCY_MAX_LEASE_MS / IDEMPOTENCY_HEARTBEAT_INTERVAL_MS);

/**
 * Keeps the lock of a running handler alive (OQ-198): renews it every
 * `IDEMPOTENCY_HEARTBEAT_INTERVAL_MS`, so only a process that really stopped loses the record.
 *
 * - Starts its timer on construction; `stop()` and `halt()` end it on every exit path.
 * - Uses the latest claim for the next renewal and hands it out through `stop()`, so `complete`
 *   and `abandon` use the renewed claim.
 * - A failed renewal is logged by error name only and retried at the next tick. A lost claim
 *   (`renew` returned `null`) stops the heartbeat: the handler's `complete` then does nothing.
 * - After `IDEMPOTENCY_MAX_LEASE_MS` it stops renewing and logs once, so a hung handler cannot
 *   hold the key for ever; the record is then open to takeover after the normal timeout.
 * Never logs a key, a body or a hash.
 */
export class IdempotencyLease {
  private readonly timer: NodeJS.Timeout;
  private latest: IdempotencyClaim;
  private ticks = 0;
  private stopped = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly service: Pick<IdempotencyService, 'renew'>,
    claim: IdempotencyClaim,
    private readonly logger: Pick<Logger, 'error' | 'warn'>,
  ) {
    this.latest = claim;
    this.timer = setInterval(() => {
      this.tick();
    }, IDEMPOTENCY_HEARTBEAT_INTERVAL_MS);
    // A pending heartbeat must never keep the process alive.
    this.timer.unref();
  }

  /** Ends the timer now. Safe to call more than once, and from a teardown that cannot wait. */
  halt(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  /** Ends the timer, waits for a renewal in flight, and returns the claim to finish with. */
  async stop(): Promise<IdempotencyClaim> {
    this.halt();
    await this.inFlight;
    return this.latest;
  }

  private tick(): void {
    if (this.stopped) return;
    this.ticks += 1;
    if (this.ticks >= MAX_TICKS) {
      this.halt();
      this.logger.warn(
        'An idempotent request outlived its maximum lease; its key is no longer renewed and can be taken over. Move work this long to a background job.',
      );
      return;
    }
    if (this.inFlight) return; // the database is slow: the next tick tries again
    this.inFlight = this.renewOnce().finally(() => {
      this.inFlight = undefined;
    });
  }

  private async renewOnce(): Promise<void> {
    try {
      const next = await this.service.renew(this.latest);
      if (next === null) {
        this.halt();
        this.logger.warn('An idempotency key was taken over while its handler was running.');
      } else {
        this.latest = next;
      }
    } catch (error) {
      this.logger.error(
        `Could not renew an idempotency key (${error instanceof Error ? error.name : 'unknown error'}); retrying at the next heartbeat.`,
      );
    }
  }
}
