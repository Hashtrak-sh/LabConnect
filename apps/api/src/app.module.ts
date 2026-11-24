import { Module } from '@nestjs/common';
import { PlatformModule } from './modules/platform/platform.module.js';

// Domain modules (identity, files, masterdata, labs, customers, search, booking,
// custody, reports, payments, disputes, notifications, admin) are added from
// Phase 3 onwards. See docs/02-architecture/MODULE_BOUNDARIES.md.
@Module({
  imports: [PlatformModule],
})
export class AppModule {}
