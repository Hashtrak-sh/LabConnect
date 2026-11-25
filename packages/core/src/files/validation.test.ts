import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JPEG_BYTES, minimalPdf, PNG_BYTES, xlsxBytes } from '../../test/support/files.js';
import { CONTENT_TYPES } from './purposes.js';
import { validateContent } from './validation.js';

describe('validateContent', () => {
  it('passes a matching file and hashes exactly its bytes', () => {
    const bytes = minimalPdf();
    const outcome = validateContent({
      purpose: 'REPORT_ORIGINAL',
      declaredContentType: CONTENT_TYPES.pdf,
      declaredSizeBytes: bytes.byteLength,
      bytes,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.detectedContentType).toBe(CONTENT_TYPES.pdf);
      expect(outcome.sha256.toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('rejects a size that differs from the declared size', () => {
    const bytes = minimalPdf();
    for (const declared of [bytes.byteLength - 1, bytes.byteLength + 1]) {
      const outcome = validateContent({
        purpose: 'REPORT_ORIGINAL',
        declaredContentType: CONTENT_TYPES.pdf,
        declaredSizeBytes: declared,
        bytes,
      });
      expect(outcome).toMatchObject({ ok: false, reasons: ['SIZE_MISMATCH'] });
    }
  });

  it('rejects bytes that are not the declared type', () => {
    const outcome = validateContent({
      purpose: 'KYC_DOCUMENT',
      declaredContentType: CONTENT_TYPES.pdf,
      declaredSizeBytes: PNG_BYTES.byteLength,
      bytes: PNG_BYTES,
    });
    expect(outcome).toMatchObject({
      ok: false,
      reasons: ['CONTENT_TYPE_MISMATCH'],
      detectedContentType: CONTENT_TYPES.png,
    });
  });

  it('rejects bytes of no accepted type, whatever was declared', () => {
    const bytes = Uint8Array.from([0x4d, 0x5a, 0x00, 0x90]);
    const outcome = validateContent({
      purpose: 'KYC_DOCUMENT',
      declaredContentType: CONTENT_TYPES.jpeg,
      declaredSizeBytes: bytes.byteLength,
      bytes,
    });
    expect(outcome).toMatchObject({ ok: false, detectedContentType: undefined });
  });

  it('validates every PDF structurally, not only reports', () => {
    const bytes = minimalPdf({ trailerExtra: '/Encrypt 9 0 R' });
    const outcome = validateContent({
      purpose: 'DISPUTE_EVIDENCE',
      declaredContentType: CONTENT_TYPES.pdf,
      declaredSizeBytes: bytes.byteLength,
      bytes,
    });
    expect(outcome).toMatchObject({ ok: false, reasons: ['PDF_ENCRYPTED'] });
  });

  it('collects every reason', () => {
    const bytes = minimalPdf({ trailerExtra: '/Encrypt 9 0 R' });
    const outcome = validateContent({
      purpose: 'REPORT_ORIGINAL',
      declaredContentType: CONTENT_TYPES.pdf,
      declaredSizeBytes: bytes.byteLength + 5,
      bytes,
    });
    expect(outcome).toMatchObject({ ok: false, reasons: ['SIZE_MISMATCH', 'PDF_ENCRYPTED'] });
  });

  it('passes an image by magic bytes alone', () => {
    expect(
      validateContent({
        purpose: 'RECEIPT_PHOTO',
        declaredContentType: CONTENT_TYPES.jpeg,
        declaredSizeBytes: JPEG_BYTES.byteLength,
        bytes: JPEG_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('rejects an Office file with a macro project or an absurd declared size', () => {
    const withMacro = xlsxBytes(['xl/vbaProject.bin']);
    expect(
      validateContent({
        purpose: 'IMPORT_SOURCE',
        declaredContentType: CONTENT_TYPES.xlsx,
        declaredSizeBytes: withMacro.byteLength,
        bytes: withMacro,
      }),
    ).toMatchObject({ ok: false, reasons: ['OFFICE_MACROS'] });

    const bomb = xlsxBytes([], 600 * 1024 * 1024);
    expect(
      validateContent({
        purpose: 'IMPORT_SOURCE',
        declaredContentType: CONTENT_TYPES.xlsx,
        declaredSizeBytes: bomb.byteLength,
        bytes: bomb,
      }),
    ).toMatchObject({ ok: false, reasons: ['ARCHIVE_TOO_LARGE'] });

    const fine = xlsxBytes();
    expect(
      validateContent({
        purpose: 'IMPORT_SOURCE',
        declaredContentType: CONTENT_TYPES.xlsx,
        declaredSizeBytes: fine.byteLength,
        bytes: fine,
      }).ok,
    ).toBe(true);
  });
});
