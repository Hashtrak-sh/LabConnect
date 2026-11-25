import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { FakePaymentGateway, PaymentsRuntime } from '@labconnect/core';
import { afterAll, beforeAll } from 'vitest';
import { useBookingHarness } from '../../../../packages/core/test/db/booking-support.js';
import { configureApp } from '../../src/app.config.js';
import { AppModule } from '../../src/app.module.js';
import { PAYMENTS_ENV, type PaymentsEnv } from '../../src/modules/payments/payments.module.js';
import { CLOCK, PRISMA_CLIENT } from '../../src/modules/platform/platform.providers.js';
import { contractRequest } from './contract/index.js';

export const FAKE_SECRET = 'fake-http-secret-0123456789';

export function testPaymentsEnv(): PaymentsEnv {
  return {
    PAYMENT_GATEWAY: 'fake',
    PAYMENT_FAKE_WEBHOOK_SECRET: FAKE_SECRET,
    PAYMENT_PAYLOAD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
}

/**
 * The API in-process on a real database as the `app_rw` role, with the booking fixtures of the
 * core database tests, a clock the test controls and the fake gateway the webhook route uses.
 */
export function usePaymentsApp() {
  const h = useBookingHarness();
  const env = testPaymentsEnv();
  let app: INestApplication<Server> | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PRISMA_CLIENT)
      .useValue(h.api())
      .overrideProvider(CLOCK)
      .useValue(h.clock)
      .overrideProvider(PAYMENTS_ENV)
      .useValue(env)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const need = (): INestApplication<Server> => {
    if (!app) throw new Error('the app is not ready');
    return app;
  };
  const runtime = (): PaymentsRuntime => need().get(PaymentsRuntime);
  const gateway = (): FakePaymentGateway => {
    const gw = runtime().gateway;
    if (!(gw instanceof FakePaymentGateway)) throw new Error('the fake gateway is not configured');
    return gw;
  };

  return {
    ...h,
    env,
    http: () => contractRequest(need()),
    server: () => need().getHttpServer(),
    runtime,
    gateway,
  };
}
