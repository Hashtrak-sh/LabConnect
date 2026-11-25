/**
 * The only source of "now" for platform code (AUDIT_AND_EVENT_ARCHITECTURE.md section 4,
 * TESTING_STRATEGY.md section 6). Nothing else in packages/core reads the system clock;
 * an ESLint rule enforces it.
 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    // eslint-disable-next-line no-restricted-syntax -- the one place that reads the system clock
    return new Date();
  }
}

/** A clock that only moves when the test says so. */
export class FixedClock implements Clock {
  private current: number;

  constructor(initial: Date | string | number) {
    this.current = toMillis(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string | number): void {
    this.current = toMillis(instant);
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

/** Alias for tests that read better as `new TestClock(...)`. */
export { FixedClock as TestClock };

function toMillis(value: Date | string | number): number {
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(millis)) throw new Error('The clock was given an invalid instant.');
  return millis;
}
