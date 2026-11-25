import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  matchTotp,
  otpauthUri,
  timeStep,
  totpAt,
} from './totp.js';

const SHA1_SECRET = Buffer.from('12345678901234567890');
const SHA256_SECRET = Buffer.from('12345678901234567890123456789012');
const SHA512_SECRET = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
);

describe('HOTP (RFC 4226 appendix D)', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it.each(expected.map((code, counter) => [counter, code] as const))(
    'counter %i gives %s',
    (counter, code) => {
      expect(hotp(SHA1_SECRET, counter)).toBe(code);
    },
  );
});

describe('TOTP (RFC 6238 appendix B, 8 digits)', () => {
  const vectors: readonly [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  it.each(vectors)('at %i seconds', (seconds, sha1, sha256, sha512) => {
    const millis = seconds * 1000;
    expect(totpAt(SHA1_SECRET, millis, { digits: 8 })).toBe(sha1);
    expect(totpAt(SHA256_SECRET, millis, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
    expect(totpAt(SHA512_SECRET, millis, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
  });

  it('uses the last 6 digits at the default length', () => {
    expect(totpAt(SHA1_SECRET, 59_000)).toBe('287082');
  });

  it('counts 30 second steps', () => {
    expect(timeStep(59_000)).toBe(1);
    expect(timeStep(60_000)).toBe(2);
  });
});

describe('matchTotp', () => {
  const secret = SHA1_SECRET;
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const at = (offset: number): string => hotp(secret, step + offset);

  it('accepts the current step and one step either side', () => {
    expect(matchTotp(secret, at(0), now)).toBe(step);
    expect(matchTotp(secret, at(-1), now)).toBe(step - 1);
    expect(matchTotp(secret, at(1), now)).toBe(step + 1);
  });

  it('refuses two steps away, either side', () => {
    expect(matchTotp(secret, at(-2), now)).toBeNull();
    expect(matchTotp(secret, at(2), now)).toBeNull();
  });

  it('refuses a wrong code and a code of the wrong shape', () => {
    const wrong = at(0) === '000000' ? '000001' : '000000';
    expect(matchTotp(secret, wrong, now)).toBeNull();
    expect(matchTotp(secret, '', now)).toBeNull();
    expect(matchTotp(secret, at(0).slice(1), now)).toBeNull();
    expect(matchTotp(secret, `${at(0)}0`, now)).toBeNull();
  });

  it('refuses a step that was already used (replay), and anything older', () => {
    expect(matchTotp(secret, at(0), now, { afterStep: step - 1 })).toBe(step);
    expect(matchTotp(secret, at(0), now, { afterStep: step })).toBeNull();
    expect(matchTotp(secret, at(-1), now, { afterStep: step })).toBeNull();
    // A later step in the window is still fine after an earlier one was used.
    expect(matchTotp(secret, at(1), now, { afterStep: step })).toBe(step + 1);
  });

  it('follows the clock: a code from the previous window stops working after two more steps', () => {
    const code = at(0);
    expect(matchTotp(secret, code, now + 30_000)).toBe(step);
    expect(matchTotp(secret, code, now + 60_000)).toBeNull();
  });
});

describe('base32', () => {
  // RFC 4648 section 10 test vectors (without padding).
  const vectors: readonly [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  it.each(vectors)('encodes and decodes %j', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(Buffer.from(base32Decode(encoded)).toString()).toBe(plain);
  });

  it('decodes without regard to case, spaces and padding', () => {
    expect(Buffer.from(base32Decode('mzxw 6ytb oi======')).toString()).toBe('foobar');
  });

  it('rejects other characters', () => {
    expect(() => base32Decode('MZXW1')).toThrow(RangeError);
  });
});

describe('enrolment helpers', () => {
  it('makes a 160-bit secret that round-trips through base32', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(20);
    expect(Buffer.from(base32Decode(base32Encode(secret)))).toEqual(Buffer.from(secret));
    expect(generateTotpSecret()).not.toEqual(secret);
  });

  it('builds an otpauth URI an authenticator app reads', () => {
    const uri = new URL(otpauthUri('user@example.com', 'ABCDEFGH'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/LabConnect:user@example.com');
    expect(uri.searchParams.get('secret')).toBe('ABCDEFGH');
    expect(uri.searchParams.get('issuer')).toBe('LabConnect');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
