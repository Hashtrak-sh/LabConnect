import 'reflect-metadata';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { InMemoryOtpMailer } from '@labconnect/core';
import { IDENTITY_ENV, type IdentityEnv } from '../src/modules/identity/identity.runtime.js';
import { OTP_MAILER } from '../src/modules/identity/otp-mailer.js';

// Demo one-time codes: the API's start-up rules. Needs no database and no secret.

async function boot(env: IdentityEnv): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDENTITY_ENV)
    .useValue(env)
    // The mail setup of a deployed environment is not what is tested here.
    .overrideProvider(OTP_MAILER)
    .useValue(new InMemoryOtpMailer())
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  configureApp(app);
  await app.init();
  return app;
}

/** The first error a boot rejects with, as text, or `undefined` when it started. */
async function refusal(env: IdentityEnv): Promise<string | undefined> {
  try {
    const app = await boot(env);
    await app.close();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

describe('demo one-time codes: start-up', () => {
  const lines: string[] = [];
  const keep = (...args: unknown[]): void => {
    lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  const spy = () => {
    lines.length = 0;
    const spies = [
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'verbose').mockImplementation(keep),
      vi.spyOn(console, 'log').mockImplementation(keep),
      vi.spyOn(console, 'warn').mockImplementation(keep),
      vi.spyOn(console, 'info').mockImplementation(keep),
    ];
    return spies;
  };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the setting absent, in every environment, and logs no demo warning', async () => {
    spy();
    for (const env of [
      {},
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', APP_ENV: 'uat' },
    ]) {
      expect(await refusal(env)).toBeUndefined();
    }
    expect(lines.join('\n')).not.toMatch(/demo one-time/i);
  });

  it('refuses to start with the code set in production, naming the variable and not its value', async () => {
    for (const env of [
      { NODE_ENV: 'production' },
      { APP_ENV: 'production' },
      { NODE_ENV: 'production', APP_ENV: 'production' },
      { NODE_ENV: 'production', APP_ENV: 'staging' },
    ]) {
      const message = await refusal({ ...env, DEMO_OTP_CODE: '482915' });
      expect(message, JSON.stringify(env)).toContain('DEMO_OTP_CODE');
      expect(message).not.toContain('482915');
    }
    expect(
      await refusal({ NODE_ENV: 'production', DEMO_OTP_EMAIL_DOMAIN: 'demo.labconnect.test' }),
    ).toContain('DEMO_OTP_EMAIL_DOMAIN');
  });

  it('refuses to start with a code that is not six digits or a domain that is not reserved', async () => {
    expect(await refusal({ DEMO_OTP_CODE: '12345' })).toContain('DEMO_OTP_CODE');
    expect(await refusal({ DEMO_OTP_CODE: 'abcdef' })).toContain('DEMO_OTP_CODE');
    expect(
      await refusal({ DEMO_OTP_CODE: '444444', DEMO_OTP_EMAIL_DOMAIN: 'labconnect.in' }),
    ).toContain('DEMO_OTP_EMAIL_DOMAIN');
    expect(
      await refusal({ DEMO_OTP_CODE: '444444', DEMO_OTP_EMAIL_DOMAIN: 'demo.test.com' }),
    ).toContain('DEMO_OTP_EMAIL_DOMAIN');
  });

  it('starts in development, in test and on UAT, with one warning that names the domain and not the code', async () => {
    for (const env of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'production', APP_ENV: 'uat' }]) {
      spy();
      expect(
        await refusal({ ...env, DEMO_OTP_CODE: '482915' }),
        JSON.stringify(env),
      ).toBeUndefined();
      const warnings = lines.filter((line) => /demo one-time codes/i.test(line));
      expect(warnings, JSON.stringify(env)).toHaveLength(1);
      expect(warnings[0]).toContain('demo.labconnect.test');
      expect(lines.join('\n')).not.toContain('482915');
      vi.restoreAllMocks();
    }
  });

  it('logs the configured domain, and never the code, whatever else it logs', async () => {
    spy();
    expect(
      await refusal({
        APP_ENV: 'uat',
        DEMO_OTP_CODE: '482915',
        DEMO_OTP_EMAIL_DOMAIN: 'Uat.Demo.Example',
      }),
    ).toBeUndefined();
    const all = lines.join('\n');
    expect(all).toContain('uat.demo.example');
    expect(all).not.toContain('482915');
  });
});
