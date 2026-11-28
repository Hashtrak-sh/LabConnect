import { Prisma } from '@labconnect/database';
import {
  type BusinessCalendar,
  BusinessCalendarLoader,
  type IsoWeekday,
  minutesFromTimeColumn,
  type WorkingInterval,
} from '../platform/business-calendar.js';
import type { Clock } from '../platform/clock.js';

// The labs side of the booking engine's `WorkingHoursProvider` port (OQ-96, decided 2026-11-29):
// a site's receiving hours and closures, read here because labs owns those tables, with the
// platform holidays that are national or of the site's state added by the platform loader.

/** The calendar of a lab site for the next 400 days. */
export function labWorkingHours(clock: Clock): {
  calendarForSite(tx: Prisma.TransactionClient, labSiteId: string): Promise<BusinessCalendar>;
} {
  const loader = new BusinessCalendarLoader(clock);
  return {
    async calendarForSite(
      tx: Prisma.TransactionClient,
      labSiteId: string,
    ): Promise<BusinessCalendar> {
      const rows = await tx.$queryRaw<{ weekday: number; opens_at: Date; closes_at: Date }[]>(
        Prisma.sql`SELECT weekday, opens_at, closes_at FROM receiving_hours
                    WHERE lab_site_id = ${labSiteId}::uuid ORDER BY weekday, opens_at`,
      );
      const hours: Partial<Record<IsoWeekday, WorkingInterval[]>> = {};
      for (const row of rows) {
        const weekday = row.weekday as IsoWeekday;
        (hours[weekday] ??= []).push({
          opensAtMinute: minutesFromTimeColumn(row.opens_at),
          closesAtMinute: minutesFromTimeColumn(row.closes_at),
        });
      }
      const closures = await tx.$queryRaw<{ starts_on: Date; ends_on: Date }[]>(
        Prisma.sql`SELECT starts_on, ends_on FROM site_closure
                    WHERE lab_site_id = ${labSiteId}::uuid AND ends_on >= CURRENT_DATE`,
      );
      const site = await tx.$queryRaw<{ state_code: string }[]>(
        Prisma.sql`SELECT state_code FROM lab_site WHERE id = ${labSiteId}::uuid`,
      );
      return loader.forSite(tx, {
        hours,
        closures: closures.map((row) => ({ startsOn: row.starts_on, endsOn: row.ends_on })),
        regionCodes: site[0] === undefined ? [] : [site[0].state_code],
      });
    },
  };
}
