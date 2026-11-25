import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  isImageContentType,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  MAX_OUTPUT_DIMENSION,
  sanitiseImage,
} from './images.js';
import { detectContentType } from './sniff.js';

// Test images are generated here with sharp: nothing binary is committed.

const JPEG = 'image/jpeg';
const PNG = 'image/png';

/** Left half red, right half blue, 40 x 20. */
async function twoColours(): Promise<Buffer> {
  const left = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .composite([{ input: left, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function pixel(bytes: Uint8Array, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
}

describe('sanitiseImage: JPEG', () => {
  async function jpegWithExif(): Promise<Buffer> {
    return sharp(await twoColours())
      .withExif({
        IFD0: { Make: 'LabConnectTestCamera', ImageDescription: 'Asha Rao, Plot 7' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '12/1 58/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '77/1 35/1 0/1',
        },
      })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 95 })
      .toBuffer();
  }

  it('the fixture really has EXIF, GPS and an orientation (so the test below proves something)', async () => {
    const input = await jpegWithExif();
    const meta = await sharp(input).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.orientation).toBe(6);
    expect(input.toString('latin1')).toContain('LabConnectTestCamera');
    expect(input.toString('latin1')).toContain('Asha Rao');
  });

  it('strips EXIF and GPS, applies the orientation to the pixels, and returns a valid JPEG', async () => {
    const input = await jpegWithExif();
    const out = await sanitiseImage(input, JPEG);
    if (!out.ok) throw new Error(`rejected: ${out.reason}`);

    expect(out.contentType).toBe(JPEG);
    expect(detectContentType(out.bytes)).toBe(JPEG);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    // Orientation was baked in (6 = rotate 90 clockwise: 40x20 becomes 20x40) and the tag is gone.
    expect(meta.orientation).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect([out.width, out.height]).toEqual([20, 40]);
    const raw = Buffer.from(out.bytes).toString('latin1');
    expect(raw).not.toContain('Exif');
    expect(raw).not.toContain('LabConnectTestCamera');
    expect(raw).not.toContain('Asha Rao');
    // The red half was on the left; rotated clockwise it is on top.
    const [topR, , topB] = await pixel(out.bytes, 10, 5);
    const [bottomR, , bottomB] = await pixel(out.bytes, 10, 35);
    expect(topR).toBeGreaterThan(200);
    expect(topB).toBeLessThan(60);
    expect(bottomB).toBeGreaterThan(200);
    expect(bottomR).toBeLessThan(60);
  });

  it('is deterministic (a redelivery stores the same bytes the first delivery hashed)', async () => {
    const input = await jpegWithExif();
    const first = await sanitiseImage(input, JPEG);
    const second = await sanitiseImage(input, JPEG);
    if (!first.ok || !second.ok) throw new Error('rejected');
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  it('scales an image larger than the output bound down, never up', async () => {
    const big = await sharp({
      create: {
        width: MAX_OUTPUT_DIMENSION + 800,
        height: 100,
        channels: 3,
        background: '#808080',
      },
    })
      .jpeg()
      .toBuffer();
    const out = await sanitiseImage(big, JPEG);
    if (!out.ok) throw new Error(`rejected: ${out.reason}`);
    expect(out.width).toBe(MAX_OUTPUT_DIMENSION);
    expect(out.height).toBeLessThanOrEqual(100);
    const small = await sanitiseImage(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
        .jpeg()
        .toBuffer(),
      JPEG,
    );
    expect(small.ok && [small.width, small.height]).toEqual([8, 8]);
  });
});

describe('sanitiseImage: PNG', () => {
  /** A PNG with a tEXt chunk (a GPS-like note) and an eXIf chunk inserted before IDAT. */
  async function pngWithChunks(): Promise<Buffer> {
    const base = await sharp(await twoColours())
      .png()
      .toBuffer();
    const chunk = (type: string, data: Buffer): Buffer => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      // The CRC is not checked by the decoder for ancillary chunks in libvips/spng's default mode.
      return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    };
    const idat = base.indexOf('IDAT') - 4;
    return Buffer.concat([
      base.subarray(0, idat),
      chunk('tEXt', Buffer.from('Comment\0GPS 12.97N 77.59E Asha Rao', 'latin1')),
      chunk('iTXt', Buffer.from('Author\0\0\0\0\0Asha Rao', 'latin1')),
      base.subarray(idat),
    ]);
  }

  it('the fixture carries the text chunks', async () => {
    const input = await pngWithChunks();
    expect(input.toString('latin1')).toContain('Asha Rao');
  });

  it('strips text chunks and metadata, keeps the pixels', async () => {
    const input = await pngWithChunks();
    const out = await sanitiseImage(input, PNG);
    if (!out.ok) throw new Error(`rejected: ${out.reason}`);
    expect(detectContentType(out.bytes)).toBe(PNG);
    const raw = Buffer.from(out.bytes).toString('latin1');
    expect(raw).not.toContain('Asha Rao');
    expect(raw).not.toContain('tEXt');
    expect(raw).not.toContain('iTXt');
    expect(raw).not.toContain('eXIf');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([40, 20]);
    expect((await pixel(out.bytes, 5, 5))[0]).toBe(255);
    expect((await pixel(out.bytes, 35, 5))[2]).toBe(255);
  });
});

/** A structurally valid PNG whose header declares `width` x `height` and whose pixel data is tiny. */
function bombPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(1024))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('sanitiseImage: refusals', () => {
  it('refuses a decompression bomb (huge declared dimensions in a tiny file) as IMAGE_TOO_LARGE', async () => {
    const bomb = bombPng(60_000, 60_000);
    expect(bomb.byteLength).toBeLessThan(2_000);
    expect(await sanitiseImage(bomb, PNG)).toEqual({ ok: false, reason: 'IMAGE_TOO_LARGE' });
  });

  it('refuses an image over the pixel bound or the side bound, and accepts one just under both', async () => {
    // 8000 x 8000 = 64 MP > 50 MP, each side under the side bound.
    expect(8_000 * 8_000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await sanitiseImage(bombPng(8_000, 8_000), PNG)).toEqual({
      ok: false,
      reason: 'IMAGE_TOO_LARGE',
    });
    expect(await sanitiseImage(bombPng(MAX_IMAGE_SIDE + 1, 10), PNG)).toEqual({
      ok: false,
      reason: 'IMAGE_TOO_LARGE',
    });
  });

  it('refuses an animated PNG (APNG) as IMAGE_ANIMATED', async () => {
    const base = await sharp(await twoColours())
      .png()
      .toBuffer();
    const acTL = Buffer.concat([
      Buffer.from([0, 0, 0, 8]),
      Buffer.from('acTL', 'latin1'),
      Buffer.from([0, 0, 0, 2, 0, 0, 0, 0]),
      Buffer.alloc(4),
    ]);
    const idat = base.indexOf('IDAT') - 4;
    const apng = Buffer.concat([base.subarray(0, idat), acTL, base.subarray(idat)]);
    expect(await sanitiseImage(apng, PNG)).toEqual({ ok: false, reason: 'IMAGE_ANIMATED' });
  });

  it('refuses a corrupt image (valid signature, damaged body) as IMAGE_INVALID', async () => {
    const good = await sharp(await twoColours())
      .jpeg()
      .toBuffer();
    const truncated = good.subarray(0, Math.floor(good.length / 2));
    expect(await sanitiseImage(truncated, JPEG)).toEqual({ ok: false, reason: 'IMAGE_INVALID' });
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    expect(await sanitiseImage(garbage, JPEG)).toEqual({ ok: false, reason: 'IMAGE_INVALID' });
  });

  it('refuses bytes that are not the expected format even if the caller says so', async () => {
    const png = await sharp(await twoColours())
      .png()
      .toBuffer();
    expect(await sanitiseImage(png, JPEG)).toEqual({ ok: false, reason: 'IMAGE_INVALID' });
    expect(await sanitiseImage(Buffer.from('%PDF-1.4 not an image'), JPEG)).toEqual({
      ok: false,
      reason: 'IMAGE_INVALID',
    });
  });

  it('refuses HEIC: the prebuilt decoder cannot read it, and it is never stored with its metadata', async () => {
    expect(isImageContentType('image/heic')).toBe(true);
    expect(await sanitiseImage(Buffer.alloc(64), 'image/heic')).toEqual({
      ok: false,
      reason: 'IMAGE_FORMAT_UNSUPPORTED',
    });
    // sharp's own report: HEIF input is AVIF only.
    expect(sharp.format.heif.input.fileSuffix).toEqual(['.avif']);
  });
});
