import { describe, expect, it } from 'vitest';
import {
  concat,
  csvBytes,
  docxBytes,
  heicBytes,
  JPEG_BYTES,
  minimalPdf,
  PNG_BYTES,
  text,
  xlsxBytes,
  zipWith,
} from '../../test/support/files.js';
import { CONTENT_TYPES } from './purposes.js';
import { detectContentType, summariseZip } from './sniff.js';

describe('detectContentType (magic bytes)', () => {
  it('recognises each accepted type from its bytes', () => {
    expect(detectContentType(minimalPdf())).toBe(CONTENT_TYPES.pdf);
    expect(detectContentType(JPEG_BYTES)).toBe(CONTENT_TYPES.jpeg);
    expect(detectContentType(PNG_BYTES)).toBe(CONTENT_TYPES.png);
    expect(detectContentType(heicBytes('heic'))).toBe(CONTENT_TYPES.heic);
    expect(detectContentType(heicBytes('mif1'))).toBe(CONTENT_TYPES.heic);
    expect(detectContentType(xlsxBytes())).toBe(CONTENT_TYPES.xlsx);
    expect(detectContentType(docxBytes())).toBe(CONTENT_TYPES.docx);
    expect(detectContentType(csvBytes())).toBe(CONTENT_TYPES.csv);
  });

  it('does not trust a name or a declared type: a PNG renamed to .pdf is a PNG', () => {
    expect(detectContentType(PNG_BYTES)).not.toBe(CONTENT_TYPES.pdf);
  });

  it('refuses an MP4 or other ISO media that is not HEIC', () => {
    expect(detectContentType(heicBytes('isom'))).toBeUndefined();
  });

  it('tells an xlsx from a docx by the archive directory, and refuses any other ZIP', () => {
    expect(detectContentType(zipWith(['[Content_Types].xml', 'xl/workbook.xml']))).toBe(
      CONTENT_TYPES.xlsx,
    );
    expect(detectContentType(zipWith(['[Content_Types].xml', 'word/document.xml']))).toBe(
      CONTENT_TYPES.docx,
    );
    expect(detectContentType(zipWith(['a.txt', 'b.txt']))).toBeUndefined();
    // names claiming to be office parts but no [Content_Types].xml
    expect(detectContentType(zipWith(['xl/workbook.xml']))).toBeUndefined();
  });

  it('refuses a truncated ZIP', () => {
    const full = xlsxBytes();
    expect(detectContentType(full.subarray(0, full.byteLength - 10))).toBeUndefined();
  });

  it('calls plain UTF-8 text CSV, but not binary data or invalid UTF-8', () => {
    expect(detectContentType(text('a,b\n1,2\n'))).toBe(CONTENT_TYPES.csv);
    expect(detectContentType(text('naam,waarde\nçelsius,1\n'))).toBe(CONTENT_TYPES.csv);
    expect(detectContentType(Uint8Array.from([0x61, 0x2c, 0x00, 0x62]))).toBeUndefined();
    expect(detectContentType(Uint8Array.from([0xc3, 0x28, 0x61]))).toBeUndefined();
    expect(detectContentType(new Uint8Array(0))).toBeUndefined();
  });

  it('refuses an executable', () => {
    expect(
      detectContentType(concat(text('MZ'), new Uint8Array([0x90, 0x00, 0x03]))),
    ).toBeUndefined();
  });
});

describe('summariseZip', () => {
  it('lists the entries and the declared uncompressed size without decompressing', () => {
    const summary = summariseZip(xlsxBytes(['xl/vbaProject.bin'], 1000));
    expect(summary?.entries).toContain('xl/vbaProject.bin');
    expect(summary?.uncompressedBytes).toBe(4000);
  });
});
