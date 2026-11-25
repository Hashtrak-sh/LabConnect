import 'reflect-metadata';
import type { TimerHandlerRegistry } from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  JOBS_CONFIG,
  JOBS_SCHEDULER,
  PlatformWorkerModule,
  TIMER_HANDLERS,
} from '../platform/platform-worker.module.js';
import type { PlatformJobsConfig } from '../platform/platform-jobs.config.js';
import { BookingTimersRegistrar, BookingWorkerModule } from './booking-worker.module.js';

const off: PlatformJobsConfig = {
  enabled: false,
  relayIntervalMs: 10,
  relayBatchSize: 5,
  sealIntervalMs: 20,
  sealBatchSize: 5,
  verifyIntervalMs: 30,
  timerIntervalMs: 25,
  timerBatchSize: 5,
};

/** Every timer type `createBookingTimerHandlers` handles when it is given the payments check. */
const BOOKING_TIMER_TYPES = [
  'COUNTER_RESPONSE_DUE',
  'DISPUTE_WINDOW_END',
  'DROP_DEADLINE',
  'DROP_REMINDER',
  'HOLD_DECISION_DUE',
  'LAB_DECISION_DUE',
  'LAB_DECISION_REMINDER_50',
  'LAB_DECISION_REMINDER_90',
  'NO_SHOW_DUE',
  'PAYMENT_DUE',
  'PAYMENT_REMINDER',
  'RECEIPT_APPROVAL_REMINDER',
  'REPORT_APPROVAL_REMINDER',
];

describe('BookingWorkerModule', () => {
  it.each([
    ['booking module first', [BookingWorkerModule, PlatformWorkerModule]],
    ['platform module first', [PlatformWorkerModule, BookingWorkerModule]],
  ])(
    'registers the booking timer handlers once, whatever the import order (%s)',
    async (_name, imports) => {
      const moduleRef = await Test.createTestingModule({ imports })
        .overrideProvider(JOBS_CONFIG)
        .useValue(off)
        .overrideProvider(JOBS_SCHEDULER)
        .useValue({ setInterval: () => undefined, clearInterval: () => undefined })
        .compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      const registry = moduleRef.get<TimerHandlerRegistry>(TIMER_HANDLERS, { strict: false });
      expect([...registry.types()].sort()).toEqual(BOOKING_TIMER_TYPES);

      // A second init of the registrar does nothing (the registry would refuse a duplicate).
      expect(() => {
        moduleRef.get(BookingTimersRegistrar).onModuleInit();
      }).not.toThrow();
      expect(registry.types()).toHaveLength(BOOKING_TIMER_TYPES.length);
      await app.close();
    },
  );
});
