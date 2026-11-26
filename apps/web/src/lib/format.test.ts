import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatTime, istDate, rupeesToPaise } from './format';
import { t } from './i18n';

describe('display helpers', () => {
  it('shows paise as rupees with Indian grouping', () => {
    expect(formatMoney({ amountPaise: 125_000 })).toBe('₹1,250');
    expect(formatMoney({ amountPaise: 12_345_678 })).toBe('₹1,23,456.78');
  });

  it('shows times in IST and dates as calendar dates', () => {
    expect(formatTime('2026-11-27T04:30:00Z')).toMatch(/^10:00\s?am$/i);
    expect(formatDate('2026-11-27')).toBe('Fri, 27 Nov, 2026');
    expect(istDate(new Date('2026-11-26T20:00:00Z'))).toBe('2026-11-27');
    expect(istDate(new Date('2026-11-26T10:00:00Z'), 14)).toBe('2026-12-10');
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
