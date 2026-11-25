import type { Prisma, PrismaClient } from '@labconnect/database';
import type { Clock } from './clock.js';

/**
 * Business time (BUSINESS_RULES.md BR-012, BR-013, BR-048, BR-081, BR-090, BR-091).
 *
 * Everything here is pure: the calendar is built from a weekly working-hours definition and
 * a set of closed days, and answers questions about instants. All day and clock arithmetic
 * is done in `Asia/Kolkata`, which is a fixed UTC+05:30 offset with no daylight saving, so a
 * constant offset is exact. Results are UTC `Date` values.
 *
 * Module boundary: a lab site's receiving hours and closures belong to the `labs` module
 * (MODULE_BOUNDARIES.md), and platform must not query them. The labs module reads its own
 * tables and passes the result in as `WeeklyHours` and `ClosedDays`; the platform holidays
 * are loaded here (`loadPlatformHolidays`) because `holiday_calendar` is a platform table.
 * The platform has no default working hours: the documents define none (OQ-81).
 *
 * Definitions (OQ-80):
 * - An interval is half-open, `[opensAt, closesAt)`. Business time passes only inside
 *   intervals of a working day. A day is closed if it is a holiday or inside a site closure;
 *   a day with no intervals is not a working day.
 * - "N business hours/minutes" (BR-012) is N of business time counted from the start. If the
 *   start is outside business hours the count begins at the next opening. A count that ends
 *   exactly at a closing time is due at that closing time, not at the next opening.
 * - "N business days" (BR-048, BR-081) is the same wall-clock time of day on the Nth working
 *   day after the start's day (the start's own day is day 0, working or not). If that time
 *   falls outside the landing day's hours it moves back to the closest earlier closing time
 *   (or forward to the opening if it is before the first opening): never later than the
 *   lab's own day.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** Asia/Kolkata is UTC+05:30 all year. */
export const IST_OFFSET_MS = 19_800_000;
const MINUTES_PER_DAY = 1_440;
/** A search never looks further than this many days ahead: ten years. */
const MAX_SCAN_DAYS = 3_660;
const MAX_WALK_STEPS = 100_000;

/** ISO weekday: 1 = Monday ... 7 = Sunday, as `receiving_hours.weekday`. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One opening, in minutes after midnight IST. `closesAtMinute` may be 1440 (midnight). */
export interface WorkingInterval {
  opensAtMinute: number;
  closesAtMinute: number;
}

/** Several intervals on a day are a split shift. A missing or empty day is closed. */
export type WeeklyHours = Partial<Record<IsoWeekday, readonly WorkingInterval[]>>;

/** A date as `YYYY-MM-DD`, or a `Date` read from a `date` column (UTC midnight). */
export type DateInput = string | Date;

export interface ClosedDays {
  /** Single closed dates: holidays and one-day closures. */
  dates?: Iterable<DateInput>;
  /** Inclusive ranges, as `site_closure` rows. */
  ranges?: Iterable<{ startsOn: DateInput; endsOn: DateInput }>;
}

export class InvalidWorkingHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkingHoursError';
  }
}

/** There is no working time at all (or none within ten years), so a duration can never be served. */
export class NoWorkingTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoWorkingTimeError';
  }
}

/** `"09:30"` to minutes after midnight. */
export function parseTimeOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    throw new InvalidWorkingHoursError(`"${value}" is not a time of day (HH:MM).`);
  }
  return hours * 60 + minutes;
}

