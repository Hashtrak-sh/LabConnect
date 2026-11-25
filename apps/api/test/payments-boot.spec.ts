import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.config.js';
import { AppModule } from '../src/app.module.js';
import { PAYMENTS_ENV, type PaymentsEnv } from '../src/modules/payments/payments.module.js';
import { contractRequest } from './support/contract/index.js';

// The payments module's start-up rules and what needs no database or secret. No Docker needed.

async function boot(env: PaymentsEnv): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENTS_ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<Server>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('payments module configuration', () => {
  it('starts with the fake gateway, with or without its secrets (they are read on first use)', async () => {
    const app = await boot({ PAYMENT_GATEWAY: 'fake' });
    await app.close();
    const bare = await boot({});
    await bare.close();
  });

  it('fails to start for any gateway that is not the fake, saying no adapter exists', async () => {
    for (const name of ['icici', 'ICICI', 'other']) {
      await expect(boot({ PAYMENT_GATEWAY: name })).rejects.toThrow(
        /no adapter for a real payment gateway exists yet/,
      );
    }
  });

  it('fails to start with the fake in production, and starts in UAT, which sets APP_ENV=uat', async () => {
    await expect(boot({ PAYMENT_GATEWAY: 'fake', NODE_ENV: 'production' })).rejects.toThrow(
      /not allowed in production/,
    );
    await expect(boot({ PAYMENT_GATEWAY: 'fake', APP_ENV: 'production' })).rejects.toThrow(
      /not allowed in production/,
    );
    await expect(boot({ NODE_ENV: 'production' })).rejects.toThrow(/PAYMENT_GATEWAY is not set/);
    const uat = await boot({ PAYMENT_GATEWAY: 'fake', NODE_ENV: 'production', APP_ENV: 'uat' });
    await uat.close();
  });
});

describe('the webhook route without a database or secrets', () => {
  it('answers 404 for a gateway that is not enabled, before reading any secret or touching a database', async () => {
    const app = await boot({ PAYMENT_GATEWAY: 'fake' });
    try {
      const response = await contractRequest(app).post('/v1/webhooks/payments/ICICI', {
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });

  it('answers a bare 500 for the enabled gateway when its secret is missing, never naming it', async () => {
    const app = await boot({ PAYMENT_GATEWAY: 'fake' });
    try {
      const response = await contractRequest(app).post('/v1/webhooks/payments/FAKE', {
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toMatch(/PAYMENT_|secret/i);
    } finally {
      await app.close();
    }
  });
});
