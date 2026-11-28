import { type BookingStatus, Prisma } from '@labconnect/database';
import { TERMINAL_BOOKING_STATUSES } from '@labconnect/shared';
import type { CurrentActor } from '../identity/actor.js';
import { BookingError } from './errors.js';
import { BOOKING_LIST_LIMITS, bookingVisibility, visibleBookingsSql } from './queries.js';

// `getLabInbox` (API_CONTRACTS §6, FR-LAB-01, `paths/lab-inbox.yaml`): the bookings of the
// caller's assigned sites that need the lab, read side only. The decisions, receipts and reports
// themselves have their own operations.
//
// Which bookings: without `status`, every booking that is not terminal, and a terminal one that
// still has an approval waiting (an amendment of a released report on a COMPLETED booking).
// With `status`, the bookings in those states.
//
// Order, most urgent first: the deadline that belongs to the state (the lab's decision for
// REQUESTED, the counter-offer's expiry for COUNTERED, payment for ACCEPTED, the drop for PAID
// and HANDOVER_SET), earliest first; bookings with no such deadline after them, the oldest status
// change first; then the id. The cursor holds the last row's sort position (see `encodeCursor`).
//
// About the customer only the organisation's display name leaves this query.

export interface LabInboxInput {
  statuses?: readonly BookingStatus[] | undefined;
  siteId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export type LabInboxPendingApproval = 'RECEIPT' | 'REPORT';

export interface LabInboxItemView {
  booking: {
    id: string;
    bookingNo: string;
    status: BookingStatus;
    statusChangedAt: Date;
    labSite: { id: string; siteCode: string; name: string };
    customerDisplayName: string;
    itemName: string;
    batchNo: string | null;
    lineCount: number;
    declaredPackageCount: number;
    totalPaise: bigint;
    slot: { startsAt: Date; endsAt: Date } | null;
    preferredDropDate: Date;
    labDecisionDueAt: Date | null;
    paymentDueAt: Date | null;
    dropDeadlineAt: Date | null;
    expectedReportDate: Date | null;
  };
  pendingApproval: LabInboxPendingApproval | null;
  /** The caller made the pending receipt or report version, so another Checker approves it. */
  viewerWasMaker: boolean;
}

export interface LabInboxPage {
  data: LabInboxItemView[];
  page: { nextCursor: string | null; limit: number };
}

/** Roles that see the inbox (FR-LAB-01). */
const INBOX_ROLES = new Set(['LAB_MAKER', 'LAB_CHECKER']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sort position of an inbox row: microseconds since the epoch, and the booking id. */
interface InboxPosition {
  dueUs: string;
  changedUs: string;
  id: string;
}

const MICROS = /^-?\d{1,19}$/;

/**
 * The cursor holds the last row's sort position itself, not only its id: the position of a
 * booking moves when it changes state (a Checker acting on the last row of a page), and a cursor
 * that looked it up again would skip or repeat rows. It names no customer and no personal data;
 * a forged position only moves the start of a page among the caller's own rows.
 */
function encodeCursor(row: InboxPosition): string {
  return Buffer.from(
    JSON.stringify({ d: row.dueUs, s: row.changedUs, i: row.id }),
    'utf8',
  ).toString('base64url');
}

function decodeCursor(raw: string): InboxPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const { d, s, i } =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { d?: unknown; s?: unknown; i?: unknown })
      : {};
  if (
    typeof d === 'string' &&
    MICROS.test(d) &&
    typeof s === 'string' &&
    MICROS.test(s) &&
    typeof i === 'string' &&
    UUID.test(i)
  ) {
    return { dueUs: d, changedUs: s, id: i.toLowerCase() };
  }
  throw new BookingError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

interface InboxRow {
  id: string;
  booking_no: string;
  status: BookingStatus;
  status_changed_at: Date;
  site_id: string;
  site_code: string;
  site_name: string;
  customer_display_name: string;
  item_name: string;
  batch_no: string | null;
  line_count: number;
  declared_package_count: number;
  total_paise: bigint;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  preferred_drop_date: Date;
  lab_decision_due_at: Date | null;
  payment_due_at: Date | null;
  drop_deadline_at: Date | null;
  expected_report_date: Date | null;
  pending_approval: LabInboxPendingApproval | null;
  pending_maker_user_id: string | null;
  due_us: string;
  changed_us: string;
}

/** No deadline sorts after every deadline. */
const NO_DEADLINE_US = '9223372036854775807';

/**
 * The inbox rows of the visible bookings that `filter` keeps, with the sort position (`due_us`,
 * `changed_us`, `id`) and the approval waiting for a Checker. The newest undecided receipt record
 * and the open report version (`uq_report_version_open`: at most one) are read; a receipt is
 * listed before a report. A COUNTERED booking sorts by its latest counter-offer's expiry, also
 * once that offer has lapsed and the timer has not yet moved the booking on.
 */
function inboxSql(visibility: Prisma.Sql, filter: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT b.id::text AS id, b.booking_no, b.status, b.status_changed_at,
           s.id::text AS site_id, s.site_code, s.name AS site_name,
           o.display_name AS customer_display_name, b.item_name, b.batch_no,
           (SELECT count(*)::int FROM booking_line l WHERE l.booking_id = b.id) AS line_count,
           b.declared_package_count, b.total_paise,
           sl.starts_at AS slot_starts_at, sl.ends_at AS slot_ends_at, b.preferred_drop_date,
           b.lab_decision_due_at, b.payment_due_at, b.drop_deadline_at, b.expected_report_date,
           COALESCE((extract(epoch FROM CASE b.status
                      WHEN 'REQUESTED' THEN b.lab_decision_due_at
                      WHEN 'COUNTERED' THEN (SELECT co.expires_at FROM counter_offer co
                                              WHERE co.booking_id = b.id
                                              ORDER BY co.created_at DESC, co.id DESC LIMIT 1)
                      WHEN 'ACCEPTED' THEN b.payment_due_at
                      WHEN 'PAID' THEN b.drop_deadline_at
                      WHEN 'HANDOVER_SET' THEN b.drop_deadline_at
                    END) * 1000000)::bigint, ${NO_DEADLINE_US}::bigint) AS due_us,
           (extract(epoch FROM b.status_changed_at) * 1000000)::bigint AS changed_us,
           CASE WHEN rr.id IS NOT NULL THEN 'RECEIPT'
                WHEN rv.id IS NOT NULL THEN 'REPORT' END AS pending_approval,
           COALESCE(rr.maker_user_id, rv.maker_user_id)::text AS pending_maker_user_id
      FROM booking b
      JOIN organisation o ON o.id = b.customer_org_id
      JOIN lab_site s ON s.id = b.lab_site_id
      LEFT JOIN slot sl ON sl.id = b.slot_id
      LEFT JOIN LATERAL (SELECT r.id, r.maker_user_id FROM receipt_record r
                          WHERE r.booking_id = b.id AND r.decision IS NULL
                          ORDER BY r.version_no DESC LIMIT 1) rr ON true
      LEFT JOIN LATERAL (SELECT v.id, v.maker_user_id FROM report_version v
                          WHERE v.booking_id = b.id AND v.status = 'IN_REVIEW'
                          ORDER BY v.version_no DESC LIMIT 1) rv ON true
     WHERE ${visibility} AND ${filter}`;
}

/**
 * `getLabInbox`: a `LAB_MAKER` or `LAB_CHECKER` reads the bookings of their assigned sites. A
 * customer or platform membership, or another lab role, is 403; a `siteId` that is not one of the
 * caller's sites is 404 (like an unknown one).
 */
export async function getLabInbox(
  tx: Prisma.TransactionClient,
  actor: CurrentActor,
  input: LabInboxInput,
): Promise<LabInboxPage> {
  const visibility = bookingVisibility(actor);
  if (visibility.party !== 'lab' || !actor.roles.some((role) => INBOX_ROLES.has(role))) {
    throw new BookingError('FORBIDDEN', {
      detail: 'The lab inbox is read by a Maker or a Checker of the lab.',
    });
  }
  if (input.siteId !== undefined && !visibility.siteIds.includes(input.siteId)) {
    throw new BookingError('NOT_FOUND', { detail: 'No such site among yours.' });
  }
  const limit = input.limit ?? BOOKING_LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > BOOKING_LIST_LIMITS.max) {
    throw new BookingError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(BOOKING_LIST_LIMITS.max)}.`,
    });
  }
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);

  const siteFilter =
    input.siteId === undefined
      ? Prisma.empty
      : Prisma.sql`AND b.lab_site_id = ${input.siteId}::uuid`;
  const visible = Prisma.sql`${visibleBookingsSql(visibility)} ${siteFilter}`;
  // Filtered on the booking table itself, before the per-row reads, so the closed history of a
  // site is not read on every request.
  const statusFilter =
    input.statuses === undefined || input.statuses.length === 0
      ? Prisma.sql`(b.status <> ALL(${[...TERMINAL_BOOKING_STATUSES]}::booking_status[])
                    OR EXISTS (SELECT 1 FROM receipt_record r
                                WHERE r.booking_id = b.id AND r.decision IS NULL)
                    OR EXISTS (SELECT 1 FROM report_version v
                                WHERE v.booking_id = b.id AND v.status = 'IN_REVIEW'))`
      : Prisma.sql`b.status = ANY(${[...input.statuses]}::booking_status[])`;
  const cursorFilter =
    after === undefined
      ? Prisma.empty
      : Prisma.sql`WHERE (i.due_us, i.changed_us, i.id::uuid) >
                         (${after.dueUs}::bigint, ${after.changedUs}::bigint, ${after.id}::uuid)`;
  const rows = await tx.$queryRaw<InboxRow[]>(Prisma.sql`
    SELECT i.id, i.booking_no, i.status, i.status_changed_at, i.site_id, i.site_code,
           i.site_name, i.customer_display_name, i.item_name, i.batch_no, i.line_count,
           i.declared_package_count, i.total_paise, i.slot_starts_at, i.slot_ends_at,
           i.preferred_drop_date, i.lab_decision_due_at, i.payment_due_at, i.drop_deadline_at,
           i.expected_report_date, i.pending_approval, i.pending_maker_user_id,
           i.due_us::text AS due_us, i.changed_us::text AS changed_us
      FROM (${inboxSql(visible, statusFilter)}) i
     ${cursorFilter}
     ORDER BY i.due_us, i.changed_us, i.id::uuid
     LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map((row) => toItem(row, actor.userId)),
    page: {
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ dueUs: last.due_us, changedUs: last.changed_us, id: last.id })
          : null,
      limit,
    },
  };
}

function toItem(row: InboxRow, viewerUserId: string): LabInboxItemView {
  return {
    booking: {
      id: row.id,
      bookingNo: row.booking_no,
      status: row.status,
      statusChangedAt: row.status_changed_at,
      labSite: { id: row.site_id, siteCode: row.site_code, name: row.site_name },
      customerDisplayName: row.customer_display_name,
      itemName: row.item_name,
      batchNo: row.batch_no,
      lineCount: row.line_count,
      declaredPackageCount: row.declared_package_count,
      totalPaise: row.total_paise,
      slot:
        row.slot_starts_at === null || row.slot_ends_at === null
          ? null
          : { startsAt: row.slot_starts_at, endsAt: row.slot_ends_at },
      preferredDropDate: row.preferred_drop_date,
      labDecisionDueAt: row.lab_decision_due_at,
      paymentDueAt: row.payment_due_at,
      dropDeadlineAt: row.drop_deadline_at,
      expectedReportDate: row.expected_report_date,
    },
    pendingApproval: row.pending_approval,
    viewerWasMaker:
      row.pending_maker_user_id !== null && row.pending_maker_user_id === viewerUserId,
  };
}
