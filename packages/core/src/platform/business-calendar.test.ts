import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  InvalidWorkingHoursError,
  istDateKey,
  minutesFromTimeColumn,
  NoWorkingTimeError,
  parseTimeOfDay,
  type ClosedDays,
  type WeeklyHours,
} from './business-calendar.js';

// 2026-11-23 is a Monday. Hours: Monday to Friday 09:00-18:00, Saturday 09:00-13:00, Sunday closed.
const weekday = [{ opensAtMinute: 9 * 60, closesAtMinute: 18 * 60 }];
const HOURS: WeeklyHours = {
  1: weekday,
  2: weekday,
  3: weekday,
  4: weekday,
  5: weekday,
  6: [{ opensAtMinute: 9 * 60, closesAtMinute: 13 * 60 }],
};
const calendar = (closed?: ClosedDays, hours: WeeklyHours = HOURS) =>
  new BusinessCalendar(hours, closed);

/** An IST wall-clock time as the UTC instant. `ist('2026-11-25 10:00')`. */
const ist = (text: string): Date => new Date(`${text.replace(' ', 'T')}:00+05:30`);
/** The instant as an IST wall-clock string, for readable assertions. */
const show = (instant: Date): string =>
  new Date(instant.getTime() + 19_800_000).toISOString().slice(0, 16).replace('T', ' ');

