import { Module } from '@nestjs/common';
import { PlatformWorkerModule } from './modules/platform/platform-worker.module.js';

// Worker modules for later phases (notifications, search, files, reports consumers and
// the timer processor) are added here. See docs/02-architecture/MODULE_BOUNDARIES.md.
@Module({
  imports: [PlatformWorkerModule],
})
export class WorkerModule {}
