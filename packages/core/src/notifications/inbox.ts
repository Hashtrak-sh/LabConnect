import type { NotifChannel, Prisma } from '@labconnect/database';
import { uuidv7 } from '@labconnect/database';
import { CoreError } from '../platform/errors.js';
import type { Clock } from '../platform/clock.js';
import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';
import { isUuid } from '../identity/repository.js';

// What a signed-in user reads and changes about their own notifications: the in-app inbox
// and the mute settings. The API runs it through `TenantScope.runAsUser`, so row-level security
// shows the user only their own rows; every query also names the user, so a platform or system
// context (which RLS lets see everything) would still be limited to one person. Nothing here
// takes a user or organisation id from the request.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export class NotificationError extends CoreError {
  override name = 'NotificationError';
}

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; limit: number };
}

export interface InboxItem {
  id: string;
  organisationId: string;
  eventCode: string;
  isActionRequired: boolean;
  payload: Prisma.JsonObject;
  createdAt: Date;
  readAt: Date | null;
}

export interface PreferenceItem {
  eventCode: string;
  channel: NotifChannel;
  muted: boolean;
}

export interface Paging {
  cursor?: string | undefined;
  limit?: number | undefined;
}

interface Cursor {
  /** ISO time of the last item of the previous page. */
  t: string;
  /** Its id. */
  i: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof parsed.t === 'string' &&
      !Number.isNaN(new Date(parsed.t).getTime()) &&
      typeof parsed.i === 'string' &&
      isUuid(parsed.i)
    ) {
      return { t: parsed.t, i: parsed.i };
    }
  } catch {
    // fall through to the error below
  }
  throw new NotificationError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

function pageSize(limit: number | undefined): number {
  const size = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new NotificationError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(MAX_PAGE_SIZE)}.`,
    });
  }
  return size;
}

/** In-app rows that a user can see: delivered ones. A `SUPPRESSED` row (muted) never appears. */
const VISIBLE = ['SENT', 'DELIVERED'] as const;

export class NotificationInbox {
  /**
   * @param tx   a transaction of `TenantScope.runAsUser(userId, ...)`
   * @param userId the signed-in user, from the session
   * @param clock  for `readAt`
   */
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly userId: string,
    private readonly clock: Clock,
  ) {}

  /**
   * The user's in-app notifications in one organisation (the active membership's), newest first.
   * With `organisationId` `null` (no active membership) the inbox is empty: a notification always
   * belongs to an organisation the user was a member of.
   */
  async list(
    organisationId: string | null,
    options: Paging & { unread?: boolean | undefined } = {},
  ): Promise<Page<InboxItem>> {
    const limit = pageSize(options.limit);
    const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    if (organisationId === null) return { data: [], page: { nextCursor: null, limit } };

    const rows = await this.tx.notification.findMany({
      where: {
        recipientUserId: this.userId,
        organisationId,
        channel: 'IN_APP',
        status: { in: [...VISIBLE] },
        ...(options.unread === true ? { readAt: null } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.t) } },
                { createdAt: new Date(cursor.t), id: { lt: cursor.i } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        organisationId: true,
        eventCode: true,
        isActionRequired: true,
        payload: true,
        createdAt: true,
        readAt: true,
      },
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      data: items.map((row) => ({
        ...row,
        payload:
          typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)
            ? row.payload
            : {},
      })),
      page: {
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id })
            : null,
        limit,
      },
    };
  }

  /**
   * Sets `readAt` once. Marking a read notification again changes nothing. A notification of
   * another user, of another organisation, an unknown id and a non-UUID are all `404 NOT_FOUND`.
   */
  async markRead(organisationId: string | null, id: string): Promise<void> {
    if (organisationId === null || !isUuid(id)) throw new NotificationError('NOT_FOUND');
    const own = await this.tx.notification.findFirst({
      where: {
        id,
        recipientUserId: this.userId,
        organisationId,
        channel: 'IN_APP',
        status: { in: [...VISIBLE] },
      },
      select: { id: true },
    });
    if (!own) throw new NotificationError('NOT_FOUND');
    await this.tx.notification.updateMany({
      where: { id, recipientUserId: this.userId, readAt: null },
      data: { readAt: this.clock.now() },
    });
  }

  /** The user's stored mute settings, by event code and channel. */
  async listPreferences(options: Paging = {}): Promise<Page<PreferenceItem>> {
    const limit = pageSize(options.limit);
    const after = options.cursor === undefined ? undefined : decodeOffset(options.cursor);
    const rows = await this.tx.notificationPreference.findMany({
      where: { userId: this.userId },
      orderBy: [{ eventCode: 'asc' }, { channel: 'asc' }],
      skip: after ?? 0,
      take: limit + 1,
      select: { eventCode: true, channel: true, muted: true },
    });
    const items = rows.slice(0, limit);
    return {
      data: items,
      page: {
        nextCursor: rows.length > limit ? encodeOffset((after ?? 0) + limit) : null,
        limit,
      },
    };
  }

  /**
   * Stores each pair. Event codes must be notification events. Muting an action-required
   * notification is stored (the contract says so) and has no effect when sending. Each pair
   * is written once, the last entry of a repeated pair wins.
   */
  async setPreferences(preferences: readonly PreferenceItem[]): Promise<void> {
    const last = new Map<string, PreferenceItem>();
    for (const item of preferences) {
      if (!NOTIFICATION_EVENT_TYPES.has(item.eventCode)) {
        throw new NotificationError('VALIDATION_FAILED', {
          detail: `${item.eventCode.slice(0, 100)} is not a notification event.`,
        });
      }
      last.set(`${item.eventCode}|${item.channel}`, item);
    }
    for (const item of last.values()) {
      await this.tx.notificationPreference.upsert({
        where: {
          userId_eventCode_channel: {
            userId: this.userId,
            eventCode: item.eventCode,
            channel: item.channel,
          },
        },
        create: {
          id: uuidv7(this.clock.now().getTime()),
          userId: this.userId,
          eventCode: item.eventCode,
          channel: item.channel,
          muted: item.muted,
          createdByUserId: this.userId,
        },
        update: { muted: item.muted },
      });
    }
  }
}

// Preferences are listed in a fixed order of (event, channel), so a plain offset is a stable cursor.
function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeOffset(raw: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isSafeInteger(parsed.o) && parsed.o >= 0) {
      return parsed.o;
    }
  } catch {
    // fall through
  }
  throw new NotificationError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}
