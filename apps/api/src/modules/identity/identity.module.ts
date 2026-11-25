import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { IdentityService } from './identity.service.js';
import { IDENTITY_ENV, type IdentityEnv, IdentityRuntime } from './identity.runtime.js';
import { MeController } from './me.controller.js';
import { MembershipGuard } from './membership.guard.js';
import { MfaGuard } from './mfa.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { createOtpMailer, OTP_MAILER } from './otp-mailer.js';
import { AuditService, TenantScope } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { PlatformModule } from '../platform/platform.module.js';
import { PRISMA_CLIENT } from '../platform/platform.providers.js';

/**
 * Identity: email OTP sign-in, MFA, sessions and the current user (ADR-006, ADR-020). The
 * logic is in `@labconnect/core`; this module is the HTTP wiring. Secrets are read from the
 * environment when first used (`IdentityRuntime`), so the module loads without them.
 *
 * Other modules import this module and protect their routes with `@Authorised(...)` (guards in
 * order: `AuthGuard`, `MembershipGuard`, `PermissionGuard`, `MfaGuard`), read `@CurrentActor()`, and
 * run their database work through `TenantScope` (P3-04).
 */
@Module({
  imports: [PlatformModule],
  controllers: [AuthController, MeController],
  providers: [
    { provide: IDENTITY_ENV, useFactory: (): NodeJS.ProcessEnv => process.env },
    IdentityRuntime,
    {
      // Built when the API starts: in a deployed environment without a real sender it throws.
      provide: OTP_MAILER,
      useFactory: (env: IdentityEnv) => createOtpMailer(env),
      inject: [IDENTITY_ENV],
    },
    {
      provide: TenantScope,
      useFactory: (prisma: PrismaClient, audit: AuditService) => new TenantScope(prisma, audit),
      inject: [PRISMA_CLIENT, AuditService],
    },
    IdentityService,
    AuthGuard,
    MembershipGuard,
    PermissionGuard,
    MfaGuard,
  ],
  exports: [AuthGuard, MembershipGuard, PermissionGuard, MfaGuard, IdentityService, TenantScope],
})
export class IdentityModule {}
