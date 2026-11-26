import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { FixedClock } from '@labconnect/core';
import { describe, expect, it } from 'vitest';
import { IdentityRuntime } from './identity.runtime.js';
import type { Request } from 'express';
import { readCookie } from './refresh-cookie.js';

const clock = new FixedClock('2026-11-25T10:00:00Z');
const runtime = (env: Record<string, string | undefined>) => new IdentityRuntime(env, clock);

describe('IdentityRuntime', () => {
  it('builds without any secret, and fails only when one is used, naming it but not its value', () => {
    const empty = runtime({});
    expect(() => empty.hasher).toThrow('AUTH_HASH_SECRET is not set');
    expect(() => empty.cipher).toThrow('AUTH_ENCRYPTION_KEY is not set');
    expect(() => empty.tokens).toThrow('AUTH_JWT_PRIVATE_KEY is not set');
    expect(empty.allowedOrigins.size).toBe(0);
  });

  it('refuses a secret that is too short, without repeating it', () => {
    const short = Buffer.from('short-secret').toString('base64');
    expect(() => runtime({ AUTH_HASH_SECRET: short }).hasher).toThrow(/at least 32 bytes/);
    expect(() => runtime({ AUTH_HASH_SECRET: short }).hasher).not.toThrow(short);
    expect(
      () => runtime({ AUTH_ENCRYPTION_KEY: randomBytes(40).toString('base64') }).cipher,
    ).toThrow(/exactly 32 bytes/);
  });

  it('reads an Ed25519 key whose newlines are written as \\n, and reuses the instances', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString()
      .replaceAll('\n', '\\n');
    const env = runtime({ AUTH_JWT_PRIVATE_KEY: pem, AUTH_JWT_KEY_ID: 'k9' });
    const tokens = env.tokens;
    expect(env.tokens).toBe(tokens);
    const { token } = await tokens.sign({
      userId: 'u',
      sessionId: 's',
      amr: ['otp'],
      partial: false,
    });
    expect(
      JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString()),
    ).toMatchObject({
      kid: 'k9',
    });
  });

  it('has no demo one-time code unless DEMO_OTP_CODE is set, and then only outside production', () => {
    expect(runtime({}).demoOtp).toBeUndefined();
    expect(runtime({ NODE_ENV: 'production' }).demoOtp).toBeUndefined();
    const demo = runtime({
      APP_ENV: 'uat',
      NODE_ENV: 'production',
      DEMO_OTP_CODE: '444444',
    }).demoOtp;
    expect(demo?.code).toBe('444444');
    expect(demo?.emailDomain).toBe('demo.labconnect.test');
    // Read on every use, so a bad value can never be skipped after start-up.
    expect(() => runtime({ NODE_ENV: 'production', DEMO_OTP_CODE: '444444' }).demoOtp).toThrow(
      /DEMO_OTP_CODE/,
    );
    expect(() => {
      runtime({ NODE_ENV: 'production', DEMO_OTP_CODE: '444444' }).onModuleInit();
    }).toThrow(/DEMO_OTP_CODE/);
  });

  it('lists the allowed origins without spaces or trailing slashes', () => {
    const origins = runtime({
      AUTH_ALLOWED_ORIGINS: ' https://a.example , https://b.example/,, ',
    }).allowedOrigins;
    expect([...origins].sort()).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('readCookie', () => {
  const request = (cookie?: string) =>
    ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as Request;

  it('finds a cookie among others and decodes it', () => {
    expect(readCookie(request('a=1; lc_refresh=abc%2Fdef; b=2'), 'lc_refresh')).toBe('abc/def');
  });
  it('does not match a cookie whose name only ends the same way', () => {
    expect(readCookie(request('x_lc_refresh=evil'), 'lc_refresh')).toBeUndefined();
  });
  it('is undefined without the header, without the cookie, or with a bad encoding', () => {
    expect(readCookie(request(), 'lc_refresh')).toBeUndefined();
    expect(readCookie(request('a=1'), 'lc_refresh')).toBeUndefined();
    expect(readCookie(request('lc_refresh=%E0%A4%A'), 'lc_refresh')).toBeUndefined();
  });
});
