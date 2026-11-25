import { describe, expect, it } from 'vitest';
import { concat, minimalPdf, pdfWithObjectStream, text } from '../../test/support/files.js';
import { validatePdf } from './pdf.js';

describe('validatePdf', () => {
  it('accepts a structurally valid PDF', () => {
    expect(validatePdf(minimalPdf())).toEqual([]);
  });

  it('accepts a PDF whose object stream holds ordinary objects', () => {
    expect(validatePdf(pdfWithObjectStream('5 0 << /Type /Font /Subtype /Type1 >>'))).toEqual([]);
  });

  it('refuses a wrong header', () => {
    const bytes = minimalPdf();
    const wrong = concat(text('%PNG-1.4'), bytes.subarray(8));
    expect(validatePdf(wrong)).toContain('PDF_BAD_HEADER');
    expect(validatePdf(concat(text('\n'), bytes))).toContain('PDF_BAD_HEADER');
  });

  it('refuses a truncated file', () => {
    const bytes = minimalPdf();
    const cut = bytes.subarray(0, bytes.byteLength - 40);
    const issues = validatePdf(cut);
    expect(issues).toContain('PDF_NO_EOF_MARKER');
    expect(validatePdf(bytes.subarray(0, 200))).toContain('PDF_NO_EOF_MARKER');
  });

  it('refuses a startxref that points outside the file or at nothing', () => {
    const asText = Buffer.from(minimalPdf()).toString('latin1');
    const outside = asText.replace(/startxref\n\d+/, 'startxref\n99999999');
    expect(validatePdf(text(outside))).toContain('PDF_BAD_STARTXREF');
    const nowhere = asText.replace(/startxref\n\d+/, 'startxref\n12');
    expect(validatePdf(text(nowhere))).toContain('PDF_BAD_STARTXREF');
    const missing = asText.replace(/startxref\n\d+\n/, '');
    expect(validatePdf(text(missing))).toContain('PDF_BAD_STARTXREF');
  });

  it('refuses an encrypted PDF', () => {
    expect(validatePdf(minimalPdf({ trailerExtra: '/Encrypt 9 0 R' }))).toContain('PDF_ENCRYPTED');
  });

  it('refuses an encrypted PDF whose name is written with #xx escapes', () => {
    expect(validatePdf(minimalPdf({ trailerExtra: '/Encr#79pt 9 0 R' }))).toContain(
      'PDF_ENCRYPTED',
    );
    expect(validatePdf(minimalPdf({ trailerExtra: '/#45ncrypt 9 0 R' }))).toContain(
      'PDF_ENCRYPTED',
    );
  });

  it('does not mistake a longer name for /Encrypt or /JS', () => {
    expect(validatePdf(minimalPdf({ trailerExtra: '/EncryptionNote (x) /JSON 1' }))).toEqual([]);
  });

  it('refuses a PDF with JavaScript', () => {
    const action = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
    expect(validatePdf(minimalPdf({ bodyExtra: action }))).toContain('PDF_JAVASCRIPT');
    expect(validatePdf(minimalPdf({ bodyExtra: '<< /S /JavaScript >>' }))).toContain(
      'PDF_JAVASCRIPT',
    );
    expect(validatePdf(minimalPdf({ bodyExtra: '<< /J#53 (x) >>' }))).toContain('PDF_JAVASCRIPT');
  });

  it('finds JavaScript hidden in a compressed object stream', () => {
    const hidden = '5 0 << /S /JavaScript /JS (app.alert\\(1\\)) >>';
    expect(validatePdf(pdfWithObjectStream(hidden))).toContain('PDF_JAVASCRIPT');
    expect(validatePdf(pdfWithObjectStream('5 0 << /Encrypt 1 0 R >>'))).toContain('PDF_ENCRYPTED');
  });

  it('finds JavaScript in an uncompressed object stream', () => {
    expect(
      validatePdf(pdfWithObjectStream('5 0 << /S /JavaScript >>', { compress: false })),
    ).toContain('PDF_JAVASCRIPT');
  });

  it('refuses an object stream it cannot read, instead of passing it', () => {
    const asText = Buffer.from(pdfWithObjectStream('5 0 << >>')).toString('latin1');
    const broken = asText.replace('/FlateDecode', '/LZWDecode');
    expect(validatePdf(text(broken))).toContain('PDF_UNREADABLE_OBJECT_STREAM');
    // Flate-declared but not valid Flate data
    const garbage = asText.replace(
      /stream\n[\s\S]*?\nendstream/,
      'stream\nnot deflate data\nendstream',
    );
    expect(validatePdf(text(garbage))).toContain('PDF_UNREADABLE_OBJECT_STREAM');
  });

  it('refuses an object stream that inflates past the cap (a bomb)', () => {
    const huge = `5 0 << >>${' '.repeat(140 * 1024 * 1024)}`;
    expect(validatePdf(pdfWithObjectStream(huge))).toContain('PDF_UNREADABLE_OBJECT_STREAM');
  });
});
