import { type BookingEngine, PaymentsRuntime } from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { BOOKING_ENGINE } from '../booking/booking.module.js';
import { PAYMENTS_ENV, PaymentsModule } from './payments.module.js';

describe('PaymentsModule', () => {
  it("uses the API's one booking engine (the full transition registry), not one of its own", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PaymentsModule] })
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