describe('IST date helpers', () => {
  it('uses the IST date, not the UTC date', () => {
    // 18:30 UTC is already the next day in IST; 18:29 UTC is not.
    expect(istDateKey(new Date('2026-11-25T18:29:59Z'))).toBe('2026-11-25');
    expect(istDateKey(new Date('2026-11-25T18:30:00Z'))).toBe('2026-11-26');
    expect(istDateKey(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
    expect(istDateKey(new Date('1969-12-31T18:30:00Z'))).toBe('1970-01-01');
  });

  it('parses times of day and time columns', () => {
    expect(parseTimeOfDay('09:30')).toBe(570);
    expect(parseTimeOfDay('18:00:00')).toBe(1080);
    expect(parseTimeOfDay('24:00')).toBe(1440);
    expect(() => parseTimeOfDay('24:01')).toThrow(InvalidWorkingHoursError);
    expect(() => parseTimeOfDay('9:30')).toThrow(InvalidWorkingHoursError);
    expect(minutesFromTimeColumn(new Date('1970-01-01T09:30:00Z'))).toBe(570);
  });
});

describe('construction', () => {
  it.each([
    [
      'an interval that opens and closes together (a zero-length day)',
      { 1: [{ opensAtMinute: 600, closesAtMinute: 600 }] },
    ],
    [
      'an interval that closes before it opens',
      { 1: [{ opensAtMinute: 700, closesAtMinute: 600 }] },
    ],
    ['a closing time after midnight', { 1: [{ opensAtMinute: 600, closesAtMinute: 1441 }] }],
    ['a negative opening time', { 1: [{ opensAtMinute: -1, closesAtMinute: 600 }] }],
    ['a fractional minute', { 1: [{ opensAtMinute: 600.5, closesAtMinute: 700 }] }],
    [
      'overlapping intervals',
      {
        1: [
          { opensAtMinute: 540, closesAtMinute: 720 },
          { opensAtMinute: 700, closesAtMinute: 800 },
        ],
      },
    ],
  ] as [string, WeeklyHours][])('rejects %s', (_name, hours) => {
    expect(() => calendar(undefined, { ...HOURS, ...hours })).toThrow(InvalidWorkingHoursError);
  });

  it('rejects a week with no working time', () => {
    expect(() => new BusinessCalendar({})).toThrow(NoWorkingTimeError);
    expect(() => new BusinessCalendar({ 1: [], 2: [] })).toThrow(NoWorkingTimeError);
  });

  it('rejects bad closed dates and ranges', () => {
    expect(() => calendar({ dates: ['2026-13-01'] })).toThrow(InvalidWorkingHoursError);
    expect(() => calendar({ dates: ['26-11-2026'] })).toThrow(InvalidWorkingHoursError);
    expect(() => calendar({ ranges: [{ startsOn: '2026-11-10', endsOn: '2026-11-09' }] })).toThrow(
      InvalidWorkingHoursError,
    );
  });

  it('accepts adjacent intervals and sorts them', () => {
    const c = calendar(undefined, {
      ...HOURS,
      3: [
        { opensAtMinute: 780, closesAtMinute: 1080 },
        { opensAtMinute: 540, closesAtMinute: 780 },
      ],
    });
    expect(show(c.addBusinessMinutes(ist('2026-11-25 12:00'), 120))).toBe('2026-11-25 14:00');
  });
});

describe('isWithinBusinessHours and working dates', () => {
  it.each([
    ['2026-11-25 10:00', true],
    ['2026-11-25 09:00', true],
    ['2026-11-25 08:59', false],
    ['2026-11-25 17:59', true],
    ['2026-11-25 18:00', false],
    ['2026-11-28 12:59', true],
    ['2026-11-28 13:00', false],
    ['2026-11-29 11:00', false],
  ])('%s -> %s', (text, expected) => {
    expect(calendar().isWithinBusinessHours(ist(text))).toBe(expected);
  });

  it('reads the hours in IST: 03:30 UTC is 09:00 and 12:29 UTC is 17:59', () => {
    expect(calendar().isWithinBusinessHours(new Date('2026-11-25T03:29:00Z'))).toBe(false);
    expect(calendar().isWithinBusinessHours(new Date('2026-11-25T03:30:00Z'))).toBe(true);
    expect(calendar().isWithinBusinessHours(new Date('2026-11-25T12:29:00Z'))).toBe(true);
    expect(calendar().isWithinBusinessHours(new Date('2026-11-25T12:30:00Z'))).toBe(false);
  });

  it('is closed on a holiday, inside a closure, and on a day without hours', () => {
    const c = calendar({
      dates: ['2026-11-26'],
      ranges: [{ startsOn: new Date('2026-12-01T00:00:00Z'), endsOn: '2026-12-03' }],
    });
    expect(c.isWithinBusinessHours(ist('2026-11-26 10:00'))).toBe(false);
    expect(c.isClosedDate('2026-11-26')).toBe(true);
    expect(c.isWorkingDate('2026-11-26')).toBe(false);
    for (const date of ['2026-12-01', '2026-12-02', '2026-12-03']) {
      expect(c.isClosedDate(date)).toBe(true);
    }
    expect(c.isClosedDate('2026-12-04')).toBe(false);
    expect(c.isWorkingDate('2026-12-04')).toBe(true);
    expect(c.isWorkingDate('2026-11-29')).toBe(false);
  });
});

describe('nextOpening', () => {
  it.each([
    ['inside hours: unchanged', '2026-11-25 10:00', '2026-11-25 10:00'],
    ['before opening', '2026-11-25 07:00', '2026-11-25 09:00'],
    ['exactly at closing', '2026-11-25 18:00', '2026-11-26 09:00'],
    ['after closing', '2026-11-25 20:00', '2026-11-26 09:00'],
    ['Friday evening', '2026-11-27 19:00', '2026-11-28 09:00'],
    ['Saturday afternoon', '2026-11-28 14:00', '2026-11-30 09:00'],
    ['Sunday', '2026-11-29 10:00', '2026-11-30 09:00'],
  ])('%s', (_name, start, expected) => {
    expect(show(calendar().nextOpening(ist(start)))).toBe(expected);
  });

  it('skips holidays and closures', () => {
    const c = calendar({
      dates: ['2026-11-30'],
      ranges: [{ startsOn: '2026-12-01', endsOn: '2026-12-02' }],
    });
    expect(show(c.nextOpening(ist('2026-11-28 14:00')))).toBe('2026-12-03 09:00');
  });

  it('finds the opening on the IST day when UTC is still the day before', () => {
    // 2026-11-29T20:00Z is Monday 01:30 IST.
    expect(show(calendar().nextOpening(new Date('2026-11-29T20:00:00Z')))).toBe('2026-11-30 09:00');
  });

  it('throws, and does not loop, when every day is closed', () => {
    const c = calendar({ ranges: [{ startsOn: '2026-01-01', endsOn: '2045-12-31' }] });
    expect(() => c.nextOpening(ist('2026-11-25 10:00'))).toThrow(NoWorkingTimeError);
    expect(() => c.addBusinessMinutes(ist('2026-11-25 10:00'), 60)).toThrow(NoWorkingTimeError);
    expect(() => c.addWorkingDays(ist('2026-11-25 10:00'), 1)).toThrow(NoWorkingTimeError);
  });
});

describe('addBusinessMinutes', () => {
  it.each([
    ['inside one day', '2026-11-25 10:00', 240, '2026-11-25 14:00'],
    ['ending exactly at closing time', '2026-11-25 14:00', 240, '2026-11-25 18:00'],
    [
      'one minute past closing goes to the next morning',
      '2026-11-25 14:00',
      241,
      '2026-11-26 09:01',
    ],
    ['crossing the evening', '2026-11-25 16:00', 240, '2026-11-26 11:00'],
    ['starting before opening', '2026-11-25 07:00', 240, '2026-11-25 13:00'],
    ['starting after closing', '2026-11-25 20:00', 240, '2026-11-26 13:00'],
    ['starting exactly at closing', '2026-11-25 18:00', 60, '2026-11-26 10:00'],
    ['starting exactly at opening', '2026-11-25 09:00', 60, '2026-11-25 10:00'],
    ['Friday into the short Saturday', '2026-11-27 17:00', 240, '2026-11-28 12:00'],
    ['Saturday into Monday', '2026-11-28 12:00', 120, '2026-11-30 10:00'],
    ['starting on Sunday', '2026-11-29 10:00', 60, '2026-11-30 10:00'],
    ['a full week of hours', '2026-11-23 09:00', 5 * 540 + 240, '2026-11-28 13:00'],
    ['a day and a half', '2026-11-25 09:00', 810, '2026-11-26 13:30'],
  ])('%s', (_name, start, minutes, expected) => {
    expect(show(calendar().addBusinessMinutes(ist(start), minutes))).toBe(expected);
  });

  it('returns the start unchanged for zero, even outside hours', () => {
    const start = ist('2026-11-29 03:00');
    expect(calendar().addBusinessMinutes(start, 0).getTime()).toBe(start.getTime());
  });

  it('keeps fractions of a minute', () => {
    const result = calendar().addBusinessMinutes(ist('2026-11-25 10:00'), 0.5);
    expect(result.getTime() - ist('2026-11-25 10:00').getTime()).toBe(30_000);
  });

  it('does not mutate its input', () => {
    const start = ist('2026-11-25 10:00');
    const before = start.getTime();
    calendar().addBusinessMinutes(start, 600);
    expect(start.getTime()).toBe(before);
  });

  it('skips a holiday', () => {
    const c = calendar({ dates: ['2026-11-30'] });
    expect(show(c.addBusinessMinutes(ist('2026-11-28 12:00'), 120))).toBe('2026-12-01 10:00');
  });

  it('skips a closure that spans several days, including the weekend after it', () => {
    const c = calendar({ ranges: [{ startsOn: '2026-11-26', endsOn: '2026-11-28' }] });
    expect(show(c.addBusinessMinutes(ist('2026-11-25 17:00'), 120))).toBe('2026-11-30 10:00');
  });

  it('crosses a closure of many weeks', () => {
    const c = calendar({ ranges: [{ startsOn: '2026-11-26', endsOn: '2027-01-31' }] });
    expect(show(c.addBusinessMinutes(ist('2026-11-25 17:30'), 60))).toBe('2027-02-01 09:30');
  });

  it('counts only the open parts of a split shift', () => {
    const c = calendar(undefined, {
      ...HOURS,
      3: [
        { opensAtMinute: 540, closesAtMinute: 780 },
        { opensAtMinute: 840, closesAtMinute: 1080 },
      ],
    });
    expect(show(c.addBusinessMinutes(ist('2026-11-25 12:00'), 240))).toBe('2026-11-25 17:00');
    expect(show(c.addBusinessMinutes(ist('2026-11-25 13:30'), 30))).toBe('2026-11-25 14:30');
  });

  it('handles a lab that is open around the clock, across the IST and UTC midnights', () => {
    const allDay = [{ opensAtMinute: 0, closesAtMinute: 1440 }];
    const c = calendar(undefined, {
      1: allDay,
      2: allDay,
      3: allDay,
      4: allDay,
      5: allDay,
      6: allDay,
      7: allDay,
    });
    expect(show(c.addBusinessMinutes(ist('2026-11-25 23:00'), 120))).toBe('2026-11-26 01:00');
    const utc = c.addBusinessMinutes(new Date('2026-11-25T18:00:00Z'), 60);
    expect(utc.toISOString()).toBe('2026-11-25T19:00:00.000Z');
  });

  it('handles the year end and a leap day', () => {
    expect(show(calendar().addBusinessMinutes(ist('2026-12-31 17:30'), 60))).toBe(
      '2027-01-01 09:30',
    );
    // 2028-02-29 is a Tuesday.
    expect(show(calendar().addBusinessMinutes(ist('2028-02-29 17:00'), 120))).toBe(
      '2028-03-01 10:00',
    );
  });

  it('rejects a negative or non-finite duration', () => {
    expect(() => calendar().addBusinessMinutes(ist('2026-11-25 10:00'), -1)).toThrow(RangeError);
    expect(() => calendar().addBusinessMinutes(ist('2026-11-25 10:00'), Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => calendar().addBusinessMinutes(new Date('nope'), 5)).toThrow(RangeError);
  });

  it('adds hours', () => {
    expect(show(calendar().addBusinessHours(ist('2026-11-25 10:00'), 4))).toBe('2026-11-25 14:00');
  });
});

describe('addWorkingDays', () => {
  it.each([
    ['one day', '2026-11-25 10:00', 1, '2026-11-26 10:00'],
    ['two days', '2026-11-25 10:00', 2, '2026-11-27 10:00'],
    ['Friday to the working Saturday', '2026-11-27 10:00', 1, '2026-11-28 10:00'],
    ['Saturday to Monday (Sunday is not a working day)', '2026-11-28 10:00', 1, '2026-11-30 10:00'],
    ['from a Sunday', '2026-11-29 11:00', 1, '2026-11-30 11:00'],
    [
      'a time after closing on the landing day moves back to closing',
      '2026-11-25 20:00',
      1,
      '2026-11-26 18:00',
    ],
    [
      'a time before opening on the landing day moves to opening',
      '2026-11-25 07:00',
      1,
      '2026-11-26 09:00',
    ],
    ['landing on the short Saturday after its closing', '2026-11-27 16:00', 1, '2026-11-28 13:00'],
    ['a week of working days', '2026-11-23 10:00', 6, '2026-11-30 10:00'],
  ])('%s', (_name, start, days, expected) => {
    expect(show(calendar().addWorkingDays(ist(start), days))).toBe(expected);
  });

  it('skips holidays and closures', () => {
    const c = calendar({
      dates: ['2026-11-26'],
      ranges: [{ startsOn: '2026-11-28', endsOn: '2026-11-30' }],
    });
    expect(show(c.addWorkingDays(ist('2026-11-25 10:00'), 1))).toBe('2026-11-27 10:00');
    expect(show(c.addWorkingDays(ist('2026-11-25 10:00'), 2))).toBe('2026-12-01 10:00');
  });

  it('moves a time that falls in the gap of a split shift back to the earlier closing', () => {
    const c = calendar(undefined, {
      ...HOURS,
      4: [
        { opensAtMinute: 540, closesAtMinute: 780 },
        { opensAtMinute: 840, closesAtMinute: 1080 },
      ],
    });
    expect(show(c.addWorkingDays(ist('2026-11-25 13:30'), 1))).toBe('2026-11-26 13:00');
    expect(show(c.addWorkingDays(ist('2026-11-25 15:00'), 1))).toBe('2026-11-26 15:00');
  });

  it('returns the start for zero and rejects fractions and negatives', () => {
    const start = ist('2026-11-29 03:00');
    expect(calendar().addWorkingDays(start, 0).getTime()).toBe(start.getTime());
    expect(() => calendar().addWorkingDays(start, 1.5)).toThrow(RangeError);
    expect(() => calendar().addWorkingDays(start, -1)).toThrow(RangeError);
  });

  it('uses the IST day: 20:00 UTC on Sunday is already Monday in IST', () => {
    const start = new Date('2026-11-29T20:00:00Z'); // Monday 01:30 IST
    expect(show(calendar().addWorkingDays(start, 1))).toBe('2026-12-01 09:00');
  });
});

describe('business time between instants', () => {
  it.each([
    ['inside one day', '2026-11-25 10:00', '2026-11-25 12:00', 120],
    ['over an evening', '2026-11-25 17:00', '2026-11-26 10:00', 120],
    ['over a weekend', '2026-11-27 17:00', '2026-11-30 10:00', 60 + 240 + 60],
    ['all outside hours', '2026-11-25 19:00', '2026-11-26 08:00', 0],
    ['a whole working day', '2026-11-25 00:00', '2026-11-26 00:00', 540],
    ['to before from', '2026-11-25 12:00', '2026-11-25 10:00', 0],
    ['an empty interval', '2026-11-25 12:00', '2026-11-25 12:00', 0],
  ])('%s', (_name, from, to, expected) => {
    expect(calendar().businessMinutesBetween(ist(from), ist(to))).toBe(expected);
  });

  it('excludes holidays', () => {
    const c = calendar({ dates: ['2026-11-26'] });
    expect(c.businessMinutesBetween(ist('2026-11-25 17:00'), ist('2026-11-27 10:00'))).toBe(120);
  });

  it('reports the fraction of the SLA that has passed (BR-013)', () => {
    const c = calendar();
    const start = ist('2026-11-25 16:00');
    const due = c.addBusinessMinutes(start, 240); // Thursday 11:00
    expect(show(due)).toBe('2026-11-26 11:00');
    expect(c.fractionElapsed(start, due, ist('2026-11-25 15:00'))).toBe(0);
    expect(c.fractionElapsed(start, due, ist('2026-11-25 18:00'))).toBe(0.5);
    expect(c.fractionElapsed(start, due, ist('2026-11-26 10:36'))).toBe(0.9);
    expect(c.fractionElapsed(start, due, ist('2026-11-27 10:00'))).toBe(1);
    expect(c.fractionElapsed(start, start, start)).toBe(1);
  });

  it('places the 50 % and 90 % reminders in business time', () => {
    const c = calendar();
    const start = ist('2026-11-25 16:00');
    expect(show(c.addBusinessMinutes(start, 240 * 0.5))).toBe('2026-11-25 18:00');
    expect(show(c.addBusinessMinutes(start, 240 * 0.9))).toBe('2026-11-26 10:36');
  });
});

describe('consistency (deterministic pseudo-random cases)', () => {
  it('counting forward and measuring back agree, and the result is never outside hours', () => {
    const closed: ClosedDays = {
      dates: ['2026-11-26', '2026-12-25'],
      ranges: [{ startsOn: '2026-12-05', endsOn: '2026-12-09' }],
    };
    const c = calendar(closed, {
      ...HOURS,
      2: [
        { opensAtMinute: 540, closesAtMinute: 780 },
        { opensAtMinute: 840, closesAtMinute: 1080 },
      ],
    });
    let seed = 12345;
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    const base = ist('2026-11-20 00:00').getTime();
    for (let i = 0; i < 400; i += 1) {
      const start = new Date(base + next(40 * 86_400_000));
      const minutes = 1 + next(3000);
      const due = c.addBusinessMinutes(start, minutes);
      expect(c.businessMinutesBetween(start, due)).toBe(minutes);
      expect(due.getTime()).toBeGreaterThan(start.getTime());
      // The due instant is a closing time or inside business hours.
      const inHours = c.isWithinBusinessHours(due);
      const atClosing = c.isWithinBusinessHours(new Date(due.getTime() - 1));
      expect(inHours || atClosing).toBe(true);
    }
  });
});
