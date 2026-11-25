import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { PreferenceItem, Page } from '@labconnect/core';
import { Authorised } from '../identity/authorised.decorator.js';
import { CurrentActor } from '../identity/current-actor.js';
import { parseListQuery, parsePreferencesUpdate } from './notifications.dto.js';
import { type NotificationBody, NotificationsService } from './notifications.service.js';

/**
 * The user's own notifications under `/v1/me` (API_CONTRACTS.md section 1, `paths/me.yaml`).
 * `noPermissionRequired`: every signed-in user has an inbox and mute settings, and no matrix row
 * applies to reading one's own. A user with no membership gets an empty inbox, because a
 * notification always belongs to an organisation they were a member of. The user is always the
 * actor's, so another user's notification id is `404 NOT_FOUND`.
 */
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @Authorised({ noPermissionRequired: true })
  listNotifications(
    @CurrentActor() actor: CurrentActor,
    @Query() query: Record<string, unknown>,
  ): Promise<Page<NotificationBody>> {
    return this.notifications.list(actor, parseListQuery(query, true));
  }

  /** `Idempotency-Key` is accepted and ignored, like the identity POSTs (OQ-87): marking read twice is harmless. */
  @Post('notifications/:id/read')
  @HttpCode(204)
  @Authorised({ noPermissionRequired: true })
  async markNotificationRead(
    @CurrentActor() actor: CurrentActor,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markRead(actor, id);
  }

  @Get('notification-preferences')
  @Authorised({ noPermissionRequired: true })
  listNotificationPreferences(
    @CurrentActor() actor: CurrentActor,
    @Query() query: Record<string, unknown>,
  ): Promise<Page<PreferenceItem>> {
    return this.notifications.listPreferences(actor, parseListQuery(query, false));
  }

  @Patch('notification-preferences')
  @HttpCode(204)
  @Authorised({ noPermissionRequired: true })
  async updateNotificationPreferences(
    @CurrentActor() actor: CurrentActor,
    @Body() body: unknown,
  ): Promise<void> {
    await this.notifications.setPreferences(actor, parsePreferencesUpdate(body));
  }
}
