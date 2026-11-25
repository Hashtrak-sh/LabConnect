import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { InfraConfig } from './config.js';

/** The retention periods the app accepts, by number of days (a subset of what CloudWatch Logs offers). */
const PERIODS: readonly [number, RetentionDays][] = [
  [7, RetentionDays.ONE_WEEK],
  [14, RetentionDays.TWO_WEEKS],
  [30, RetentionDays.ONE_MONTH],
  [60, RetentionDays.TWO_MONTHS],
  [90, RetentionDays.THREE_MONTHS],
  [180, RetentionDays.SIX_MONTHS],
  [365, RetentionDays.ONE_YEAR],
  [400, RetentionDays.THIRTEEN_MONTHS],
  [545, RetentionDays.EIGHTEEN_MONTHS],
  [731, RetentionDays.TWO_YEARS],
  [1827, RetentionDays.FIVE_YEARS],
  [3653, RetentionDays.TEN_YEARS],
];

export const RETENTION_DAYS: readonly number[] = PERIODS.map(([days]) => days);

export function logRetention(config: InfraConfig): RetentionDays {
  const found = PERIODS.find(([days]) => days === config.logRetentionDays);
  if (!found)
    throw new RangeError(`Unsupported log retention: ${String(config.logRetentionDays)}.`);
  return found[1];
}
