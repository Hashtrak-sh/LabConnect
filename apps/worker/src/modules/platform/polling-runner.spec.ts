import { describe, expect, it } from 'vitest';
import {
  type JobLogger,
  type PollingJob,
  PollingRunner,
  type Scheduler,
} from './polling-runner.js';

/** A scheduler that only fires when the test says so. */
class FakeScheduler implements Scheduler {
  readonly timers = new Map<number, { callback: () => void; milliseconds: number }>();
  private next = 1;

  setInterval(callback: () => void, milliseconds: number): number {
    const handle = this.next++;
    this.timers.set(handle, { callback, milliseconds });
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  fire(): void {
    for (const timer of [...this.timers.values()]) timer.callback();
  }
}

function recorder(): JobLogger & { infos: string[]; errors: string[] } {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message) => infos.push(message),
    error: (message) => errors.push(message),
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PollingRunner', () => {
  it('schedules each job at its own interval and runs it on every tick', async () => {
    const scheduler = new FakeScheduler();
    let runs = 0;
    const runner = new PollingRunner(
      [{ name: 'a', intervalMs: 1000, run: () => Promise.resolve(void (runs += 1)) }],
      scheduler,
      recorder(),
    );
    runner.start();
    expect([...scheduler.timers.values()].map((timer) => timer.milliseconds)).toEqual([1000]);
    expect(runs).toBe(0);
    scheduler.fire();
    await flush();
    scheduler.fire();
    await flush();
    expect(runs).toBe(2);
    await runner.stop();
  });

  it('runs a job at once when asked, and ignores a second start', async () => {
    const scheduler = new FakeScheduler();
    let runs = 0;
    const runner = new PollingRunner(
      [
        {
          name: 'a',
          intervalMs: 1000,
          runOnStart: true,
          run: () => Promise.resolve(void (runs += 1)),
        },
      ],
      scheduler,
      recorder(),
    );
    runner.start();
    runner.start();
    await flush();
    expect(runs).toBe(1);
    expect(scheduler.timers.size).toBe(1);
    await runner.stop();
  });

  it('skips a tick while the previous run is still going', async () => {
    const scheduler = new FakeScheduler();
    let release: () => void = () => undefined;
    let started = 0;
    const slow: PollingJob = {
      name: 'slow',
      intervalMs: 10,
      run: () => {
        started += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const runner = new PollingRunner([slow], scheduler, recorder());
    runner.start();
    scheduler.fire();
    scheduler.fire();
    scheduler.fire();
    expect(started).toBe(1);
    release();
    await flush();
    scheduler.fire();
    expect(started).toBe(2);
    release();
    await runner.stop();
  });

  it('logs a failure without secrets and keeps going; other jobs are unaffected', async () => {
    const scheduler = new FakeScheduler();
    const logger = recorder();
    let good = 0;
    let bad = 0;
    const runner = new PollingRunner(
      [
        {
          name: 'bad',
          intervalMs: 1,
          run: () => {
            bad += 1;
            return Promise.reject(new Error('database unavailable'));
          },
        },
        { name: 'good', intervalMs: 1, run: () => Promise.resolve(void (good += 1)) },
      ],
      scheduler,
      logger,
    );
    runner.start();
    scheduler.fire();
    await flush();
    scheduler.fire();
    await flush();
    expect(bad).toBe(2);
    expect(good).toBe(2);
    expect(logger.errors).toEqual([
      'Job bad failed: Error: database unavailable',
      'Job bad failed: Error: database unavailable',
    ]);
    await runner.stop();
  });

  it('stops: clears the timers and waits for a run in progress', async () => {
    const scheduler = new FakeScheduler();
    let release: () => void = () => undefined;
    let finished = false;
    const runner = new PollingRunner(
      [
        {
          name: 'slow',
          intervalMs: 5,
          run: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            finished = true;
          },
        },
      ],
      scheduler,
      recorder(),
    );
    runner.start();
    scheduler.fire();
    const stopped = runner.stop();
    expect(scheduler.timers.size).toBe(0);
    await flush();
    expect(finished).toBe(false);
    release();
    await stopped;
    expect(finished).toBe(true);
    scheduler.fire();
    expect(finished).toBe(true);
  });

  it('rejects an interval that is not a positive number', () => {
    expect(
      () =>
        new PollingRunner(
          [{ name: 'x', intervalMs: 0, run: () => Promise.resolve() }],
          new FakeScheduler(),
          recorder(),
        ),
    ).toThrow(RangeError);
  });
});
