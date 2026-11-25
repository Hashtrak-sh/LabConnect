import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock, TestClock } from './clock.js';

describe('FixedClock', () => {
  it('stands still until told to move', () => {
    const clock = new FixedClock('2026-11-25T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-11-25T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-11-25T10:00:00.000Z');
  });

  it('advances and is settable', () => {
    const clock = new TestClock(0);
    clock.advance(1500);
    expect(clock.now().getTime()).toBe(1500);
    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('hands out copies, so a caller cannot move the clock by mutating a Date', () => {
    const clock = new FixedClock(1000);
    clock.now().setTime(5);
    expect(clock.now().getTime()).toBe(1000);
  });

  it('rejects an invalid instant', () => {
    expect(() => new FixedClock('not a date')).toThrow();
  });
});

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now(); // eslint-disable-line no-restricted-syntax -- a test of the real clock
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now - before).toBeLessThan(5000);
  });
});
