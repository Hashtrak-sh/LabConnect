import sharp, { type Sharp } from 'sharp';
import { CONTENT_TYPES } from './purposes.js';

/**
 * Image sanitising (FILES_AND_REPORTS.md section 1, step 4: "for images, it strips EXIF and
 * re-encodes"). The bytes a user uploads are decoded and written again as a new JPEG or PNG
 * that carries pixels only: no EXIF (so no GPS position, device or time), no XMP, no IPTC,
 * no text chunks, no thumbnails, no ICC profile. The EXIF orientation is applied to the
 * pixels first, so a photo taken sideways is not shown sideways once the tag is gone. An
 * embedded colour profile is not kept; libvips converts to sRGB when it decodes an image
 * that has one, which is what a browser would assume for an untagged image (OQ-165).
 *
 * Limits (OQ-166, conservative constants, not from the documents):
 *   - at most `MAX_IMAGE_PIXELS` decoded pixels and `MAX_IMAGE_SIDE` pixels on either side
 *     of the input, checked from the header before decoding (decompression bombs: a 10 MB
 *     PNG can declare billions of pixels);
 *   - the output is scaled down (never up) to fit `MAX_OUTPUT_DIMENSION`;
 *   - animated or multi-frame images (APNG, multi-page) are refused.
 *
 * HEIC is not handled: sharp's prebuilt libvips decodes AVIF only, not HEVC (OQ-167), so
 * `sanitiseImage` refuses it with `IMAGE_FORMAT_UNSUPPORTED` instead of storing it with its
 * metadata.
 */

export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_SIDE = 16_384;
export const MAX_OUTPUT_DIMENSION = 8_192;
export const JPEG_OUTPUT_QUALITY = 90;

export type ImageIssue =
  'IMAGE_INVALID' | 'IMAGE_TOO_LARGE' | 'IMAGE_ANIMATED' | 'IMAGE_FORMAT_UNSUPPORTED';

export type ImageOutcome =
  | { ok: true; bytes: Uint8Array; contentType: string; width: number; height: number }
  | { ok: false; reason: ImageIssue };

/** Whether a detected content type is an image this module processes (or must refuse). */
export function isImageContentType(contentType: string): boolean {
  return (
    contentType === CONTENT_TYPES.jpeg ||
    contentType === CONTENT_TYPES.png ||
    contentType === CONTENT_TYPES.heic
  );
}

let configured = false;

/**
 * A worker decodes one image at a time within the 50 MB read cap: no operation cache (it only
 * helps repeated work on the same input) and two libvips threads per operation.
 */
function configureSharp(): void {
  if (configured) return;
  configured = true;
  sharp.cache(false);
  sharp.concurrency(2);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when a PNG has an `acTL` chunk before its first `IDAT` (APNG). Reads chunk headers only. */
function isAnimatedPng(bytes: Uint8Array): boolean {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= view.length) {
    const length = view.readUInt32BE(at);
    const type = view.toString('latin1', at + 4, at + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}

/**
 * Decodes and re-encodes one image. `expectedContentType` is what the magic bytes said; the
 * decoder must agree, so a file that starts like a JPEG but is something else is refused.
 * Never throws for bad input: every failure is a reason code. Deterministic for the same
 * input and sharp version.
 */
export async function sanitiseImage(
  bytes: Uint8Array,
  expectedContentType: string,
): Promise<ImageOutcome> {
  if (expectedContentType === CONTENT_TYPES.heic) {
    return { ok: false, reason: 'IMAGE_FORMAT_UNSUPPORTED' };
  }
  const isPng = expectedContentType === CONTENT_TYPES.png;
  if (!isPng && expectedContentType !== CONTENT_TYPES.jpeg) {
    return { ok: false, reason: 'IMAGE_FORMAT_UNSUPPORTED' };
  }
  configureSharp();
  try {
    const input = (): Sharp =>
      sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });

    const meta = await input().metadata();
    if (meta.format !== (isPng ? 'png' : 'jpeg')) return { ok: false, reason: 'IMAGE_INVALID' };
    const { width, height } = meta;
    // Written so that a missing dimension (not expected from the typings) is also refused.
    if (!(width >= 1 && height >= 1)) {
      return { ok: false, reason: 'IMAGE_INVALID' };
    }
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
      return { ok: false, reason: 'IMAGE_TOO_LARGE' };
    }
    if ((meta.pages ?? 1) > 1 || (isPng && isAnimatedPng(bytes))) {
      return { ok: false, reason: 'IMAGE_ANIMATED' };
    }

    // `rotate()` with no argument applies the EXIF orientation to the pixels. Sharp drops all
    // metadata unless asked to keep it, and this call never asks.
    const pipeline = input().rotate().resize({
      width: MAX_OUTPUT_DIMENSION,
      height: MAX_OUTPUT_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const { data, info } = await (
      isPng
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.jpeg({ quality: JPEG_OUTPUT_QUALITY })
    ).toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      bytes: new Uint8Array(data),
      contentType: isPng ? CONTENT_TYPES.png : CONTENT_TYPES.jpeg,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    // A pixel-limit failure is the bomb guard; everything else is a file that does not decode.
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      return { ok: false, reason: 'IMAGE_TOO_LARGE' };
    }
    return { ok: false, reason: 'IMAGE_INVALID' };
  }
}
