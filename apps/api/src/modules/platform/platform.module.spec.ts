import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  AuditService,
  BusinessCalendarLoader,
  type Clock,
  ConfigParameters,
  FixedClock,
  OutboxService,
  SystemClock,
  TimerService,
} from '@labconnect/core';
import { describe, expect, it } from 'vitest';
import { CLOCK, PRISMA_CLIENT } from './platform.providers.js';
import { PlatformModule } from './platform.module.js';

describe('PlatformModule providers', () => {
  it('builds without a database and exposes the platform services', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PlatformModule] }).compile();
    expect(moduleRef.get<Clock>(CLOCK)).toBeInstanceOf(SystemClock);
    expect(moduleRef.get(AuditService)).toBeInstanceOf(AuditService);
    expect(moduleRef.get(OutboxService)).toBeInstanceOf(OutboxService);
    expect(moduleRef.get(ConfigParameters)).toBeInstanceOf(ConfigParameters);
    expect(moduleRef.get(TimerService)).toBeInstanceOf(TimerService);
    expect(moduleRef.get(BusinessCalendarLoader)).toBeInstanceOf(BusinessCalendarLoader);
    // The client exists but has not connected: nothing has touched it yet.
    expect(moduleRef.get(PRISMA_CLIENT)).toBeDefined();
    await moduleRef.close();
  });

  it('fails at the first use, not at boot, when API_DATABASE_URL is missing', async () => {
    const previous = process.env.API_DATABASE_URL;
    delete process.env.API_DATABASE_URL;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [PlatformModule] }).compile();
      const prisma = moduleRef.get<{ $queryRaw: unknown }>(PRISMA_CLIENT);
      expect(() => prisma.$queryRaw).toThrow('API_DATABASE_URL is not set.');
      await moduleRef.close();
    } finally {
      if (previous !== undefined) process.env.API_DATABASE_URL = previous;
    }
  });

  it('lets a test replace the clock and the services follow', async () => {
    const clock = new FixedClock('2026-11-25T10:00:00Z');
    const moduleRef = await Test.createTestingModule({ imports: [PlatformModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    expect(moduleRef.get<Clock>(CLOCK)).toBe(clock);
    await moduleRef.close();
  });
});
