import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications, the API side (P3-08): the signed-in user's inbox and mute settings. The rows
 * are written by the worker's consumer (`packages/core/src/notifications`); nothing here is
 * called while a business write happens (MODULE_BOUNDARIES.md rule 5). The admin operations on
 * templates are not built yet.
 */
@Module({
  imports: [PlatformModule, IdentityModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
