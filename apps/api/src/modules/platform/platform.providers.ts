import { Injectable, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import {
  AuditService,
  BusinessCalendarLoader,
  type Clock,
  ConfigParameters,
  createApiPrisma,
  type LazyPrisma,
  OutboxService,
  SystemClock,
  TimerService,
} from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';

/** Injection tokens for values that are interfaces or third-party classes. */
export const CLOCK = Symbol('CLOCK');
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

/**
 * The API's database connection: the `app_rw` login user in `API_DATABASE_URL`. It
 * connects on first use, so the API boots (and its tests run) without a database.
 */
@Injectable()
export class ApiDatabase implements OnApplicationShutdown {
  private readonly lazy: LazyPrisma = createApiPrisma();

  get client(): PrismaClient {
    return this.lazy.client;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.lazy.disconnect();
  }
}

/** Thin Nest wrappers over `@labconnect/core/platform` (ADR-020). Override `CLOCK` in tests. */
export const platformProviders: Provider[] = [
  ApiDatabase,
  { provide: CLOCK, useFactory: (): Clock => new SystemClock() },
  { provide: PRISMA_CLIENT, useFactory: (db: ApiDatabase) => db.client, inject: [ApiDatabase] },
  { provide: AuditService, useFactory: (clock: Clock) => new AuditService(clock), inject: [CLOCK] },
  {
    provide: OutboxService,
    useFactory: (clock: Clock) => new OutboxService(clock),
    inject: [CLOCK],
  },
  {
    provide: TimerService,
    useFactory: (clock: Clock) => new TimerService(clock),
    inject: [CLOCK],
  },
  {
    provide: BusinessCalendarLoader,
    useFactory: (clock: Clock) => new BusinessCalendarLoader(clock),
    inject: [CLOCK],
  },
  {
    provide: ConfigParameters,
    useFactory: (clock: Clock, audit: AuditService) => new ConfigParameters(clock, audit),
    inject: [CLOCK, AuditService],
  },
];
