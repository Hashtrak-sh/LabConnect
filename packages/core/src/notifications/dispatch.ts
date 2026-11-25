import {
  type NotifChannel,
  type Prisma,
  type PrismaClient,
  uuidv7,
  withDbContext,
} from '@labconnect/database';
import type { RoleCode } from '@labconnect/shared';
import { findRoleHolders, loadUserContact } from '../identity/recipients.js';
import type { Clock } from '../platform/clock.js';
import type { EventEnvelope } from '../platform/events.js';
import { processOnce } from '../platform/process-once.js';
import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';
import { clipText, formatInr, formatIst } from './format.js';
import {
  type NotificationContext,
  NotificationContextMissingError,
  type NotificationContextPort,
} from './context.js';
import {
  deliveryDecision,
  type DeliveryChannel,
  type EventData,
  type Party,
  rulesFor,
} from './rules.js';
import { CODE_TEMPLATE_VERSION, latestStoredTemplate } from './stored-templates.js';
import { EVENT_VARIABLES, type TemplateData, type TemplateVariable } from './templates.js';

/** The `processed_event.consumer` name of this consumer. */
export const NOTIFICATION_CONSUMER = 'notifications';

const CUSTOMER_ROLES: readonly RoleCode[] = [
  'CUSTOMER_ADMIN',
  'CUSTOMER_REQUESTER',
  'CUSTOMER_FINANCE',
];
const MAX_REASON_LENGTH = 200;

export interface NotificationDeps {
  /** The worker's client (role `app_worker`). All work runs in the system context. */
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
  context: NotificationContextPort;
}

export type HandleNotificationResult =
  | { status: 'ignored' }
  | { status: 'duplicate' }
  | {
      status: 'processed';
      recipients: number;
      inApp: number;
      emailQueued: number;
      suppressed: number;
    };

// ---------------------------------------------------------------- the view model

function asData(value: unknown): EventData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as EventData)
    : {};
}

function firstInstant(data: EventData): Date | undefined {
  for (const key of ['deadlineAt', 'dueAt', 'reportDueAt', 'expiresAt']) {
    const value = data[key];
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return undefined;
}

function paise(value: unknown): bigint | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d{1,18}$/.test(value)) return BigInt(value);
  return undefined;
}

/**
 * The small, already-resolved view model of an event: names from the context, a deadline in
 * IST, an amount in INR, a short reason. Only the variables the event allows are kept
 * (`EVENT_VARIABLES`), so a field that is not on the list never reaches a message, whatever
 * the event or the context carries. `actionUrl` here is a path; the email step makes it absolute.
 */
export function buildTemplateData(
  eventType: string,
  context: NotificationContext,
  data: EventData,
): TemplateData {
  const allowed: readonly TemplateVariable[] = EVENT_VARIABLES[eventType] ?? [];
  const actionPath =
    context.actionPath ?? (context.bookingId ? `/bookings/${context.bookingId}` : undefined);
  const instant = firstInstant(data);
  const amount = paise(data.amountPaise);
  const reason = typeof data.reason === 'string' ? clipText(data.reason, MAX_REASON_LENGTH) : '';
  const candidates: Partial<Record<TemplateVariable, string | undefined>> = {
    bookingNo: context.bookingNo,
    labName: context.labName,
    organisationName: context.organisationName,
    deadline: instant ? formatIst(instant) : undefined,
    reason: reason === '' ? undefined : reason,
    amount: amount === undefined ? undefined : formatInr(amount),
    actionUrl: actionPath,
  };
  const view: Partial<Record<TemplateVariable, string>> = {};
  for (const name of allowed) {
    const value = candidates[name];
    if (value !== undefined && value !== '') view[name] = value;
  }
  return view;
}

// ---------------------------------------------------------------- recipients

export interface Recipient {
  userId: string;
  organisationId: string;
  /** Per channel: whether any rule that gives the user that channel is action-required. */
  channels: Map<DeliveryChannel, { actionRequired: boolean }>;
}

interface Person {
  userId: string;
  organisationId: string;
}

async function peopleOf(
  tx: Prisma.TransactionClient,
  party: Party,
  context: NotificationContext,
): Promise<Person[]> {
  switch (party) {
    case 'CUSTOMER': {
      const people: Person[] = [];
      for (const customer of context.customers ?? []) {
        const named = await findRoleHolders(tx, {
          scope: { organisationId: customer.organisationId },
          roles: CUSTOMER_ROLES,
          userIds: customer.userIds,
        });
        const holders =
          named.length > 0
            ? named
            : await findRoleHolders(tx, {
                scope: { organisationId: customer.organisationId },
                roles: ['CUSTOMER_ADMIN'],
              });
        people.push(...holders);
      }
      return people;
    }
    case 'LAB_MAKER':
    case 'LAB_CHECKER': {
      if (!context.lab) return [];
      return findRoleHolders(tx, {
        scope: { organisationId: context.lab.organisationId },
        roles: [party],
        ...(context.lab.siteId === undefined ? {} : { siteId: context.lab.siteId }),
      });
    }
    case 'OPS':
      return findRoleHolders(tx, { scope: { platform: true }, roles: ['PLATFORM_OPS'] });
    case 'INVITEE': {
      if (!context.invitee) return [];
      const contact = await loadUserContact(tx, context.invitee.userId);
      if (!contact || contact.status === 'DISABLED') return [];
      return [{ userId: contact.userId, organisationId: context.invitee.organisationId }];
    }
  }
}

