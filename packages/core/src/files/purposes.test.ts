import type { FilePurpose } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { FilesError, isFilesError } from './errors.js';
import {
  assertUploadAllowed,
  AUDITED_DOWNLOAD_PURPOSES,
  CONTENT_TYPES,
  ruleFor,
  UPLOAD_RULES,
} from './purposes.js';

const MB = 1024 * 1024;

describe('upload rules (FILES_AND_REPORTS.md section 1)', () => {
  it('has the limits and types of the table, one entry per client-uploadable purpose', () => {
    const table: Record<string, { types: string[]; max: number }> = {
      REPORT_ORIGINAL: { types: ['application/pdf'], max: 20 * MB },
      RECEIPT_PHOTO: { types: ['image/jpeg', 'image/png', 'image/heic'], max: 10 * MB },
      BOOKING_ATTACHMENT: {
        types: [
          'application/pdf',
          'image/jpeg',
          'image/png',
          CONTENT_TYPES.xlsx,
          CONTENT_TYPES.docx,
        ],
        max: 25 * MB,
      },
      KYC_DOCUMENT: { types: ['application/pdf', 'image/jpeg', 'image/png'], max: 10 * MB },
      DISPUTE_EVIDENCE: { types: ['application/pdf', 'image/jpeg', 'image/png'], max: 10 * MB },
      IMPORT_SOURCE: { types: ['text/csv', CONTENT_TYPES.xlsx], max: 50 * MB },
    };
    expect(Object.keys(UPLOAD_RULES).sort()).toEqual(Object.keys(table).sort());
    for (const [purpose, expected] of Object.entries(table)) {
      const rule = ruleFor(purpose as FilePurpose);
      expect([...rule.contentTypes].sort()).toEqual([...expected.types].sort());
      expect(rule.maxBytes).toBe(expected.max);
    }
  });

  it('accepts the largest allowed file and refuses one byte more', () => {
    expect(() => assertUploadAllowed('REPORT_ORIGINAL', 'application/pdf', 20 * MB)).not.toThrow();
    expect(() => assertUploadAllowed('REPORT_ORIGINAL', 'application/pdf', 20 * MB + 1)).toThrow(
      FilesError,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses the size %s', (size) => {
    try {
      assertUploadAllowed('KYC_DOCUMENT', 'application/pdf', size);
      expect.unreachable();
    } catch (error) {
      expect(isFilesError(error) && error.meta?.reason).toBe('SIZE_LIMIT_EXCEEDED');
      expect((error as FilesError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses a type outside the allow-list, and compares it exactly', () => {
    for (const type of ['application/zip', 'application/pdf; charset=binary', 'APPLICATION/PDF']) {
      try {
        assertUploadAllowed('REPORT_ORIGINAL', type, 1000);
        expect.unreachable();
      } catch (error) {
        expect((error as FilesError).meta?.reason).toBe('CONTENT_TYPE_NOT_ALLOWED');
      }
    }
    // A purpose narrows the type: a PDF is not an import file.
    expect(() => assertUploadAllowed('IMPORT_SOURCE', 'application/pdf', 1000)).toThrow(FilesError);
  });

  it.each(['REPORT_STAMPED', 'FINANCIAL_DOCUMENT', 'LABEL_SHEET', 'CUSTODY_TRAIL'] as const)(
    'refuses to upload the system-generated purpose %s',
    (purpose) => {
      try {
        assertUploadAllowed(purpose, 'application/pdf', 1000);
        expect.unreachable();
      } catch (error) {
        expect((error as FilesError).meta?.reason).toBe('PURPOSE_NOT_UPLOADABLE');
      }
    },
  );

  it('audits downloads of report and KYC files', () => {
    expect([...AUDITED_DOWNLOAD_PURPOSES].sort()).toEqual([
      'KYC_DOCUMENT',
      'REPORT_ORIGINAL',
      'REPORT_STAMPED',
    ]);
  });
});
