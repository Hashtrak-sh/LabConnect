import { describe, expect, it } from 'vitest';
import { validateTrfForm } from './trf.js';

describe('trf.v1', () => {
  it('accepts the item alone, trims text and upper-cases a GSTIN', () => {
    const result = validateTrfForm('trf.v1', { itemName: '  TMT bar ', gstin: '29abcde1234f1z5' });
    expect(result).toEqual({ ok: true, form: { itemName: 'TMT bar', gstin: '29ABCDE1234F1Z5' } });
  });

  it('refuses a missing item, unknown fields, a bad date and a bad GSTIN', () => {
    const result = validateTrfForm('trf.v1', {
      batchNo: 'B-1',
      colour: 'red',
      manufacturingDate: '2026-02-30',
      gstin: 'nope',
    });
    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.issues.map((issue) => issue.path).sort();
    expect(paths).toEqual(['', 'gstin', 'itemName', 'manufacturingDate']);
  });

  it('refuses an unknown version', () => {
    expect(validateTrfForm('trf.v9', { itemName: 'x' })).toMatchObject({
      ok: false,
      versionUnknown: true,
    });
  });
});
