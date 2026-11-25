/** Where timers come from. The real one is `setInterval`; tests drive a fake. */
export interface Scheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemScheduler: Scheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export interface JobLogger {
  info(message: string): void;
  /** Never pass payloads, tokens or other secrets. */
  error(message: string): void;
}

export interface PollingJob {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
  /** Run once as soon as the runner starts, not only after the first interval. */
  runOnStart?: boolean;
}

/**
 * Runs jobs on fixed intervals. A job never overlaps itself: if a run is still going when
 * the next tick arrives, the tick is skipped. A job that throws is logged and runs again
 * on the next tick; one job's failure does not affect the others. `stop()` ends the
 * timers and waits for runs in progress, so shutdown is graceful.
 */
export class PollingRunner {
  private readonly handles: unknown[] = [];
  private readonly inFlight = new Map<string, Promise<void>>();
  private started = false;

  constructor(
    private readonly jobs: PollingJob[],
    private readonly scheduler: Scheduler,
    private readonly logger: JobLogger,
  ) {
    for (const job of jobs) {
      if (!Number.isFinite(job.intervalMs) || job.intervalMs < 1) {
        throw new RangeError(`Job ${job.name}: intervalMs must be a positive number.`);
      }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const job of this.jobs) {
      this.handles.push(this.scheduler.setInterval(() => void this.tick(job), job.intervalMs));
      if (job.runOnStart) void this.tick(job);
    }
  }

  async stop(): Promise<void> {
    for (const handle of this.handles.splice(0)) this.scheduler.clearInterval(handle);
    this.started = false;
    await Promise.all([...this.inFlight.values()]);
  }

  /** Runs one job now, unless it is already running. Resolves when that run ends. */
  tick(job: PollingJob): Promise<void> {
    const running = this.inFlight.get(job.name);
    if (running) return Promise.resolve();
    const run = (async () => {
      try {
        await job.run();
      } catch (error) {
        this.logger.error(`Job ${job.name} failed: ${describe(error)}`);
      } finally {
        this.inFlight.delete(job.name);
      }
    })();
    this.inFlight.set(job.name, run);
    return run;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}
