import { describe, expect, it } from 'vitest';
import { clipText, escapeHtml, formatInr, formatIst, singleLine } from './format.js';

describe('formatInr', () => {
  it.each([
    [0n, '₹0.00'],
    [5n, '₹0.05'],
    [100n, '₹1.00'],
    [99_999n, '₹999.99'],
    [100_000n, '₹1,000.00'],
    [12_345_678n, '₹1,23,456.78'],
    [123_456_789n, '₹12,34,567.89'],
    [100_000_000_000n, '₹1,00,00,00,000.00'],
    [-150_050n, '-₹1,500.50'],
  ])('%s paise is %s', (paise, shown) => {
    expect(formatInr(paise)).toBe(shown);
  });
});

describe('formatIst', () => {
  it('shows an instant in IST with a 12-hour clock', () => {
    expect(formatIst(new Date('2026-11-26T12:00:00Z'))).toBe('26 Nov 2026, 5:30 pm IST');
    expect(formatIst(new Date('2026-11-26T18:29:00Z'))).toBe('26 Nov 2026, 11:59 pm IST');
    expect(formatIst(new Date('2026-11-26T18:30:00Z'))).toBe('27 Nov 2026, 12:00 am IST');
    expect(formatIst(new Date('2026-01-01T06:30:00Z'))).toBe('1 Jan 2026, 12:00 pm IST');
  });
});

describe('text helpers', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('takes line breaks and control characters out of a single-line value', () => {
    expect(singleLine('Subject\r\nBcc: x@example.test\tend')).toBe(
      'Subject Bcc: x@example.test end',
    );
  });

  it('clips long text with an ellipsis', () => {
    expect(clipText('short', 10)).toBe('short');
    expect(clipText('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});