/**
 * Who gets the event, on which channels. Applies the rules of the matrix (and their conditions),
 * asks identity for the people (active users with an active role in the right organisation, site-bound
 * for Makers and Checkers), and merges a person who is in several parties: one entry per user,
 * the union of channels, action-required if any of their rules is. Pure data in, no sending.
 */
export async function resolveRecipients(
  tx: Prisma.TransactionClient,
  eventType: string,
  context: NotificationContext,
  data: EventData,
): Promise<Recipient[]> {
  const byUser = new Map<string, Recipient>();
  for (const rule of rulesFor(eventType) ?? []) {
    if (rule.when && !rule.when(data)) continue;
    for (const person of await peopleOf(tx, rule.party, context)) {
      let recipient = byUser.get(person.userId);
      if (!recipient) {
        recipient = { ...person, channels: new Map() };
        byUser.set(person.userId, recipient);
      }
      for (const channel of rule.channels) {
        const known = recipient.channels.get(channel);
        recipient.channels.set(channel, {
          actionRequired: (known?.actionRequired ?? false) || rule.actionRequired,
        });
      }
    }
  }
  return [...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}

// ---------------------------------------------------------------- the consumer

/**
 * One event, once (AUDIT_AND_EVENT_ARCHITECTURE.md section 3, NOTIFICATIONS.md section 1):
 *
 * 1. an event that is not a notification event is ignored;
 * 2. the context port tells who is involved (a missing subject throws, so the queue redelivers
 *    and finally parks the message);
 * 3. in one system transaction, guarded by `processOnce(consumer, event id)`: resolve the
 *    recipients, read the mute settings, and insert one `notification` row per recipient and
 *    channel. An in-app row is `SENT` at once. An email row is `QUEUED` for the delivery step
 *    (`runEmailDeliveries`), which sends outside any database transaction. A muted, optional
 *    notification is stored as `SUPPRESSED` (no payload), an action-required one ignores the mute.
 *
 * A second delivery of the same event inserts nothing: `processed_event` says it was done, and
 * the unique key (event, recipient, channel) of `notification` backs that up.
 */
export async function handleNotificationEvent(
  deps: NotificationDeps,
  envelope: EventEnvelope,
): Promise<HandleNotificationResult> {
  if (!NOTIFICATION_EVENT_TYPES.has(envelope.type)) return { status: 'ignored' };
  const context = await deps.context.resolve(envelope);
  if (!context) throw new NotificationContextMissingError(envelope.type);
  const data = asData(envelope.data);
  const now = deps.clock.now();

  const outcome = await withDbContext(deps.prisma, { kind: 'system' }, (tx) =>
    processOnce(tx, NOTIFICATION_CONSUMER, envelope.id, async (work) => {
      const recipients = await resolveRecipients(work, envelope.type, context, data);
      if (recipients.length === 0) {
        return { recipients: 0, inApp: 0, emailQueued: 0, suppressed: 0 };
      }
      const muted = await work.notificationPreference.findMany({
        where: {
          userId: { in: recipients.map((recipient) => recipient.userId) },
          eventCode: envelope.type,
          muted: true,
        },
        select: { userId: true, channel: true },
      });
      const mutedKeys = new Set(muted.map((row) => `${row.userId}|${row.channel}`));
      const view = buildTemplateData(envelope.type, context, data);
      const payload: Prisma.InputJsonObject = {
        ...view,
        ...(context.bookingId ? { bookingId: context.bookingId } : {}),
      };

      const versions = new Map<DeliveryChannel, number>();
      const versionOf = async (channel: DeliveryChannel): Promise<number> => {
        let version = versions.get(channel);
        if (version === undefined) {
          const stored = await latestStoredTemplate(work, envelope.type, channel);
          version = stored?.version ?? CODE_TEMPLATE_VERSION;
          versions.set(channel, version);
        }
        return version;
      };

      const rows: Prisma.NotificationCreateManyInput[] = [];
      const counts = { recipients: recipients.length, inApp: 0, emailQueued: 0, suppressed: 0 };
      for (const recipient of recipients) {
        for (const [channel, { actionRequired }] of recipient.channels) {
          const decision = deliveryDecision({
            actionRequired,
            muted: mutedKeys.has(`${recipient.userId}|${channel}`),
          });
          const base = {
            id: uuidv7(now.getTime()),
            recipientUserId: recipient.userId,
            organisationId: recipient.organisationId,
            eventCode: envelope.type,
            eventId: envelope.id,
            channel: channel as NotifChannel,
            isActionRequired: actionRequired,
            // Set here, in whole milliseconds, so the inbox cursor (a JS Date) never skips a row.
            createdAt: now,
          };
          if (decision === 'SUPPRESS') {
            rows.push({
              ...base,
              templateVersion: CODE_TEMPLATE_VERSION,
              payload: {},
              status: 'SUPPRESSED',
            });
            counts.suppressed += 1;
          } else if (channel === 'IN_APP') {
            rows.push({
              ...base,
              templateVersion: await versionOf(channel),
              payload,
              status: 'SENT',
              sentAt: now,
            });
            counts.inApp += 1;
          } else {
            rows.push({
              ...base,
              templateVersion: await versionOf(channel),
              payload,
              status: 'QUEUED',
            });
            counts.emailQueued += 1;
          }
        }
      }
      await work.notification.createMany({ data: rows, skipDuplicates: true });
      return counts;
    }),
  );
  if (!outcome.processed) return { status: 'duplicate' };
  return { status: 'processed', ...outcome.result };
}