/** A Postgres `time` column as Prisma returns it (a Date on 1970-01-01, UTC) to minutes after midnight. */
export function minutesFromTimeColumn(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** The IST calendar date of an instant, as `YYYY-MM-DD`. */
export function istDateKey(instant: Date): string {
  return dayKey(dayIndexOf(instant.getTime()));
}

function dayIndexOf(epochMs: number): number {
  return Math.floor((epochMs + IST_OFFSET_MS) / MS_PER_DAY);
}

function dayKey(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 1970-01-01 (day 0) was a Thursday. */
function weekdayOf(dayIndex: number): IsoWeekday {
  const zeroBased = (((dayIndex + 3) % 7) + 7) % 7;
  return (zeroBased + 1) as IsoWeekday;
}

/** The UTC instant at which an IST day starts. */
function dayStartMs(dayIndex: number): number {
  return dayIndex * MS_PER_DAY - IST_OFFSET_MS;
}

function normaliseDate(value: DateInput): string {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new InvalidWorkingHoursError(`"${text}" is not a date (YYYY-MM-DD).`);
  }
  return text;
}

interface Slice {
  openMs: number;
  closeMs: number;
}

export class BusinessCalendar {
  private readonly weekly = new Map<IsoWeekday, Slice[]>();
  private readonly closedDates = new Set<string>();
  private readonly closedRanges: { from: string; to: string }[] = [];

  constructor(hours: WeeklyHours, closed: ClosedDays = {}) {
    for (const weekday of [1, 2, 3, 4, 5, 6, 7] as const) {
      const intervals = [...(hours[weekday] ?? [])].sort(
        (a, b) => a.opensAtMinute - b.opensAtMinute,
      );
      let previousClose = 0;
      for (const interval of intervals) {
        const { opensAtMinute: open, closesAtMinute: close } = interval;
        if (!Number.isInteger(open) || !Number.isInteger(close)) {
          throw new InvalidWorkingHoursError('Opening and closing times are whole minutes.');
        }
        if (open < 0 || close > MINUTES_PER_DAY || close <= open) {
          throw new InvalidWorkingHoursError(
            `Weekday ${String(weekday)}: an interval must open before it closes, within one day.`,
          );
        }
        if (open < previousClose) {
          throw new InvalidWorkingHoursError(
            `Weekday ${String(weekday)}: intervals must not overlap.`,
          );
        }
        previousClose = close;
      }
      this.weekly.set(
        weekday,
        intervals.map((interval) => ({
          openMs: interval.opensAtMinute * MS_PER_MINUTE,
          closeMs: interval.closesAtMinute * MS_PER_MINUTE,
        })),
      );
    }
    if ([...this.weekly.values()].every((slices) => slices.length === 0)) {
      throw new NoWorkingTimeError('The weekly working hours contain no working time.');
    }

    for (const date of closed.dates ?? []) this.closedDates.add(normaliseDate(date));
    for (const range of closed.ranges ?? []) {
      const from = normaliseDate(range.startsOn);
      const to = normaliseDate(range.endsOn);
      if (to < from) throw new InvalidWorkingHoursError('A closure must not end before it starts.');
      this.closedRanges.push({ from, to });
    }
  }

  /** True if the IST date is a holiday or inside a closure. */
  isClosedDate(date: DateInput): boolean {
    return this.closedOn(normaliseDate(date));
  }

  /** True if business time passes on that IST date. */
  isWorkingDate(date: DateInput): boolean {
    const key = normaliseDate(date);
    return this.slicesOn(Math.floor(Date.parse(`${key}T00:00:00Z`) / MS_PER_DAY)).length > 0;
  }

  /** True if the instant is inside an opening of a working day. The closing instant is outside. */
  isWithinBusinessHours(instant: Date): boolean {
    const { day, minuteMs } = this.locate(instant);
    return this.slicesOn(day).some((slice) => minuteMs >= slice.openMs && minuteMs < slice.closeMs);
  }

  /** The instant itself if it is within business hours, otherwise the next opening. */
  nextOpening(instant: Date): Date {
    const { day, minuteMs } = this.locate(instant);
    for (let offset = 0; offset <= MAX_SCAN_DAYS; offset += 1) {
      const current = day + offset;
      for (const slice of this.slicesOn(current)) {
        if (offset === 0) {
          if (minuteMs >= slice.closeMs) continue;
          if (minuteMs >= slice.openMs) return new Date(instant.getTime());
        }
        return new Date(dayStartMs(current) + slice.openMs);
      }
    }
    throw new NoWorkingTimeError('There is no working time within ten years of the start.');
  }

  /**
   * The instant by which `minutes` of business time have passed since `start`. A duration of
   * zero returns `start` unchanged. Fractions of a minute are kept to the millisecond.
   */
  addBusinessMinutes(start: Date, minutes: number): Date {
    if (!Number.isFinite(minutes) || minutes < 0) {
      throw new RangeError('The duration must be a non-negative number of minutes.');
    }
    let remaining = Math.round(minutes * MS_PER_MINUTE);
    if (remaining === 0) return new Date(start.getTime());

    let cursor = this.nextOpening(start);
    for (let step = 0; step < MAX_WALK_STEPS; step += 1) {
      const { day, minuteMs } = this.locate(cursor);
      const slice = this.slicesOn(day).find((s) => minuteMs >= s.openMs && minuteMs < s.closeMs);
      if (!slice) throw new NoWorkingTimeError('The calendar lost its place; this is a bug.');
      const available = slice.closeMs - minuteMs;
      if (remaining <= available) return new Date(cursor.getTime() + remaining);
      remaining -= available;
      cursor = this.nextOpening(new Date(cursor.getTime() + available));
    }
    throw new RangeError('The duration is too long to count in business time.');
  }

  /** `addBusinessMinutes` for a count of hours. */
  addBusinessHours(start: Date, hours: number): Date {
    return this.addBusinessMinutes(start, hours * 60);
  }

  /** See the definition of "N business days" in the file comment. Zero returns `start`. */
  addWorkingDays(start: Date, days: number): Date {
    if (!Number.isInteger(days) || days < 0) {
      throw new RangeError('The number of working days must be a non-negative integer.');
    }
    if (days === 0) return new Date(start.getTime());
    const { day, minuteMs } = this.locate(start);
    let counted = 0;
    for (let offset = 1; offset <= MAX_SCAN_DAYS; offset += 1) {
      const landing = day + offset;
      if (this.slicesOn(landing).length > 0) counted += 1;
      if (counted === days) return new Date(dayStartMs(landing) + this.snap(landing, minuteMs));
    }
    throw new NoWorkingTimeError(
      'There are not enough working days within ten years of the start.',
    );
  }

  /** Business time between two instants, in milliseconds. Zero if `to` is not after `from`. */
  businessMillisBetween(from: Date, to: Date): number {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    if (toMs <= fromMs) return 0;
    let total = 0;
    for (let day = dayIndexOf(fromMs); day <= dayIndexOf(toMs); day += 1) {
      for (const slice of this.slicesOn(day)) {
        const open = dayStartMs(day) + slice.openMs;
        const close = dayStartMs(day) + slice.closeMs;
        total += Math.max(0, Math.min(close, toMs) - Math.max(open, fromMs));
      }
    }
    return total;
  }

  /** `businessMillisBetween` in minutes (for the 50 % and 90 % reminders of BR-013). */
  businessMinutesBetween(from: Date, to: Date): number {
    return this.businessMillisBetween(from, to) / MS_PER_MINUTE;
  }

  /**
   * How much of the business time between `start` and `due` has passed at `now`, from 0 to 1.
   * A due instant that is not after the start counts as fully elapsed.
   */
  fractionElapsed(start: Date, due: Date, now: Date): number {
    const total = this.businessMillisBetween(start, due);
    if (total === 0) return 1;
    return Math.min(1, this.businessMillisBetween(start, now) / total);
  }

  private locate(instant: Date): { day: number; minuteMs: number } {
    const ms = instant.getTime();
    if (Number.isNaN(ms)) throw new RangeError('The instant is not a valid date.');
    const day = dayIndexOf(ms);
    return { day, minuteMs: ms + IST_OFFSET_MS - day * MS_PER_DAY };
  }

  private closedOn(key: string): boolean {
    return this.closedDates.has(key) || this.closedRanges.some((r) => key >= r.from && key <= r.to);
  }

  private slicesOn(day: number): readonly Slice[] {
    if (this.closedOn(dayKey(day))) return [];
    return this.weekly.get(weekdayOf(day)) ?? [];
  }

  /** The time of day on a working day closest to `minuteMs` without being later than it. */
  private snap(day: number, minuteMs: number): number {
    const slices = this.slicesOn(day);
    const first = slices[0];
    if (!first || minuteMs < first.openMs) return first?.openMs ?? minuteMs;
    let result = first.openMs;
    for (const slice of slices) {
      if (minuteMs >= slice.openMs && minuteMs < slice.closeMs) return minuteMs;
      if (minuteMs >= slice.closeMs) result = slice.closeMs;
    }
    return result;
  }
}

/** Reads only the holiday table, so a plain client or a transaction both work. */
export type HolidayDb = Pick<PrismaClient, 'holidayCalendar'> | Prisma.TransactionClient;

export interface HolidayQuery {
  /** The window of instants the calendar will be asked about. */
  from: Date;
  to: Date;
  /**
   * State codes whose regional holidays also apply. National holidays (null region) always
   * do. The labs module knows the site's state; the platform does not (OQ-82).
   */
  regionCodes?: readonly string[];
}

/** The IST dates of the platform's holidays in the window, as `YYYY-MM-DD`. */
export async function loadPlatformHolidays(db: HolidayDb, query: HolidayQuery): Promise<string[]> {
  const first = istDateKey(query.from);
  const last = istDateKey(query.to);
  const rows = await db.holidayCalendar.findMany({
    where: {
      holidayDate: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) },
      OR: [{ regionCode: null }, { regionCode: { in: [...(query.regionCodes ?? [])] } }],
    },
    select: { holidayDate: true },
    orderBy: { holidayDate: 'asc' },
  });
  return [...new Set(rows.map((row) => row.holidayDate.toISOString().slice(0, 10)))];
}

