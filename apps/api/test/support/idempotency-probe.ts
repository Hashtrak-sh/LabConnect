import 'reflect-metadata';
import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { DomainError } from '../../src/common/domain-error.js';
import { Idempotent } from '../../src/common/idempotency.interceptor.js';
import { Authorised } from '../../src/modules/identity/authorised.decorator.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { PlatformModule } from '../../src/modules/platform/platform.module.js';

// Test-only routes for the Idempotency-Key interceptor (I1-SHR-01). The real app has no route
// behind `@Idempotent()` yet, so the mechanism is proved on these. A testing module adds them.

/** What the tests drive: how often a handler really ran, and gates to hold a handler open. */
export const idempotencyProbe = {
  runs: 0,
  failNext: false,
  hold: undefined as Promise<void> | undefined,
  reset(): void {
    this.runs = 0;
    this.failNext = false;
    this.hold = undefined;
  },
};

@Controller('idem-probe')
export class IdempotencyProbeController {
  /** Default status for a POST: 201. */
  @Post('create')
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  create(@Body() body: { name?: string }): { run: number; name?: string | undefined } {
    idempotencyProbe.runs += 1;
    return { run: idempotencyProbe.runs, name: body.name };
  }

  @Post('items/:id/touch')
  @HttpCode(200)
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  touch(@Param('id') id: string): { run: number; id: string } {
    idempotencyProbe.runs += 1;
    return { run: idempotencyProbe.runs, id };
  }

  /** Waits for the test to open the gate. */
  @Post('slow')
  @HttpCode(200)
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  async slow(): Promise<{ run: number }> {
    idempotencyProbe.runs += 1;
    const run = idempotencyProbe.runs;
    await idempotencyProbe.hold;
    return { run };
  }

  /** A 500 the first time the test asks for it, then a success. */
  @Post('flaky')
  @HttpCode(200)
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  flaky(): { run: number } {
    idempotencyProbe.runs += 1;
    if (idempotencyProbe.failNext) {
      idempotencyProbe.failNext = false;
      throw new Error('the database is down');
    }
    return { run: idempotencyProbe.runs };
  }

  /** A business answer: 409, with meta. */
  @Post('conflict')
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  conflict(): never {
    idempotencyProbe.runs += 1;
    throw new DomainError('INVALID_STATE_TRANSITION', {
      detail: 'The thing is already closed.',
      meta: { currentState: 'CLOSED' },
    });
  }

  /** A validation answer: 422 with field errors. */
  @Post('invalid')
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  invalid(): never {
    idempotencyProbe.runs += 1;
    throw new DomainError('VALIDATION_FAILED', {
      errors: [{ path: 'name', code: 'required', message: 'name is required' }],
    });
  }

  /** Decided by the handler, but depends on who calls: never stored. */
  @Post('forbidden')
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  forbidden(): never {
    idempotencyProbe.runs += 1;
    throw new DomainError('FORBIDDEN');
  }

  /** The response body carries a marker, so a test can look for it in the logs. */
  @Post('echo')
  @Authorised({ permission: 'lab.search' })
  @Idempotent()
  echo(@Body() body: { secret: string }): { reply: string } {
    return { reply: `reply:${body.secret}` };
  }

  /** Forgot @Authorised: the interceptor must refuse, not run. */
  @Post('unguarded')
  @Idempotent()
  unguarded(): { ran: true } {
    idempotencyProbe.runs += 1;
    return { ran: true };
  }
}

@Module({
  imports: [IdentityModule, PlatformModule],
  controllers: [IdempotencyProbeController],
})
export class IdempotencyProbeModule {}
