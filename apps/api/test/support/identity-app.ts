import 'reflect-metadata';
import { randomBytes, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Server } from 'node:http';
import { base32Decode, FixedClock, InMemoryOtpMailer, totpAt } from '@labconnect/core';
import type { Prisma } from '@labconnect/database';
import { addMember, createCustomer, createPlatformTeam } from '@labconnect/database/test-utils';
import type { Response } from 'supertest';
import { afterAll, beforeAll } from 'vitest';
import { usePlatform } from '../../../../packages/core/test/db/support.js';
import { configureApp } from '../../src/app.config.js';
import { AppModule } from '../../src/app.module.js';
import { IDENTITY_ENV, type IdentityEnv } from '../../src/modules/identity/identity.runtime.js';
import { OTP_MAILER } from '../../src/modules/identity/otp-mailer.js';
import { CLOCK, PRISMA_CLIENT } from '../../src/modules/platform/platform.providers.js';
import {
  contractRequest,
  type ContractRequestOptions,
  undocumentedRequest,
} from './contract/index.js';

export const START = '2026-11-25T10:00:00Z';
export const ORIGIN = 'https://app.labconnect.test';

/** Throwaway secrets for one test file. Nothing here is a real key. */
export function testIdentityEnv(): IdentityEnv {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    AUTH_JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    AUTH_HASH_SECRET: randomBytes(32).toString('base64'),
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AUTH_ALLOWED_ORIGINS: `${ORIGIN}, https://other.labconnect.test/`,
  };
}

/** The decoded payload of a JWT, without checking it. For assertions only. */
export function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

/** The `lc_refresh` cookie of a response: its value and attributes. */
export function refreshCookie(response: Response): {
  value: string;
  attributes: string[];
  raw: string;
} | null {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  const raw = lines.find((line) => line.startsWith('lc_refresh='));
  if (raw === undefined) return null;
  const [pair = '', ...attributes] = raw.split(';').map((part) => part.trim());
  return { value: decodeURIComponent(pair.slice('lc_refresh='.length)), attributes, raw };
}

export interface Person {
  id: string;
  email: string;
}

export interface Fixtures {
  /** A customer organisation: optional-MFA admin, requester and an MFA-required finance user. */
  customer: { organisationId: string; admin: Person; requester: Person; finance: Person };
  /** An individual customer organisation, to give a user a second membership. */
  individual: { organisationId: string; admin: Person };
  platform: { organisationId: string; ops: Person };
}

let ipCounter = 0;

/**
 * The API in-process on a real database, as the `app_rw` login role under row-level
 * security, with a clock, a mailer and secrets that tests control.
 *
 * Every request comes from its own address (`X-Forwarded-For`, one trusted proxy hop), so
 * the per-IP OTP limit does not couple unrelated tests.
 */
