import { deflateSync } from 'node:zlib';

// Builders for the file bytes the files tests upload. Nothing here is a real document.

const latin1 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));

export const concat = (...parts: Uint8Array[]): Uint8Array =>
  Uint8Array.from(Buffer.concat(parts.map((part) => Buffer.from(part))));

/**
 * A small, structurally valid PDF: header, three objects, a cross-reference table with true
 * offsets, trailer, `startxref` and `%%EOF`. `trailerExtra` goes into the trailer dictionary
 * (for example `/Encrypt 9 0 R`); `bodyExtra` becomes an extra object 4 (for example an action).
 */
export function minimalPdf(
  options: { trailerExtra?: string; bodyExtra?: string } = {},
): Uint8Array {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n',
  ];
  if (options.bodyExtra !== undefined) {
    objects.push(`4 0 obj\n${options.bodyExtra}\nendobj\n`);
  }
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefAt = body.length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body +=
    `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R ${options.trailerExtra ?? ''} >>\n` +
    `startxref\n${String(xrefAt)}\n%%EOF\n`;
  return latin1(body);
}

/** A PDF whose object 4 is an object stream (`/ObjStm`) holding `inner`, Flate-compressed unless told otherwise. */
export function pdfWithObjectStream(
  inner: string,
  options: { compress?: boolean } = {},
): Uint8Array {
  const compress = options.compress ?? true;
  const data = compress ? deflateSync(Buffer.from(inner, 'latin1')) : Buffer.from(inner, 'latin1');
  const dictionary = `<< /Type /ObjStm /N 1 /First 4${compress ? ' /Filter /FlateDecode' : ''} /Length ${String(data.byteLength)} >>`;
  const prefix = minimalPdf();
  // Splice object 4 in before the xref table so the cross-reference offsets stay true: rebuild.
  const text = Buffer.from(prefix).toString('latin1');
  const xrefAt = text.indexOf('xref\n0');
  const head = text.slice(0, xrefAt);
  const objectAt = head.length;
  const streamObject = concat(
    latin1(`4 0 obj\n${dictionary}\nstream\n`),
    Uint8Array.from(data),
    latin1('\nendstream\nendobj\n'),
  );
  const newXrefAt = objectAt + streamObject.byteLength;
  const rows = [...text.matchAll(/(\d{10}) 00000 n /g)].map((match) => match[1] ?? '');
  const entries = [...rows, String(objectAt).padStart(10, '0')]
    .map((offset) => `${offset} 00000 n \n`)
    .join('');
  const tail =
    `xref\n0 5\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${String(newXrefAt)}\n%%EOF\n`;
  return concat(latin1(head), streamObject, latin1(tail));
}

export const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
export const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

export function heicBytes(brand = 'heic'): Uint8Array {
  return concat(
    Uint8Array.from([0x00, 0x00, 0x00, 0x18]),
    latin1('ftyp'),
    latin1(brand),
    new Uint8Array(12),
  );
}

/** A ZIP archive with the given entry names (stored, empty contents). Only the directory matters to the platform. */
export function zipWith(names: string[], uncompressedSize = 0): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    parts.push(local);
    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(uncompressedSize, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBytes.copy(entry, 46);
    central.push(entry);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return concat(...parts, directory, end);
}

export const xlsxBytes = (extra: string[] = [], size = 0): Uint8Array =>
  zipWith(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', ...extra], size);
export const docxBytes = (extra: string[] = []): Uint8Array =>
  zipWith(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', ...extra]);

export const csvBytes = (): Uint8Array => latin1('name,value\nalpha,1\nbeta,2\n');

export const text = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'utf8'));
