import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmSecretCipher, SecretCipherError } from './cipher.js';
import { emailLocalPart, isPlausibleEmail, normaliseEmail } from './email.js';
import {
  constantTimeEqual,
  generateDigits,
  generateOpaqueToken,
  generateRecoveryCode,
  hashRefreshToken,
  IdentityHasher,
  normaliseRecoveryCode,
  parseSecretBytes,
} from './hasher.js';

describe('AesGcmSecretCipher', () => {
  const cipher = new AesGcmSecretCipher(randomBytes(32));
  const secret = Uint8Array.from(randomBytes(20));

  it('round-trips a secret', async () => {
    const blob = await cipher.encrypt(secret, 'mfa_factor:1');
    expect(Buffer.from(await cipher.decrypt(blob, 'mfa_factor:1'))).toEqual(Buffer.from(secret));
  });

  it('does not store the plaintext, and encrypts the same secret differently each time', async () => {
    const one = await cipher.encrypt(secret, 'c');
    const two = await cipher.encrypt(secret, 'c');
    expect(Buffer.from(one).includes(Buffer.from(secret))).toBe(false);
    expect(Buffer.from(one)).not.toEqual(Buffer.from(two));
  });

  it('detects a changed byte anywhere in the blob', async () => {
    const blob = await cipher.encrypt(secret, 'c');
    for (const index of [0, 1, 2, 14, 15, 30, blob.length - 1]) {
      const tampered = Uint8Array.from(blob);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      await expect(cipher.decrypt(tampered, 'c')).rejects.toBeInstanceOf(SecretCipherError);
    }
  });

  it('detects a truncated blob', async () => {
    const blob = await cipher.encrypt(secret, 'c');
    await expect(cipher.decrypt(blob.slice(0, 20), 'c')).rejects.toBeInstanceOf(SecretCipherError);
    await expect(cipher.decrypt(new Uint8Array(), 'c')).rejects.toBeInstanceOf(SecretCipherError);
  });

  it('refuses a blob moved to another row (the context is authenticated)', async () => {
    const blob = await cipher.encrypt(secret, 'mfa_factor:1');
    await expect(cipher.decrypt(blob, 'mfa_factor:2')).rejects.toBeInstanceOf(SecretCipherError);
  });

  it('refuses another key', async () => {
    const blob = await cipher.encrypt(secret, 'c');
    const other = new AesGcmSecretCipher(randomBytes(32));
    await expect(other.decrypt(blob, 'c')).rejects.toBeInstanceOf(SecretCipherError);
  });

  it('refuses a blob made under another key id', async () => {
    const key = randomBytes(32);
    const blob = await new AesGcmSecretCipher(key, 1).encrypt(secret, 'c');
    await expect(new AesGcmSecretCipher(key, 2).decrypt(blob, 'c')).rejects.toBeInstanceOf(
      SecretCipherError,
    );
  });

  it('needs a 32 byte key', () => {
    expect(() => new AesGcmSecretCipher(randomBytes(16))).toThrow();
  });
});

describe('IdentityHasher', () => {
  const hasher = new IdentityHasher(randomBytes(32));

  it('is deterministic and keyed', () => {
    const other = new IdentityHasher(randomBytes(32));
    expect(hasher.destination('a@x.in')).toEqual(hasher.destination('a@x.in'));
    expect(hasher.destination('a@x.in')).not.toEqual(other.destination('a@x.in'));
    expect(hasher.destination('a@x.in')).toHaveLength(32);
  });

  it('separates purposes and bindings', () => {
    expect(hasher.otpCode('c1', '123456')).not.toEqual(hasher.otpCode('c2', '123456'));
    expect(hasher.otpCode('c1', '123456')).not.toEqual(hasher.otpCode('c1', '123457'));
    expect(hasher.destination('123456')).not.toEqual(hasher.otpCode('', '123456'));
    expect(hasher.recoveryCode('u1', 'ABCDE-FGHJK')).not.toEqual(
      hasher.recoveryCode('u2', 'ABCDE-FGHJK'),
    );
  });

  it('does not let a field boundary move (no ambiguity between parts)', () => {
    expect(hasher.otpCode('ab', 'c')).not.toEqual(hasher.otpCode('a', 'bc'));
  });

  it('treats recovery codes without regard to case, dashes and spaces', () => {
    expect(hasher.recoveryCode('u', 'abcde-fghjk')).toEqual(
      hasher.recoveryCode('u', 'ABCDE FGHJK'),
    );
    expect(normaliseRecoveryCode(' ab-cd ')).toBe('ABCD');
  });

  it('will not use a short secret', () => {
    expect(() => new IdentityHasher(randomBytes(16))).toThrow();
  });

  it('compares in constant time and unequal lengths are simply unequal', () => {
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1))).toBe(false);
  });
});

describe('secret parsing', () => {
  it('reads base64 and hex, and insists on 32 bytes', () => {
    const bytes = randomBytes(32);
    expect(Buffer.from(parseSecretBytes(bytes.toString('base64'), 'S'))).toEqual(bytes);
    expect(Buffer.from(parseSecretBytes(bytes.toString('hex'), 'S'))).toEqual(bytes);
    expect(() => parseSecretBytes(randomBytes(31).toString('base64'), 'S')).toThrow(/at least 32/);
    expect(() => parseSecretBytes('', 'S')).toThrow();
  });
});

describe('random values', () => {
  it('makes 6 digit OTPs, zero padded, with every digit position used', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const code = generateDigits();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code.charAt(0));
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('makes distinct 256 bit tokens', () => {
    const one = generateOpaqueToken();
    expect(one).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(one);
  });

  it('makes recovery codes of 10 characters from a clear alphabet', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });

  it('hashes refresh tokens to 32 bytes that differ per token', () => {
    expect(hashRefreshToken('a')).toHaveLength(32);
    expect(hashRefreshToken('a')).toEqual(hashRefreshToken('a'));
    expect(hashRefreshToken('a')).not.toEqual(hashRefreshToken('b'));
  });
});

describe('email helpers', () => {
  it('normalises case and whitespace', () => {
    expect(normaliseEmail('  User@Example.IN ')).toBe('user@example.in');
  });
  it('checks the shape', () => {
    expect(isPlausibleEmail('a@b.in')).toBe(true);
    for (const bad of ['', 'a', 'a@b', 'a b@c.in', '@c.in', 'a@@c.in', `${'a'.repeat(250)}@c.in`]) {
      expect(isPlausibleEmail(bad)).toBe(false);
    }
  });
  it('takes the part before the @', () => {
    expect(emailLocalPart('ravi.k@x.in')).toBe('ravi.k');
  });
});
