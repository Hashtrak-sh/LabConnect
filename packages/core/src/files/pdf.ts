import { inflateSync } from 'node:zlib';

/** Why a PDF is refused. Stable codes, stored in `file_object.validation_errors`. */
export type PdfIssue =
  | 'PDF_BAD_HEADER'
  | 'PDF_NO_EOF_MARKER'
  | 'PDF_BAD_STARTXREF'
  | 'PDF_ENCRYPTED'
  | 'PDF_JAVASCRIPT'
  | 'PDF_UNREADABLE_OBJECT_STREAM';

/** Decompressed object-stream bytes a PDF may expand to in total. A bigger one is treated as a bomb. */
const MAX_INFLATED_BYTES = 128 * 1024 * 1024;
const TAIL_BYTES = 1024;

/** A PDF name (`/JS`) written literally or with `#xx` escapes (`/J#53`), ending at a delimiter. */
function nameMatcher(name: string): RegExp {
  const pieces = Array.from(name).map((character) => {
    const hex = character.charCodeAt(0).toString(16).padStart(2, '0');
    const insensitive = Array.from(hex)
      .map((digit) => (/[a-f]/.test(digit) ? `[${digit}${digit.toUpperCase()}]` : digit))
      .join('');
    return `(?:${character.replaceAll(/[.*+?^${}()|[\]\\/]/g, '\\$&')}|#${insensitive})`;
  });
  return new RegExp(`/${pieces.join('')}(?![^\\s/<>\\[\\]()%])`);
}

const ENCRYPT = nameMatcher('Encrypt');
const JAVASCRIPT = [nameMatcher('JS'), nameMatcher('JavaScript')];
const OBJECT_STREAM = nameMatcher('ObjStm');
const FLATE = nameMatcher('FlateDecode');
const OTHER_FILTERS = [
  'ASCII85Decode',
  'ASCIIHexDecode',
  'LZWDecode',
  'RunLengthDecode',
  'Crypt',
  'DCTDecode',
  'JPXDecode',
  'CCITTFaxDecode',
  'JBIG2Decode',
].map(nameMatcher);
const PREDICTOR = nameMatcher('Predictor');

const hasJavaScript = (text: string): boolean => JAVASCRIPT.some((matcher) => matcher.test(text));

/**
 * Structural check of a report PDF, written by hand (no PDF library; the stamping task will
 * bring one). It refuses a file that:
 *  - does not start with `%PDF-1.x` or `%PDF-2.x`,
 *  - has no `%%EOF` marker in its last 1024 bytes, or whose last `startxref` does not point
 *    at a cross-reference table or stream inside the file (truncated or corrupt),
 *  - is encrypted (an `/Encrypt` entry),
 *  - carries JavaScript (a `/JS` or `/JavaScript` name).
 *
 * Names written with `#xx` escapes are matched too, and the contents of every `/ObjStm`
 * object stream are inflated (output capped) and scanned, because a compressed object can
 * hide a `/JS` action. An object stream that cannot be inflated, or that uses a filter other
 * than Flate, is refused: the file cannot be shown to be free of JavaScript.
 *
 * What this does not do: parse every object or the page tree, or find JavaScript that is
 * only reachable through a filter chain other than Flate. FILES_AND_REPORTS.md says the
 * worker "parses with a hardened library"; this check is the conservative hand-written
 * substitute for the MVP (OQ-117) and the library is brought in with the stamping task.
 */
export function validatePdf(bytes: Uint8Array): PdfIssue[] {
  const issues = new Set<PdfIssue>();
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');

  if (!/^%PDF-[12]\.\d/.test(text)) issues.add('PDF_BAD_HEADER');

  const tail = text.slice(Math.max(0, text.length - TAIL_BYTES));
  if (!tail.includes('%%EOF')) {
    issues.add('PDF_NO_EOF_MARKER');
  } else {
    const startxref = [...tail.matchAll(/startxref\s+(\d+)\s*(?:%%EOF)/g)].at(-1);
    const offset = startxref?.[1] === undefined ? Number.NaN : Number(startxref[1]);
    if (!Number.isSafeInteger(offset) || offset >= text.length) {
      issues.add('PDF_BAD_STARTXREF');
    } else {
      const target = text.slice(offset, offset + 40).trimStart();
      if (!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(target)) issues.add('PDF_BAD_STARTXREF');
    }
  }

  if (ENCRYPT.test(text)) issues.add('PDF_ENCRYPTED');
  if (hasJavaScript(text)) issues.add('PDF_JAVASCRIPT');

  let budget = MAX_INFLATED_BYTES;
  for (const keyword of text.matchAll(/(?<!end)stream(?:\r\n|\n)/g)) {
    const start = keyword.index + keyword[0].length;
    const objectStart = text.lastIndexOf('obj', keyword.index);
    const dictionary = text.slice(Math.max(objectStart, keyword.index - 4096), keyword.index);
    if (!OBJECT_STREAM.test(dictionary)) continue;

    const end = text.indexOf('endstream', start);
    if (end < 0) {
      issues.add('PDF_UNREADABLE_OBJECT_STREAM');
      continue;
    }
    const raw = Buffer.from(bytes.buffer, bytes.byteOffset + start, end - start);
    const flate = FLATE.test(dictionary);
    if (
      PREDICTOR.test(dictionary) ||
      OTHER_FILTERS.some((matcher) => matcher.test(dictionary)) ||
      (!flate && /\/Filter\b/.test(dictionary))
    ) {
      issues.add('PDF_UNREADABLE_OBJECT_STREAM');
      continue;
    }
    let decoded: Buffer;
    try {
      decoded = flate ? inflateSync(raw, { maxOutputLength: budget }) : raw;
    } catch {
      issues.add('PDF_UNREADABLE_OBJECT_STREAM');
      continue;
    }
    budget -= decoded.byteLength;
    const inner = decoded.toString('latin1');
    if (ENCRYPT.test(inner)) issues.add('PDF_ENCRYPTED');
    if (hasJavaScript(inner)) issues.add('PDF_JAVASCRIPT');
  }

  return [...issues];
}
