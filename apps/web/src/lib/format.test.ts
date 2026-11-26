import { describe, expect, it } from 'vitest';
import { formatClock, istClock, istDate, istWeekday, rupeesToPaise } from './format';
import { t } from './i18n';

describe('web helpers', () => {
  it('works out IST dates, weekdays and clock times', () => {
    expect(istDate(new Date('2026-11-26T20:00:00Z'))).toBe('2026-11-27');
    expect(istDate(new Date('2026-11-26T10:00:00Z'), 14)).toBe('2026-12-10');
    // 26 Nov 2026 is a Thursday; at 20:00 UTC it is already Friday in India.
    expect(istWeekday(new Date('2026-11-26T10:00:00Z'))).toBe(4);
    expect(istWeekday(new Date('2026-11-26T20:00:00Z'))).toBe(5);
    expect(istClock(new Date('2026-11-26T04:30:00Z'))).toBe('10:00');
  });

  it('writes a 24-hour clock time the way the boards do', () => {
    expect(formatClock('17:00')).toBe('5:00 PM IST');
    expect(formatClock('09:30')).toBe('9:30 AM IST');
    expect(formatClock('00:15')).toBe('12:15 AM IST');
  });

  it('reads rupees typed by a user as paise', () => {
    expect(rupeesToPaise('1250')).toBe(125_000);
    expect(rupeesToPaise('1,250.5')).toBe(125_050);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
  });

  it('fills message placeholders', () => {
    expect(t('search.radiusKm', { km: 25 })).toBe('25 km');
    expect(t('app.name')).toBe('LabConnect');
  });
});
