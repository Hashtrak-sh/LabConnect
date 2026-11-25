import { Module } from '@nestjs/common';
import { PaymentsWorkerModule } from './modules/payments/payments-worker.module.js';
import { PlatformWorkerModule } from './modules/platform/platform-worker.module.js';

// Worker modules for later phases (notifications, search, files, reports consumers and
// the timer processor) are added here. See docs/02-architecture/MODULE_BOUNDARIES.md.
@Module({
  imports: [PlatformWorkerModule, PaymentsWorkerModule],
})
export class WorkerModule {}