export interface LoadCalendarInput extends HolidayQuery {
  /** The site's receiving hours, read by the labs module. */
  hours: WeeklyHours;
  /** The site's closures, read by the labs module. */
  closures?: Iterable<{ startsOn: DateInput; endsOn: DateInput }>;
}

/** How far ahead of now a calendar knows the platform holidays unless told otherwise. */
export const DEFAULT_CALENDAR_HORIZON_DAYS = 400;

export interface SiteCalendarInput {
  /** The site's receiving hours, read by the labs module. */
  hours: WeeklyHours;
  closures?: Iterable<{ startsOn: DateInput; endsOn: DateInput }>;
  regionCodes?: readonly string[];
  /** Start of the window; defaults to the clock's now. */
  from?: Date;
  /** Days of holidays to load from `from`; defaults to 400. Holidays after that are not known. */
  horizonDays?: number;
}

/**
 * Builds a `BusinessCalendar` for a lab site. The module that owns the hours (labs) reads
 * its tables and calls `forSite`; the platform adds its holidays. The Nest provider in the
 * API wraps this class.
 */
export class BusinessCalendarLoader {
  constructor(private readonly clock: Clock) {}

  forSite(db: HolidayDb, input: SiteCalendarInput): Promise<BusinessCalendar> {
    const from = input.from ?? this.clock.now();
    const days = input.horizonDays ?? DEFAULT_CALENDAR_HORIZON_DAYS;
    return loadBusinessCalendar(db, {
      from,
      to: new Date(from.getTime() + days * MS_PER_DAY),
      hours: input.hours,
      ...(input.closures ? { closures: input.closures } : {}),
      ...(input.regionCodes ? { regionCodes: input.regionCodes } : {}),
    });
  }
}

/** A calendar for one lab site: its hours and closures plus the platform holidays in the window. */
export async function loadBusinessCalendar(
  db: HolidayDb,
  input: LoadCalendarInput,
): Promise<BusinessCalendar> {
  const holidays = await loadPlatformHolidays(db, input);
  return new BusinessCalendar(input.hours, {
    dates: holidays,
    ...(input.closures ? { ranges: input.closures } : {}),
  });
}