export function useIdentityApp(
  setup: {
    imports?: ModuleMetadata['imports'];
    /** Replaces providers or guards before the module is compiled (negative controls). */
    configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
) {
  const platform = usePlatform();
  const clock = new FixedClock(START);
  const mailer = new InMemoryOtpMailer();
  const env = testIdentityEnv();
  let app: INestApplication<Server> | undefined;
  const previousProxy = process.env.API_TRUST_PROXY_HOPS;

  beforeAll(async () => {
    process.env.API_TRUST_PROXY_HOPS = '1';
    const builder = Test.createTestingModule({
      imports: [AppModule, ...(setup.imports ?? [])],
    })
      .overrideProvider(PRISMA_CLIENT)
      .useValue(platform.api())
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(OTP_MAILER)
      .useValue(mailer)
      .overrideProvider(IDENTITY_ENV)
      .useValue(env);
    const moduleRef = await (setup.configure?.(builder) ?? builder).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (previousProxy === undefined) delete process.env.API_TRUST_PROXY_HOPS;
    else process.env.API_TRUST_PROXY_HOPS = previousProxy;
  });

  const http = () => {
    if (!app) throw new Error('the app is not ready');
    return contractRequest(app);
  };

  const freshAddress = (): string => {
    ipCounter += 1;
    return `10.${String((ipCounter >> 16) & 255)}.${String((ipCounter >> 8) & 255)}.${String(ipCounter & 255)}`;
  };

  /** Options for a call: bearer token, idempotency key (on POSTs), a fresh client address. */
  const options = (
    extra: ContractRequestOptions & {
      token?: string;
      cookie?: string;
      origin?: string;
      post?: boolean;
    } = {},
  ): ContractRequestOptions => {
    const { token, cookie, origin, post, headers, ...rest } = extra;
    return {
      ...rest,
      headers: {
        'X-Forwarded-For': freshAddress(),
        ...(post === true ? { 'Idempotency-Key': randomUUID() } : {}),
        ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie !== undefined ? { Cookie: `lc_refresh=${cookie}` } : {}),
        ...(origin !== undefined ? { Origin: origin } : {}),
        ...headers,
      },
    };
  };

  const api = {
    get: (path: string, extra: Parameters<typeof options>[0] = {}) =>
      http().get(path, options(extra)),
    post: (path: string, extra: Parameters<typeof options>[0] = {}) =>
      http().post(path, options({ post: true, ...extra })),
    /** PATCH takes no `Idempotency-Key` in the contract. */
    patch: (path: string, extra: Parameters<typeof options>[0] = {}) =>
      http().patch(path, options(extra)),
  };

  /** Calls a route that is not in the contract (test-only controllers added through `setup.imports`). */
  const probe = {
    get: (path: string, extra: Parameters<typeof options>[0] = {}) => {
      if (!app) throw new Error('the app is not ready');
      return undocumentedRequest(app).get(path, options(extra));
    },
    post: (path: string, extra: Parameters<typeof options>[0] = {}) => {
      if (!app) throw new Error('the app is not ready');
      return undocumentedRequest(app).post(path, options({ post: true, ...extra }));
    },
  };

  /** Asks for a code, reads it from the mailer. */
  const requestCode = async (email: string, extra: Parameters<typeof options>[0] = {}) => {
    const response = await api.post('/v1/auth/otp/request', {
      body: { email, purpose: 'LOGIN' },
      ...extra,
    });
    return { response, code: mailer.lastCodeFor(email.trim().toLowerCase()) };
  };

  /** Signs in by email OTP, through the API. */
  const signIn = async (email: string) => {
    const { code } = await requestCode(email);
    if (code === undefined) throw new Error('no code was sent');
    const response = await api.post('/v1/auth/otp/verify', { body: { email, code } });
    const cookie = refreshCookie(response)?.value;
    return {
      response,
      accessToken: (response.body as { accessToken: string }).accessToken,
      mfaRequired: (response.body as { mfaRequired: boolean }).mfaRequired,
      ...(cookie !== undefined && { cookie }),
    };
  };

  /** The TOTP code for the current time of the test clock. */
  const totpNow = (secretBase32: string, offsetSteps = 0): string =>
    totpAt(base32Decode(secretBase32), clock.now().getTime() + offsetSteps * 30_000);

  /** Enrols a user's MFA through the API with a partial or full token, and returns the secret. */
  const enrol = async (token: string) => {
    const started = await api.post('/v1/auth/mfa/enrol', { token });
    const secret = (started.body as { secret: string }).secret;
    const confirmed = await api.post('/v1/auth/mfa/enrol/confirm', {
      token,
      body: { code: totpNow(secret) },
    });
    return {
      secret,
      started,
      confirmed,
      recoveryCodes: (confirmed.body as { recoveryCodes?: string[] }).recoveryCodes ?? [],
    };
  };

  /** Signs in an MFA-required user and finishes MFA: a full session with MFA done. */
  const signInWithMfa = async (email: string, secret?: string) => {
    const first = await signIn(email);
    let key = secret;
    let recoveryCodes: string[] = [];
    if (key === undefined) {
      const enrolment = await enrol(first.accessToken);
      key = enrolment.secret;
      recoveryCodes = enrolment.recoveryCodes;
      clock.advance(30_000);
    }
    const verified = await api.post('/v1/auth/mfa/verify', {
      token: first.accessToken,
      body: { code: totpNow(key) },
    });
    const body = verified.body as { accessToken: string };
    return {
      secret: key,
      recoveryCodes,
      response: verified,
      accessToken: body.accessToken,
      cookie: refreshCookie(verified)?.value,
    };
  };

  const owner = <T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> => platform.owner().$transaction(work, options);

  /** The running app, for tests that call routes with their own request builder. */
  const appOf = (): INestApplication<Server> => {
    if (!app) throw new Error('the app is not ready');
    return app;
  };

  const personOf = async (id: string): Promise<Person> => {
    const row = await platform
      .db()
      .query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [id]);
    return { id, email: row.rows[0]?.email ?? '' };
  };

  const fixtures = async (): Promise<Fixtures> => {
    const customer = await owner((tx) => createCustomer(tx));
    const individual = await owner((tx) => createCustomer(tx, { segment: 'INDIVIDUAL' }));
    const team = await owner((tx) => createPlatformTeam(tx));
    return {
      customer: {
        organisationId: customer.organisationId,
        admin: await personOf(customer.admin),
        requester: await personOf(customer.requester ?? ''),
        finance: await personOf(customer.finance ?? ''),
      },
      individual: {
        organisationId: individual.organisationId,
        admin: await personOf(individual.admin),
      },
      platform: { organisationId: team.organisationId, ops: await personOf(team.ops) },
    };
  };

  /** A user with no membership at all (as after customer self-signup), signed up through the API. */
  const newEmail = (label = 'new'): string => `${label}.${randomUUID().slice(0, 8)}@example.test`;

  /** The live session row of a user in the database. */
  const sessionRows = async (userId: string) =>
    (
      await platform.db().query<{
        id: string;
        token_family_id: string;
        revoked_at: Date | null;
        revoked_reason: string | null;
      }>('SELECT id, token_family_id, revoked_at, revoked_reason FROM user_session WHERE user_id = $1 ORDER BY created_at, id', [userId])
    ).rows;

  return {
    ...platform,
    clock,
    mailer,
    env,
    api,
    probe,
    app: appOf,
    owner,
    fixtures,
    newEmail,
    requestCode,
    signIn,
    signInWithMfa,
    enrol,
    totpNow,
    sessionRows,
    addMember,
    personOf,
  };
}
