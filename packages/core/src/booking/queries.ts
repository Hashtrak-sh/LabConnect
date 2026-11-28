import { type BookingStatus, Prisma } from '@labconnect/database';
import type { CurrentActor } from '../identity/actor.js';
import { BookingError } from './errors.js';

// The read side of the booking module (`BookingQueryService` in MODULE_BOUNDARIES): what a party
// of a booking may list and read. Writes go through `BookingEngine` only.
//
// Who sees what (API_CONTRACTS §4, RR-3, TENANT_ISOLATION §2):
// - a customer member sees the organisation's bookings; a member whose only booking role is
//   `CUSTOMER_REQUESTER` sees the bookings they requested;
// - a lab member sees the bookings of the lab sites they are assigned to (`membership_site`),
//   none when no site is assigned;
// - platform staff use `/admin/bookings` (403 here), and so does a user with no membership.
// The organisation is always the active membership's; RLS (`tenant_parties`) backs it.
//
// The lists read reference data of other modules (lab site name and city, slot, discipline,
// organisation display name) in the same query: these tables carry no tenant data and no RLS.

/** The side the caller acts as (`scope` of `listBookings`). */
export type BookingParty = 'customer' | 'lab';

export const BOOKING_LIST_LIMITS = { default: 25, max: 100 } as const;

