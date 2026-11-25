import { Inject, Injectable } from '@nestjs/common';
import {
  type Clock,
  type CurrentActor,
  type InboxItem,
  NotificationInbox,
  type Page,
  type PreferenceItem,
  TenantScope,
} from '@labconnect/core';
import { CLOCK } from '../platform/platform.providers.js';
import type { ListQuery } from './notifications.dto.js';

/** The contract's `Notification`. */
export interface NotificationBody {
  id: string;
  organisationId: string;
  eventCode: string;
  isActionRequired: boolean;
  payload: InboxItem['payload'];
  createdAt: string;
  readAt: string | null;
}

/**
 * The signed-in user's notifications and mute settings. Everything runs as the user alone
 * (`TenantScope.runAsUser`): row-level security shows only their own rows, the inbox also names
 * the user in every query, and the organisation comes from the actor (the active membership),
 * never from the request. The system context is not used here.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly scope: TenantScope,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: CurrentActor, query: ListQuery): Promise<Page<NotificationBody>> {
    const page = await this.scope.runAsUser(actor.userId, (tx) =>
      new NotificationInbox(tx, actor.userId, this.clock).list(actor.orgId, query),
    );
    return {
      data: page.data.map((item) => ({
        id: item.id,
        organisationId: item.organisationId,
        eventCode: item.eventCode,
        isActionRequired: item.isActionRequired,
        payload: item.payload,
        createdAt: item.createdAt.toISOString(),
        readAt: item.readAt === null ? null : item.readAt.toISOString(),
      })),
      page: page.page,
    };
  }

  markRead(actor: CurrentActor, id: string): Promise<void> {
    return this.scope.runAsUser(actor.userId, (tx) =>
      new NotificationInbox(tx, actor.userId, this.clock).markRead(actor.orgId, id),
    );
  }

  listPreferences(
    actor: CurrentActor,
    query: Pick<ListQuery, 'cursor' | 'limit'>,
  ): Promise<Page<PreferenceItem>> {
    return this.scope.runAsUser(actor.userId, (tx) =>
      new NotificationInbox(tx, actor.userId, this.clock).listPreferences(query),
    );
  }

  setPreferences(actor: CurrentActor, preferences: readonly PreferenceItem[]): Promise<void> {
    return this.scope.runAsUser(actor.userId, (tx) =>
      new NotificationInbox(tx, actor.userId, this.clock).setPreferences(preferences),
    );
  }
}
