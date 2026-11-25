// Test-only controllers that prove the permission generator and the declaration rules work
// (P3-05). They are never part of the real app: a testing module adds them. Controller names start
// with `Fixture` so the route reader can select them without the real identity routes.
//
// `FixtureGoodController`: one route per category, all declared correctly. The rules must find
// nothing, and the matrix must pass on it.
// `FixtureBadController`: one deliberate mistake per route. The rules must report each of them.
import { Body, Controller, Get, HttpCode, Module, Param, Post, UseGuards } from '@nestjs/common';
import { DomainError } from '../../../src/common/domain-error.js';
import { AuthGuard } from '../../../src/modules/identity/auth.guard.js';
import { Authorised } from '../../../src/modules/identity/authorised.decorator.js';
import { IdentityModule } from '../../../src/modules/identity/identity.module.js';
import { MembershipGuard } from '../../../src/modules/identity/membership.guard.js';
import { MfaGuard, RequireStepUp } from '../../../src/modules/identity/mfa.guard.js';
import {
  NoPermissionRequired,
  PermissionGuard,
  RequirePermission,
} from '../../../src/modules/identity/permission.guard.js';
import { PlatformModule } from '../../../src/modules/platform/platform.module.js';

const OK = { ok: true } as const;

/** Fails like a real handler does on bad input: after the guards, never before them. */
function validated(body: unknown): { ok: true } {
  const reason = (body as { reason?: unknown } | undefined)?.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new DomainError('VALIDATION_FAILED', { detail: 'reason is required.' });
  }
  return OK;
}

@Controller('fx-good')
export class FixtureGoodController {
  /** Public (allow-listed by the test). */
  @Get('open')
  open(): { ok: true } {
    return OK;
  }

  /** A signed-in user, no membership questions. */
  @Get('session')
  @UseGuards(AuthGuard)
  session(): { ok: true } {
    return OK;
  }

  @Get('decide')
  @Authorised({ permission: 'booking.decide' })
  decide(): { ok: true } {
    return OK;
  }

  /** ALL of two codes: only a role that holds both. */
  @Get('pay-and-edit')
  @Authorised({ permission: ['booking.pay', 'booking.create_edit'] })
  payAndEdit(): { ok: true } {
    return OK;
  }

  /** ANY of two codes. */
  @Get('either')
  @Authorised({ anyPermission: ['booking.decide', 'receipt.record'] })
  either(): { ok: true } {
    return OK;
  }

  /** Any signed-in actor, also one with no membership. */
  @Get('anyone')
  @Authorised({ noPermissionRequired: true })
  anyone(): { ok: true } {
    return OK;
  }

  /** A path parameter, and a handler that validates its body (guards must run first). */
  @Post('items/:itemId/edit')
  @HttpCode(200)
  @Authorised({ permission: 'booking.create_edit' })
  edit(@Param('itemId') _itemId: string, @Body() body: unknown): { ok: true } {
    return validated(body);
  }

  @Post('publish')
  @HttpCode(200)
  @Authorised({ permission: 'report.publish', stepUp: true })
  publish(@Body() body: unknown): { ok: true } {
    return validated(body);
  }

  /** A class-agnostic read-only permission every role holds. */
  @Get('search')
  @Authorised({ permission: 'lab.search' })
  search(): { ok: true } {
    return OK;
  }
}

@Controller('fx-bad')
export class FixtureBadController {
  /** A: no guard, not in the allow-list. */
  @Get('unguarded')
  unguarded(): { ok: true } {
    return OK;
  }

  /** B: all four guards, no declaration. */
  @Get('forgotten')
  @UseGuards(AuthGuard, MembershipGuard, PermissionGuard, MfaGuard)
  forgotten(): { ok: true } {
    return OK;
  }

  /** B: a permission is declared but PermissionGuard is not applied, so nothing enforces it. */
  @Post('unenforced')
  @UseGuards(AuthGuard, MembershipGuard)
  @RequirePermission('booking.decide')
  unenforced(): { ok: true } {
    return OK;
  }

  /** B: the guards are stacked in the wrong order. */
  @Get('wrong-order')
  @UseGuards(MembershipGuard, AuthGuard, PermissionGuard, MfaGuard)
  @NoPermissionRequired()
  wrongOrder(): { ok: true } {
    return OK;
  }

  /** D: the contract (fake map of the test) says step-up, the route declares none. */
  @Post('no-step-up')
  @Authorised({ permission: 'report.publish' })
  noStepUp(): { ok: true } {
    return OK;
  }

  /** D: step-up declared, MfaGuard not applied. */
  @Post('step-up-unenforced')
  @UseGuards(AuthGuard, MembershipGuard, PermissionGuard)
  @RequirePermission('report.publish')
  @RequireStepUp()
  stepUpUnenforced(): { ok: true } {
    return OK;
  }

  /** C: x-roles (fake) names Finance only; booking.decide is held by no platform role in the map. */
  @Get('admin-mismatch')
  @Authorised({ permission: 'booking.decide' })
  adminMismatch(): { ok: true } {
    return OK;
  }

  /** C: no permission declared on an /admin route. */
  @Get('admin-open')
  @Authorised({ noPermissionRequired: true })
  adminOpen(): { ok: true } {
    return OK;
  }

  /** C: agrees with x-roles (control: no violation). */
  @Get('admin-agrees')
  @Authorised({ permission: 'audit_log.view' })
  adminAgrees(): { ok: true } {
    return OK;
  }

  /** C: listed as a known difference and still different (control: no violation). */
  @Get('admin-known')
  @Authorised({ permission: 'payout.hold_release' })
  adminKnown(): { ok: true } {
    return OK;
  }

  /** C: listed as a known difference but now agrees (the list must shrink). */
  @Get('admin-known-resolved')
  @Authorised({ permission: 'audit_log.view' })
  adminKnownResolved(): { ok: true } {
    return OK;
  }

  /** A: in the allow-list, but the contract (fake) requires a bearer token. */
  @Get('public-but-bearer')
  publicButBearer(): { ok: true } {
    return OK;
  }

  /** A: in the allow-list, but carries AuthGuard. */
  @Get('listed-but-guarded')
  @UseGuards(AuthGuard)
  listedButGuarded(): { ok: true } {
    return OK;
  }
}

@Module({
  imports: [IdentityModule, PlatformModule],
  controllers: [FixtureGoodController, FixtureBadController],
})
export class PermissionFixtureModule {}

/** Selects the fixture controllers when reading routes (the module also brings the real ones). */
export const isFixtureController = (name: string): boolean => name.startsWith('Fixture');
