import 'reflect-metadata';
import { type BookingEngine, PaymentsRuntime } from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { BOOKING_ENGINE } from '../booking/booking-worker.module.js';
import { JOBS_CONFIG } from '../platform/platform-worker.module.js';
import { PAYMENTS_ENV, PaymentsWorkerModule } from './payments-worker.module.js';

describe('PaymentsWorkerModule', () => {
  it('uses the worker booking engine, not one of its own', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PaymentsWorkerModule] })
      .overrideProvider(JOBS_CONFIG)
      .useValue({ enabled: false })
      .overrideProvider(PAYMENTS_ENV)
      .useValue({})
      .compile();
    const engine = moduleRef.get<BookingEngine>(BOOKING_ENGINE, { strict: false });
    const runtime = moduleRef.get(PaymentsRuntime);
    // `engine` is private to the runtime; this is the only way to see which engine it holds.
    expect((runtime as unknown as { engine: unknown }).engine).toBe(engine);
    await moduleRef.close();
  });
});
