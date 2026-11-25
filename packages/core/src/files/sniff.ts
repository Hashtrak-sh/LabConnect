import { type AllowedContentType, CONTENT_TYPES } from './purposes.js';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.byteLength >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const HEIC_BRANDS: ReadonlySet<string> = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

/** How many leading bytes of a text file are checked to call it CSV. */
const TEXT_SAMPLE_BYTES = 64 * 1024;
const MAX_ZIP_ENTRIES = 20_000;
/** Total declared uncompressed size above which a ZIP-based document is refused (zip bomb). */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

export interface ZipSummary {
  /** Entry names from the central directory. Nothing is decompressed. */
  entries: string[];
  uncompressedBytes: number;
}

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u32 = (bytes: Uint8Array, at: number): number =>
  (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

/**
 * Reads the central directory of a ZIP file without decompressing anything. `undefined` when
 * the archive is truncated, uses ZIP64, or its directory does not add up.
 */
export function summariseZip(bytes: Uint8Array): ZipSummary | undefined {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  const lowest = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let at = bytes.byteLength - 22; at >= lowest; at -= 1) {
    if (u32(bytes, at) === eocdSignature) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = u16(bytes, eocd + 10);
  const directorySize = u32(bytes, eocd + 12);
  const directoryOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return undefined;
  }
  if (count > MAX_ZIP_ENTRIES || directoryOffset + directorySize > eocd) return undefined;

  const entries: string[] = [];
  let uncompressedBytes = 0;
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > eocd || u32(bytes, at) !== 0x02014b50) return undefined;
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    if (at + 46 + nameLength > eocd) return undefined;
    entries.push(Buffer.from(bytes.subarray(at + 46, at + 46 + nameLength)).toString('utf8'));
    uncompressedBytes += u32(bytes, at + 24);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, uncompressedBytes };
}

function sniffZip(bytes: Uint8Array): AllowedContentType | undefined {
  const zip = summariseZip(bytes);
  if (!zip) return undefined;
  const names = new Set(zip.entries);
  if (!names.has('[Content_Types].xml')) return undefined;
  if (names.has('xl/workbook.xml')) return CONTENT_TYPES.xlsx;
  if (names.has('word/document.xml')) return CONTENT_TYPES.docx;
  return undefined;
}

function looksLikeCsv(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, TEXT_SAMPLE_BYTES);
  if (sample.includes(0)) return false;
  try {
    // `stream: true` lets a multi-byte character be cut by the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
  } catch {
    return false;
  }
  return true;
}

/**
 * The content type the bytes really are, from magic bytes (FILES_AND_REPORTS.md section 1,
 * step 4), never from the declared type or the file name. `undefined` when the bytes match
 * none of the types the platform accepts. A text file with no NUL byte and valid UTF-8 is
 * reported as CSV: CSV has no signature, so this is the weakest check of the set.
 */
export function detectContentType(bytes: Uint8Array): AllowedContentType | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return CONTENT_TYPES.pdf;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return CONTENT_TYPES.jpeg;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return CONTENT_TYPES.png;
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && HEIC_BRANDS.has(ascii(bytes, 8, 12))) {
    return CONTENT_TYPES.heic;
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return sniffZip(bytes);
  if (bytes.byteLength > 0 && looksLikeCsv(bytes)) return CONTENT_TYPES.csv;
  return undefined;
}
