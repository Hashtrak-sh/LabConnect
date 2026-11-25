import { createHash } from 'node:crypto';
import type { FilePurpose } from '@labconnect/database';
import type { ImageIssue } from './images.js';
import { type PdfIssue, validatePdf } from './pdf.js';
import { detectContentType, MAX_ZIP_UNCOMPRESSED_BYTES, summariseZip } from './sniff.js';

/** Why an upload was refused after the scan. Stable codes, stored in `file_object.validation_errors`. */
export type RejectionReason =
  | 'SIZE_MISMATCH'
  | 'OBJECT_MISSING'
  | 'CONTENT_TYPE_MISMATCH'
  | 'OFFICE_MACROS'
  | 'ARCHIVE_TOO_LARGE'
  | PdfIssue
  | ImageIssue;

export interface ValidationInput {
  purpose: FilePurpose;
  declaredContentType: string;
  declaredSizeBytes: number;
  /** The bytes of the quarantined object. */
  bytes: Uint8Array;
}

export type ValidationOutcome =
  | { ok: true; detectedContentType: string; sha256: Buffer }
  | { ok: false; reasons: RejectionReason[]; detectedContentType: string | undefined };

export const sha256Of = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

const MACRO_ENTRIES = ['xl/vbaProject.bin', 'word/vbaProject.bin'];

/**
 * The content checks of FILES_AND_REPORTS.md section 1, step 4, on bytes already read:
 * the size is the declared size, the magic bytes say the declared type, a report PDF is
 * structurally valid, and (not in the document, conservative) an Office file has no macro
 * project and does not declare an absurd uncompressed size. On success returns the SHA-256
 * of exactly these bytes. Pure: no storage, no database.
 */
export function validateContent(input: ValidationInput): ValidationOutcome {
  const reasons: RejectionReason[] = [];
  const { bytes } = input;

  if (bytes.byteLength !== input.declaredSizeBytes) reasons.push('SIZE_MISMATCH');

  const detected = detectContentType(bytes);
  if (detected !== input.declaredContentType) reasons.push('CONTENT_TYPE_MISMATCH');

  // Every PDF, not only reports: step 4 says "for PDFs" without a purpose (the stricter reading, OQ-117).
  if (detected === 'application/pdf') reasons.push(...validatePdf(bytes));
  if (
    detected === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    detected === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const zip = summariseZip(bytes);
    if (zip?.entries.some((name) => MACRO_ENTRIES.includes(name))) reasons.push('OFFICE_MACROS');
    if (zip && zip.uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES)
      reasons.push('ARCHIVE_TOO_LARGE');
  }

  if (reasons.length > 0 || detected === undefined) {
    return { ok: false, reasons, detectedContentType: detected };
  }
  return { ok: true, detectedContentType: detected, sha256: sha256Of(bytes) };
}
