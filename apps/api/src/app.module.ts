import { Module } from '@nestjs/common';
import { CustomersModule } from './modules/customers/customers.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { LabsModule } from './modules/labs/labs.module.js';
import { MasterdataModule } from './modules/masterdata/masterdata.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';

// Domain modules (files, masterdata, labs, customers, search, booking,
// custody, reports, payments, disputes, notifications, admin) are added from
// Phase 3 onwards. See docs/02-architecture/MODULE_BOUNDARIES.md.
@Module({
  imports: [
    PlatformModule,
    IdentityModule,
    FilesModule,
    PaymentsModule,
    NotificationsModule,
    SearchModule,
    LabsModule,
    MasterdataModule,
    CustomersModule,
  ],
})
export class AppModule {}
