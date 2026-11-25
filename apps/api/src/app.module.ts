import { Module } from '@nestjs/common';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';

// Domain modules (files, masterdata, labs, customers, search, booking,
// custody, reports, payments, disputes, notifications, admin) are added from
// Phase 3 onwards. See docs/02-architecture/MODULE_BOUNDARIES.md.
@Module({
  imports: [PlatformModule, IdentityModule],
})
export class AppModule {}
