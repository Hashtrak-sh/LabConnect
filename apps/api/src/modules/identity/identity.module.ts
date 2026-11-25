import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { IdentityService } from './identity.service.js';
import { IDENTITY_ENV, IdentityRuntime } from './identity.runtime.js';
import { MeController } from './me.controller.js';
import { OTP_MAILER, SmtpOtpMailer } from './smtp-otp-mailer.js';
import { PlatformModule } from '../platform/platform.module.js';

/**
 * Identity: email OTP sign-in, MFA, sessions and the current user (ADR-006, ADR-020). The
 * logic is in `@labconnect/core`; this module is the HTTP wiring. Secrets are read from the
 * environment when first used (`IdentityRuntime`), so the module loads without them.
 *
 * Other modules use `AuthGuard` and `@CurrentSession()` from here. Membership, permission and
 * step-up guards come with task P3-04.
 */
@Module({
  imports: [PlatformModule],
  controllers: [AuthController, MeController],
  providers: [
    { provide: IDENTITY_ENV, useFactory: (): NodeJS.ProcessEnv => process.env },
    IdentityRuntime,
    { provide: OTP_MAILER, useClass: SmtpOtpMailer },
    IdentityService,
    AuthGuard,
  ],
  exports: [AuthGuard, IdentityService],
})
export class IdentityModule {}
