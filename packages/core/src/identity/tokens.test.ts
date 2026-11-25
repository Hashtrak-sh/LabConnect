import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import { IdentityError } from './errors.js';
import { assertStepUp } from './sessions.js';
import { AccessTokens } from './tokens.js';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const START = '2026-11-25T10:00:00Z';
const config = (privateKeyPem: string, overrides = {}) => ({
  privateKeyPem,
  issuer: 'labconnect-api',
  audience: 'labconnect',
  ...overrides,
});

async function rejection(promise: Promise<unknown>): Promise<IdentityError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityError);
    return error as IdentityError;
  }
  throw new Error('expected a rejection');
}

describe('AccessTokens', () => {
  const keys = keyPair();
  const clock = new FixedClock(START);
  const tokens = new AccessTokens(config(keys.privateKeyPem), clock);
  const input = { userId: randomUUID(), sessionId: randomUUID(), amr: ['otp'], partial: false };

  it('signs an EdDSA token with the documented claims and verifies it', async () => {
    const mfaAt = new Date('2026-11-25T09:58:00Z');
    const { token, expiresIn } = await tokens.sign({
      ...input,
      amr: ['otp', 'totp'],
      mfaAt,
    });
    expect(expiresIn).toBe(600);
    const header = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()) as {
      alg: string;
      typ: string;
      kid: string;
    };
    expect(header).toEqual({ alg: 'EdDSA', typ: 'at+jwt', kid: 'k1' });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sub: input.userId,
      sid: input.sessionId,
      amr: ['otp', 'totp'],
      mfa_at: Math.floor(mfaAt.getTime() / 1000),
      iss: 'labconnect-api',
      aud: 'labconnect',
      iat: Math.floor(Date.parse(START) / 1000),
      exp: Math.floor(Date.parse(START) / 1000) + 600,
    });
    expect(payload).not.toHaveProperty('pre_mfa');
    expect(await tokens.verify(token)).toEqual({
      userId: input.userId,
      sessionId: input.sessionId,
      amr: ['otp', 'totp'],
      mfaAt: Math.floor(mfaAt.getTime() / 1000),
      partial: false,
      issuedAt: Math.floor(Date.parse(START) / 1000),
      expiresAt: Math.floor(Date.parse(START) / 1000) + 600,
    });
  });

  it('marks a partial session', async () => {
    const { token } = await tokens.sign({ ...input, partial: true });
    expect((await tokens.verify(token)).partial).toBe(true);
    expect((await tokens.verify(token)).mfaAt).toBeNull();
  });

  it('refuses an expired token, and accepts it up to the last second', async () => {
    const { token } = await tokens.sign(input);
    const later = new FixedClock(START);
    const verifier = new AccessTokens(config(keys.privateKeyPem), later);
    later.advance(599_000);
    await expect(verifier.verify(token)).resolves.toBeDefined();
    later.advance(1000);
    expect((await rejection(verifier.verify(token))).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a token signed by another key', async () => {
    const other = new AccessTokens(config(keyPair().privateKeyPem), clock);
    const { token } = await other.sign(input);
    expect((await rejection(tokens.verify(token))).code).toBe('UNAUTHENTICATED');
  });

  it('refuses another audience and another issuer', async () => {
    const wrongAudience = new AccessTokens(
      config(keys.privateKeyPem, { audience: 'someone-else' }),
      clock,
    );
    const wrongIssuer = new AccessTokens(
      config(keys.privateKeyPem, { issuer: 'elsewhere' }),
      clock,
    );
    expect((await rejection(tokens.verify((await wrongAudience.sign(input)).token))).code).toBe(
      'UNAUTHENTICATED',
    );
    expect((await rejection(tokens.verify((await wrongIssuer.sign(input)).token))).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('refuses a tampered payload or signature', async () => {
    const { token } = await tokens.sign(input);
    const [header = '', payload = '', signature = ''] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(payload, 'base64url').toString()) as object),
        sub: randomUUID(),
      }),
    ).toString('base64url');
    expect((await rejection(tokens.verify(`${header}.${forgedPayload}.${signature}`))).code).toBe(
      'UNAUTHENTICATED',
    );
    // Change the first character: it always carries six bits of the signature, so the bytes
    // differ. (Rewriting the last two characters left a signature ending in "BA" unchanged,
    // about one run in a thousand, and the token then verified.)
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    expect(flipped).not.toBe(signature);
    expect((await rejection(tokens.verify(`${header}.${payload}.${flipped}`))).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('refuses garbage and an unsigned token', async () => {
    for (const bad of ['', 'abc', 'a.b.c', 'e30.e30.']) {
      expect((await rejection(tokens.verify(bad))).code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses a token of another algorithm (HS256 with the public key as secret)', async () => {
    const forged = await new SignJWT({ sid: input.sessionId, amr: ['otp'] })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' })
      .setSubject(input.userId)
      .setIssuer('labconnect-api')
      .setAudience('labconnect')
      .setIssuedAt(Math.floor(Date.parse(START) / 1000))
      .setExpirationTime(Math.floor(Date.parse(START) / 1000) + 600)
      .sign(Buffer.from(keys.publicKeyPem));
    expect((await rejection(tokens.verify(forged))).code).toBe('UNAUTHENTICATED');
  });

  it('refuses a token that is missing a required claim', async () => {
    const stripped = await new SignJWT({ amr: ['otp'] })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: 'k1' })
      .setSubject(input.userId)
      .setIssuer('labconnect-api')
      .setAudience('labconnect')
      .setIssuedAt(Math.floor(Date.parse(START) / 1000))
      .setExpirationTime(Math.floor(Date.parse(START) / 1000) + 600)
      .sign(createPrivateKey(keys.privateKeyPem));
    expect((await rejection(tokens.verify(stripped))).code).toBe('UNAUTHENTICATED');
  });

  it('still verifies tokens of a previous key during a rotation', async () => {
    const previous = keyPair();
    const old = new AccessTokens(config(previous.privateKeyPem, { keyId: 'old' }), clock);
    const rotated = new AccessTokens(
      config(keys.privateKeyPem, {
        keyId: 'k2',
        previousPublicKeys: [{ keyId: 'old', pem: previous.publicKeyPem }],
      }),
      clock,
    );
    await expect(rotated.verify((await old.sign(input)).token)).resolves.toBeDefined();
    expect((await rejection(tokens.verify((await old.sign(input)).token))).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects an RSA key as the signing key', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      () =>
        new AccessTokens(
          config(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
          clock,
        ),
    ).toThrow(/Ed25519/);
  });
});

describe('assertStepUp', () => {
  const clock = new FixedClock(START);
  const verifiedAgo = (seconds: number) => ({
    mfaVerifiedAt: new Date(Date.parse(START) - seconds * 1000),
  });
  const stepUpCode = (session: { mfaVerifiedAt: Date | null }, max?: number) => {
    try {
      assertStepUp(session, clock, max);
    } catch (error) {
      return (error as IdentityError).code;
    }
    return 'OK';
  };

  it('passes within 5 minutes, including exactly 5', () => {
    expect(stepUpCode(verifiedAgo(0))).toBe('OK');
    expect(stepUpCode(verifiedAgo(299))).toBe('OK');
    expect(stepUpCode(verifiedAgo(300))).toBe('OK');
  });

  it('asks for step-up after 5 minutes, and when MFA was never done', () => {
    expect(stepUpCode(verifiedAgo(301))).toBe('STEP_UP_REQUIRED');
    expect(stepUpCode({ mfaVerifiedAt: null })).toBe('STEP_UP_REQUIRED');
  });

  it('refuses a verification time in the future', () => {
    expect(stepUpCode(verifiedAgo(-5))).toBe('STEP_UP_REQUIRED');
  });

  it('takes another maximum age, and reports it', () => {
    expect(stepUpCode(verifiedAgo(60), 30)).toBe('STEP_UP_REQUIRED');
    expect(stepUpCode(verifiedAgo(60), 120)).toBe('OK');
    try {
      assertStepUp({ mfaVerifiedAt: null }, clock, 120);
    } catch (error) {
      expect((error as IdentityError).meta).toEqual({ maxAgeSeconds: 120 });
    }
  });

  it('moves with the clock', () => {
    const moving = new FixedClock(START);
    const session = { mfaVerifiedAt: new Date(START) };
    assertStepUp(session, moving);
    moving.advance(301_000);
    expect(() => {
      assertStepUp(session, moving);
    }).toThrow(IdentityError);
  });
});
