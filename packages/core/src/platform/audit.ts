import { isIP } from 'node:net';
import { type Prisma, type RoleCode, uuidv7 } from '@labconnect/database';
import type { Clock } from './clock.js';
import { redact } from './redact.js';

/**
 * Codes for the actions AUDIT_AND_EVENT_ARCHITECTURE.md section 2 says must always be
 * audited. The documents give only some of the codes (`booking.transition`,
 * `report.publish`); the rest follow the same `<area>.<verb>` shape. `action` stays a
 * string so a module can add its own code; add it here when it becomes mandatory.
 */
export const AUDIT_ACTIONS = {
  BOOKING_TRANSITION: 'booking.transition',
  MAKER_SUBMIT: 'maker.submit',
  CHECKER_APPROVE: 'checker.approve',
  ROLE_CHANGE: 'role.change',
  USER_ACTIVATE: 'user.activate',
  USER_DEACTIVATE: 'user.deactivate',
  PRICE_LIST_PUBLISH: 'price_list.publish',
  CHANGE_SET_APPROVE: 'change_set.approve',
  CHANGE_SET_PUBLISH: 'change_set.publish',
  KYC_VERIFY: 'kyc.verify',
  BANK_ACCOUNT_VERIFY: 'bank_account.verify',
  REFUND_ISSUE: 'refund.issue',
  PAYOUT_HOLD_PLACE: 'payout_hold.place',
  PAYOUT_HOLD_RELEASE: 'payout_hold.release',
  DISPUTE_DECIDE: 'dispute.decide',
  BREAK_GLASS_ACCESS: 'break_glass.access',
  CONFIG_CHANGE: 'config.change',
  SHARE_LINK_CREATE: 'share_link.create',
  SHARE_LINK_REVOKE: 'share_link.revoke',
  LABEL_REPRINT: 'label.reprint',
  REPORT_PUBLISH: 'report.publish',
} as const;

export interface AuditActor {
  userId: string;
  membershipId?: string;
  role?: RoleCode;
  orgId?: string;
}

export interface AuditEntry {
  /** The signed-in user, or `'SYSTEM'` for a timer, a job or a webhook. */
  actor: AuditActor | 'SYSTEM';
  /** Action code, at most 100 characters (see `AUDIT_ACTIONS`). */
  action: string;
  /** Table or aggregate name, at most 60 characters. */
  entityType: string;
  entityId: string;
  /** Redacted before it is stored. */
  before?: unknown;
  /** Redacted before it is stored. */
  after?: unknown;
  reason?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const MAX_ACTION = 100;
const MAX_ENTITY_TYPE = 60;
const MAX_REQUEST_ID = 64;
const MAX_USER_AGENT = 1000;

/**
 * Writes `audit_log` rows (AUDIT_AND_EVENT_ARCHITECTURE.md section 2). Call it inside the
 * transaction of the change it describes, so the two commit or roll back together.
 */
export class AuditService {
  constructor(private readonly clock: Clock) {}

  /**
   * Inserts one audit row and returns its id. Uses `createMany` because the API role may
   * insert but cannot read the row back as a tenant (INSERT ... RETURNING needs SELECT).
   */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<{ id: string }> {
    if (entry.action.length === 0 || entry.action.length > MAX_ACTION) {
      throw new RangeError(`The audit action must be 1 to ${String(MAX_ACTION)} characters.`);
    }
    if (entry.entityType.length === 0 || entry.entityType.length > MAX_ENTITY_TYPE) {
      throw new RangeError(
        `The audit entity type must be 1 to ${String(MAX_ENTITY_TYPE)} characters.`,
      );
    }
    const occurredAt = this.clock.now();
    const id = uuidv7(occurredAt.getTime());
    const actor = entry.actor === 'SYSTEM' ? undefined : entry.actor;

    await tx.auditLog.createMany({
      data: [
        {
          id,
          occurredAt,
          actorUserId: actor?.userId ?? null,
          actorMembershipId: actor?.membershipId ?? null,
          actorRole: actor?.role ?? null,
          actorOrgId: actor?.orgId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: toJson(entry.before),
          after: toJson(entry.after),
          reason: entry.reason ?? null,
          requestId: entry.requestId?.slice(0, MAX_REQUEST_ID) ?? null,
          // A malformed address would abort the whole transaction, so it is dropped here.
          ipAddress:
            entry.ipAddress !== undefined && isIP(entry.ipAddress) !== 0 ? entry.ipAddress : null,
          userAgent: entry.userAgent?.slice(0, MAX_USER_AGENT) ?? null,
        },
      ],
    });
    return { id };
  }
}

/** A SQL NULL is stored by leaving the member out; `redact` returns null only for an absent value. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return redact(value) ?? undefined;
}
