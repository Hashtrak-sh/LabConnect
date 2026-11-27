import { describe, expect, it } from 'vitest';
import { groupSecret, qrPath, readCode, readEnrolment } from './otpauth';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/LabConnect:user%40example.com?secret=${SECRET}&issuer=LabConnect`;

describe('readEnrolment', () => {
  it('accepts a base32 key whose address carries the same key', () => {
    expect(readEnrolment(SECRET, URI)).toEqual({
      secret: SECRET,
      groupedSecret: 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
      uri: URI,
    });
  });

  it('refuses a key that is not base32, a wrong scheme, or a key and address that disagree', () => {
    expect(readEnrolment('not base32!', URI)).toBeNull();
    expect(readEnrolment(SECRET, `https://example.com/?secret=${SECRET}`)).toBeNull();
    expect(readEnrolment(SECRET, 'otpauth://hotp/x?secret=' + SECRET)).toBeNull();
    expect(
      readEnrolment(SECRET, URI.replace(SECRET, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')),
    ).toBeNull();
    expect(readEnrolment(undefined, URI)).toBeNull();
    expect(readEnrolment(SECRET, 42)).toBeNull();
  });

  it('groups a key in fours without a trailing space', () => {
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    expect(groupSecret('ABCDEFGH')).toBe('ABCD EFGH');
  });
});

describe('readCode', () => {
  it('takes six digits, with spaces', () => {
    expect(readCode('123 456')).toBe('123456');
    expect(readCode('12345')).toBeNull();
    expect(readCode('12345a')).toBeNull();
    expect(readCode(undefined)).toBeNull();
  });
});

describe('qrPath', () => {
  it('draws a square grid with a quiet zone and the three finder patterns', () => {
    const { size, d } = qrPath(URI);
    // 4 + 4 quiet modules around a version-N code (21 + 4 * (N - 1) modules a side).
    expect((size - 8 - 21) % 4).toBe(0);
    expect(size).toBeGreaterThan(29);
    const dark = new Set(
      [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(
        (match) => `${match[1] ?? ''},${match[2] ?? ''}`,
      ),
    );
    // The top-left finder pattern's outer ring starts at (4, 4); the top-right one ends at size - 5.
    expect(dark.has('4,4')).toBe(true);
    expect(dark.has(`${String(size - 5)},4`)).toBe(true);
    expect(dark.has(`4,${String(size - 5)}`)).toBe(true);
    // The quiet zone stays empty.
    expect(dark.has('0,0')).toBe(false);
    expect(dark.has('3,4')).toBe(false);
  });

  it('is the same for the same text and different for another', () => {
    expect(qrPath(URI)).toEqual(qrPath(URI));
    expect(qrPath(URI).d).not.toEqual(qrPath(URI.replace('LabConnect:', 'Other:')).d);
  });
});