export interface BookingListInput {
  scope?: BookingParty | undefined;
  statuses?: readonly BookingStatus[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** A drop-off slot (`PublicSlot`). */
export interface BookingSlotView {
  id: string;
  date: Date;
  startsAt: Date;
  endsAt: Date;
  discipline: { code: string; name: string } | null;
}

/** A booking in a list (`BookingSummary`): both parties see the same fields. */
export interface BookingSummaryView {
  id: string;
  bookingNo: string;
  status: BookingStatus;
  statusChangedAt: Date;
  itemName: string;
  batchNo: string | null;
  customerDisplayName: string;
  labSite: { id: string; siteCode: string; name: string; city: string };
  slot: BookingSlotView | null;
  preferredDropDate: Date;
  totalPaise: bigint;
  labDecisionDueAt: Date | null;
  paymentDueAt: Date | null;
  dropDeadlineAt: Date | null;
  expectedReportDate: Date | null;
  createdAt: Date;
}

/** Which bookings an actor may see: one organisation, and narrower within it. */
export type BookingVisibility =
  | { party: 'customer'; organisationId: string; requesterUserId: string | null }
  | { party: 'lab'; organisationId: string; siteIds: readonly string[] };

/** Roles that see every booking of the customer organisation, not only their own. */
const CUSTOMER_WIDE_ROLES = new Set(['CUSTOMER_ADMIN', 'CUSTOMER_FINANCE']);

/**
 * What the actor may see, from the active membership only. A platform membership, or none, is
 * `403 FORBIDDEN` (platform staff use the admin routes).
 */
export function bookingVisibility(actor: CurrentActor): BookingVisibility {
  if (actor.orgId === null || actor.orgType === null || actor.orgType === 'PLATFORM') {
    throw new BookingError('FORBIDDEN', {
      detail: 'Bookings are read by a member of the customer or the lab organisation.',
    });
  }
  if (actor.orgType === 'CUSTOMER') {
    const wide = actor.roles.some((role) => CUSTOMER_WIDE_ROLES.has(role));
    return {
      party: 'customer',
      organisationId: actor.orgId,
      requesterUserId: wide ? null : actor.userId,
    };
  }
  return { party: 'lab', organisationId: actor.orgId, siteIds: actor.siteIds };
}

/** The SQL condition for what the actor may see, on the `booking` table under `alias`. */
export function visibleBookingsSql(
  visibility: BookingVisibility,
  alias: 'b' | 'c' = 'b',
): Prisma.Sql {
  const column = (name: string): Prisma.Sql => Prisma.raw(`${alias}.${name}`);
  if (visibility.party === 'customer') {
    const own =
      visibility.requesterUserId === null
        ? Prisma.empty
        : Prisma.sql`AND ${column('requester_user_id')} = ${visibility.requesterUserId}::uuid`;
    return Prisma.sql`${column('customer_org_id')} = ${visibility.organisationId}::uuid ${own}`;
  }
  // No assigned site: an empty array matches nothing.
  return Prisma.sql`${column('lab_org_id')} = ${visibility.organisationId}::uuid
                    AND ${column('lab_site_id')} = ANY(${[...visibility.siteIds]}::uuid[])`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The cursor holds only the id of the last booking of the page; its position (created_at, id) is
 * looked up again among the bookings the caller may see, so nothing else travels in a URL.
 */
function encodeCursor(bookingId: string): string {
  return Buffer.from(JSON.stringify({ i: bookingId }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const id =
    typeof parsed === 'object' && parsed !== null ? (parsed as { i?: unknown }).i : undefined;
  if (typeof id === 'string' && UUID.test(id)) return id.toLowerCase();
  throw new BookingError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

interface SummaryRow {
  id: string;
  booking_no: string;
  status: BookingStatus;
  status_changed_at: Date;
  item_name: string;
  batch_no: string | null;
  customer_display_name: string;
  site_id: string;
  site_code: string;
  site_name: string;
  site_city: string | null;
  slot_id: string | null;
  slot_date: Date | null;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  discipline_code: string | null;
  discipline_name: string | null;
  preferred_drop_date: Date;
  total_paise: bigint;
  lab_decision_due_at: Date | null;
  payment_due_at: Date | null;
  drop_deadline_at: Date | null;
  expected_report_date: Date | null;
  created_at: Date;
}

const SUMMARY_SELECT = Prisma.sql`
  SELECT b.id::text AS id, b.booking_no, b.status, b.status_changed_at, b.item_name, b.batch_no,
         o.display_name AS customer_display_name,
         s.id::text AS site_id, s.site_code, s.name AS site_name, s.address->>'city' AS site_city,
         sl.id::text AS slot_id, sl.slot_date, sl.starts_at AS slot_starts_at,
         sl.ends_at AS slot_ends_at, d.code AS discipline_code, d.name AS discipline_name,
         b.preferred_drop_date, b.total_paise, b.lab_decision_due_at, b.payment_due_at,
         b.drop_deadline_at, b.expected_report_date, b.created_at
    FROM booking b
    JOIN organisation o ON o.id = b.customer_org_id
    JOIN lab_site s ON s.id = b.lab_site_id
    LEFT JOIN slot sl ON sl.id = b.slot_id
    LEFT JOIN md_node d ON d.id = sl.discipline_node_id`;

/** A slot of a booking or a counter-offer, from the columns `SUMMARY_SELECT` names. */
export function slotFromColumns(row: {
  slot_id: string | null;
  slot_date: Date | null;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  discipline_code: string | null;
  discipline_name: string | null;
}): BookingSlotView | null {
  if (
    row.slot_id === null ||
    row.slot_date === null ||
    row.slot_starts_at === null ||
    row.slot_ends_at === null
  ) {
    return null;
  }
  return {
    id: row.slot_id,
    date: row.slot_date,
    startsAt: row.slot_starts_at,
    endsAt: row.slot_ends_at,
    discipline:
      row.discipline_code === null
        ? null
        : { code: row.discipline_code, name: row.discipline_name ?? row.discipline_code },
  };
}

function toSummary(row: SummaryRow): BookingSummaryView {
  return {
    id: row.id,
    bookingNo: row.booking_no,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    itemName: row.item_name,
    batchNo: row.batch_no,
    customerDisplayName: row.customer_display_name,
    labSite: {
      id: row.site_id,
      siteCode: row.site_code,
      name: row.site_name,
      city: row.site_city ?? '',
    },
    slot: slotFromColumns(row),
    preferredDropDate: row.preferred_drop_date,
    totalPaise: row.total_paise,
    labDecisionDueAt: row.lab_decision_due_at,
    paymentDueAt: row.payment_due_at,
    dropDeadlineAt: row.drop_deadline_at,
    expectedReportDate: row.expected_report_date,
    createdAt: row.created_at,
  };
}

/**
 * `listBookings`: the bookings the actor may see, newest first (created_at, then id), a page at a
 * time. `scope`, when given, must be the active membership's side (422 otherwise): it never
 * widens what the caller sees.
 */
export async function listBookings(
  tx: Prisma.TransactionClient,
  actor: CurrentActor,
  input: BookingListInput,
): Promise<{ data: BookingSummaryView[]; page: { nextCursor: string | null; limit: number } }> {
  const visibility = bookingVisibility(actor);
  if (input.scope !== undefined && input.scope !== visibility.party) {
    throw new BookingError('VALIDATION_FAILED', {
      detail: `scope must be ${visibility.party} for the active membership.`,
    });
  }
  const limit = input.limit ?? BOOKING_LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > BOOKING_LIST_LIMITS.max) {
    throw new BookingError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(BOOKING_LIST_LIMITS.max)}.`,
    });
  }
  const visible = visibleBookingsSql(visibility);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const statusFilter =
    input.statuses === undefined || input.statuses.length === 0
      ? Prisma.empty
      : Prisma.sql`AND b.status = ANY(${[...input.statuses]}::booking_status[])`;
  const cursorFilter =
    after === undefined
      ? Prisma.empty
      : // The cursor's booking, looked up among the bookings the caller may see: any other id
        // matches no row, the comparison is NULL and the page is empty.
        Prisma.sql`AND (b.created_at, b.id) < (SELECT c.created_at, c.id FROM booking c
                                                WHERE c.id = ${after}::uuid
                                                  AND ${visibleBookingsSql(visibility, 'c')})`;
  const rows = await tx.$queryRaw<SummaryRow[]>(Prisma.sql`
    ${SUMMARY_SELECT}
     WHERE ${visible} ${statusFilter} ${cursorFilter}
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(toSummary),
    page: {
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.id) : null,
      limit,
    },
  };
}
