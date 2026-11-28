import {
  type BookingLineStatus,
  type BookingStatus,
  type CounterStatus,
  type PartyType,
  Prisma,
  type ScopeSiteType,
} from '@labconnect/database';
import type { CurrentActor } from '../identity/actor.js';
import { accreditationVerificationUrl } from '../labs/accreditation-url.js';
import { BookingError } from './errors.js';
import {
  type BookingSlotView,
  bookingVisibility,
  slotFromColumns,
  visibleBookingsSql,
} from './queries.js';

// `getBooking`, the part the booking module owns (I3-SHR-01): the booking, its lines, the current
// TRF, the latest counter-offer, the status history and the snapshots, plus the customer-only
// facts (requester, customer site, whether it was placed by the platform). The API adds what other
// modules own: the hold case (custody), the ratings (disputes) and the lab contact (labs, read
// under a system scope once the booking has been paid). Attachments come with their upload
// operation (`createBookingAttachmentUploadUrl`), which does not exist yet.
//
// Snapshots (CD-39, VERSIONING_AND_SNAPSHOTS §3): `booking.lab_snapshot` and
// `booking_line.snapshot` are read as written. A field a row does not carry in the contract's
// shape (rows written before T-01 wrote full snapshots: the test-data factory's) is filled from
// what the row points to: the line's scope line and price item, the site, and the accreditation
// of the booked scope. Such a field shows the reference data as it is now, not as it was.

export interface CodeNameView {
  code: string;
  name: string;
}

export interface PostalAddressView {
  line1: string;
  line2: string | null;
  city: string;
  district: string | null;
  stateCode: string;
  pincode: string;
}

export interface AccreditationView {
  certificateNo: string;
  accreditationBody: CodeNameView;
  standard: CodeNameView;
  labCategory: string;
  validFrom: string;
  validTo: string;
  status: string;
  statusAsOf: string;
  verificationUrl: string | null;
}

export interface BookingLineSnapshotView {
  discipline: CodeNameView;
  group: CodeNameView | null;
  product: CodeNameView | null;
  parameter: CodeNameView;
  method: CodeNameView | null;
  methodText: string | null;
  rangeText: string | null;
  siteType: ScopeSiteType;
  sampleQty: number;
  sampleUnit: CodeNameView;
  packagingInstructions: string | null;
  tatDays: number;
}

export interface BookingLineView {
  id: string;
  lineNo: number;
  scopeLineId: string;
  snapshot: BookingLineSnapshotView;
  unitPricePaise: bigint;
  samplePrepPaise: bigint;
  gstRateBp: number;
  gstPaise: bigint;
  lineTotalPaise: bigint;
  requiredSampleQty: number | null;
  status: BookingLineStatus;
  cancelledReason: string | null;
}

export interface BookingCounterLineQuantityView {
  lineId: string;
  sampleQty: number;
  unitCode: string;
}

export interface BookingCounterOfferView {
  id: string;
  status: CounterStatus;
  proposedSlot: BookingSlotView | null;
  perLineQuantity: BookingCounterLineQuantityView[];
  message: string;
  expiresAt: Date;
  createdAt: Date;
  respondedAt: Date | null;
}

export interface BookingStatusChangeView {
  transitionId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  occurredAt: Date;
  actorParty: PartyType;
  reason: string | null;
}

/** What both parties see. */
export interface BookingDetailCommon {
  id: string;
  bookingNo: string;
  status: BookingStatus;
  statusChangedAt: Date;
  customerDisplayName: string;
  labSite: {
    id: string;
    siteCode: string;
    name: string;
    address: PostalAddressView;
    location: { lat: number; lng: number } | null;
  };
  labSnapshot: { siteName: string; address: PostalAddressView; accreditation: AccreditationView };
  itemName: string;
  batchNo: string | null;
  slot: BookingSlotView | null;
  preferredDropDate: Date;
  declaredPackageCount: number;
  lines: BookingLineView[];
  trf: {
    versionNo: number;
    schemaVersion: string;
    form: Record<string, unknown>;
    conformityRequired: boolean;
    decisionRule: string | null;
    submittedAt: Date;
  };
  subtotalPaise: bigint;
  gstPaise: bigint;
  platformFeePaise: bigint;
  totalPaise: bigint;
  labDecisionDueAt: Date | null;
  paymentDueAt: Date | null;
  dropDeadlineAt: Date | null;
  expectedReportDate: Date | null;
  reportReleasedAt: Date | null;
  disputeWindowEndsAt: Date | null;
  retainUntil: Date | null;
  completedAt: Date | null;
  deviationNoted: boolean;
  deviationNotes: string | null;
  counterOffer: BookingCounterOfferView | null;
  cancellation: { reason: CodeNameView; byParty: PartyType; notes: string | null } | null;
  rejection: { reason: CodeNameView; notes: string | null } | null;
  frozen: { frozenAt: Date; reason: string } | null;
  statusHistory: BookingStatusChangeView[];
  createdAt: Date;
  lockVersion: number;
}

/** The booking as its party reads it. `customer` is set for a member of the customer organisation. */
export interface BookingDetail {
  party: 'customer' | 'lab';
  common: BookingDetailCommon;
  /** Ids the API needs to add what other modules own. */
  refs: { labSiteId: string; customerOrgId: string; labOrgId: string };
  /** Whether the booking has been paid (T-09 is in its history): the lab contact shows from then. */
  paid: boolean;
  customer: {
    requester: { userId: string; fullName: string };
    customerSite: { id: string; name: string } | null;
    placedByPlatform: boolean;
  } | null;
}

// ------------------------------------------------------------------------------ value readers

type Json = Prisma.JsonValue;
type JsonObject = Record<string, Json | undefined>;

function objectOf(value: Json | null | undefined): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function textOf(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function codeNameOf(value: Json | undefined): CodeNameView | null {
  const object = objectOf(value);
  const code = textOf(object?.code);
  const name = textOf(object?.name);
  return code === null || name === null ? null : { code, name };
}

/** A stored field when it has the contract's shape, else the fallback. `null` is a valid value. */
function storedOr<T>(
  stored: JsonObject | null,
  key: string,
  read: (value: Json | undefined) => T | undefined,
  fallback: T,
): T {
  if (stored === null || !(key in stored)) return fallback;
  const value = read(stored[key]);
  return value === undefined ? fallback : value;
}

const nullableCodeName = (value: Json | undefined): CodeNameView | null | undefined =>
  value === null ? null : (codeNameOf(value) ?? undefined);
const requiredCodeName = (value: Json | undefined): CodeNameView | undefined =>
  codeNameOf(value) ?? undefined;
const nullableText = (value: Json | undefined): string | null | undefined =>
  value === null ? null : typeof value === 'string' ? value : undefined;
const nonNegativeNumber = (value: Json | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const positiveInteger = (value: Json | undefined): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;

const SITE_TYPES = new Set<string>(['PERMANENT', 'SITE', 'MOBILE']);

/** `lab_site.address` is `{line1, line2, city, district, state_code, pincode}`; the columns win for state and pincode. */
function siteAddress(
  raw: Json,
  columns: { name: string; state_code: string; pincode: string },
): PostalAddressView {
  const stored = objectOf(raw) ?? {};
  return {
    line1: textOf(stored.line1) ?? columns.name,
    line2: textOf(stored.line2),
    city: textOf(stored.city) ?? columns.name,
    district: textOf(stored.district),
    stateCode: columns.state_code,
    pincode: columns.pincode,
  };
}

function storedAddress(value: Json | undefined): PostalAddressView | undefined {
  const object = objectOf(value);
  if (object === null) return undefined;
  const line1 = textOf(object.line1);
  const city = textOf(object.city);
  const stateCode = textOf(object.stateCode);
  const pincode = textOf(object.pincode);
  if (line1 === null || city === null || stateCode === null || pincode === null) return undefined;
  return {
    line1,
    line2: textOf(object.line2),
    city,
    district: textOf(object.district),
    stateCode,
    pincode,
  };
}

function storedAccreditation(value: Json | undefined): AccreditationView | undefined {
  const object = objectOf(value);
  if (object === null) return undefined;
  const certificateNo = textOf(object.certificateNo);
  const accreditationBody = codeNameOf(object.accreditationBody);
  const standard = codeNameOf(object.standard);
  const labCategory = textOf(object.labCategory);
  const validFrom = textOf(object.validFrom);
  const validTo = textOf(object.validTo);
  const status = textOf(object.status);
  const statusAsOf = textOf(object.statusAsOf);
  const verificationUrl = object.verificationUrl;
  if (
    certificateNo === null ||
    accreditationBody === null ||
    standard === null ||
    labCategory === null ||
    validFrom === null ||
    validTo === null ||
    status === null ||
    statusAsOf === null ||
    !(verificationUrl === null || typeof verificationUrl === 'string')
  ) {
    return undefined;
  }
  return {
    certificateNo,
    accreditationBody,
    standard,
    labCategory,
    validFrom,
    validTo,
    status,
    statusAsOf,
    verificationUrl,
  };
}

// ------------------------------------------------------------------------------------- queries

interface BookingRow {
  id: string;
  booking_no: string;
  status: BookingStatus;
  status_changed_at: Date;
  customer_org_id: string;
  lab_org_id: string;
  requester_user_id: string;
  on_behalf_by_user_id: string | null;
  customer_site_id: string | null;
  customer_display_name: string;
  site_id: string;
  site_code: string;
  site_name: string;
  site_address: Json;
  site_state_code: string;
  site_pincode: string;
  site_lat: number | null;
  site_lng: number | null;
  lab_snapshot: Json;
  item_name: string;
  batch_no: string | null;
  slot_id: string | null;
  slot_date: Date | null;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  discipline_code: string | null;
  discipline_name: string | null;
  preferred_drop_date: Date;
  declared_package_count: number;
  current_trf_version: number;
  subtotal_paise: bigint;
  gst_paise: bigint;
  platform_fee_paise: bigint;
  total_paise: bigint;
  lab_decision_due_at: Date | null;
  payment_due_at: Date | null;
  drop_deadline_at: Date | null;
  expected_report_date: Date | null;
  report_released_at: Date | null;
  dispute_window_ends_at: Date | null;
  retain_until: Date | null;
  completed_at: Date | null;
  deviation_noted: boolean;
  deviation_notes: string | null;
  cancellation_code: string | null;
  cancellation_name: string | null;
  cancelled_by_party: PartyType | null;
  cancellation_notes: string | null;
  rejection_code: string | null;
  rejection_name: string | null;
  rejection_notes: string | null;
  frozen_at: Date | null;
  frozen_reason: string | null;
  created_at: Date;
  lock_version: number;
  paid: boolean;
}

interface LineRow {
  id: string;
  line_no: number;
  scope_line_id: string;
  snapshot: Json;
  unit_price_paise: bigint;
  sample_prep_paise: bigint;
  gst_rate_bp: number;
  gst_paise: bigint;
  line_total_paise: bigint;
  required_sample_qty: string | null;
  status: BookingLineStatus;
  cancelled_reason: string | null;
  discipline_code: string;
  discipline_name: string;
  group_code: string | null;
  group_name: string | null;
  product_code: string | null;
  product_name: string | null;
  parameter_code: string;
  parameter_name: string;
  method_code: string | null;
  method_name: string | null;
  method_text: string | null;
  range_text: string | null;
  site_type: ScopeSiteType;
  sample_qty: string;
  unit_code: string;
  unit_name: string;
  packaging_instructions: string | null;
  tat_days: number;
}

interface AccreditationRow {
  certificate_no: string;
  body_code: string;
  body_name: string;
  verification_url_template: string | null;
  standard_code: string;
  standard_name: string;
  lab_category: string;
  valid_from: string;
  valid_to: string;
  status: string;
  status_as_of: string;
}

interface CounterRow {
  id: string;
  status: CounterStatus;
  per_line_quantity: Json;
  message: string;
  expires_at: Date;
  created_at: Date;
  responded_at: Date | null;
  slot_id: string | null;
  slot_date: Date | null;
  slot_starts_at: Date | null;
  slot_ends_at: Date | null;
  discipline_code: string | null;
  discipline_name: string | null;
}

const node = (code: string | null, name: string | null): CodeNameView | null =>
  code === null ? null : { code, name: name ?? code };

function lineView(row: LineRow): BookingLineView {
  const stored = objectOf(row.snapshot);
  const fallback: BookingLineSnapshotView = {
    discipline: { code: row.discipline_code, name: row.discipline_name },
    group: node(row.group_code, row.group_name),
    product: node(row.product_code, row.product_name),
    parameter: { code: row.parameter_code, name: row.parameter_name },
    method: node(row.method_code, row.method_name),
    methodText: row.method_text,
    rangeText: row.range_text,
    siteType: row.site_type,
    sampleQty: Number(row.sample_qty),
    sampleUnit: { code: row.unit_code, name: row.unit_name },
    packagingInstructions: row.packaging_instructions,
    tatDays: row.tat_days,
  };
  const snapshot: BookingLineSnapshotView = {
    discipline: storedOr(stored, 'discipline', requiredCodeName, fallback.discipline),
    group: storedOr(stored, 'group', nullableCodeName, fallback.group),
    product: storedOr(stored, 'product', nullableCodeName, fallback.product),
    parameter: storedOr(stored, 'parameter', requiredCodeName, fallback.parameter),
    method: storedOr(stored, 'method', nullableCodeName, fallback.method),
    methodText: storedOr(stored, 'methodText', nullableText, fallback.methodText),
    rangeText: storedOr(stored, 'rangeText', nullableText, fallback.rangeText),
    siteType: storedOr(
      stored,
      'siteType',
      (value) =>
        typeof value === 'string' && SITE_TYPES.has(value) ? (value as ScopeSiteType) : undefined,
      fallback.siteType,
    ),
    sampleQty: storedOr(stored, 'sampleQty', nonNegativeNumber, fallback.sampleQty),
    sampleUnit: storedOr(stored, 'sampleUnit', requiredCodeName, fallback.sampleUnit),
    packagingInstructions: storedOr(
      stored,
      'packagingInstructions',
      nullableText,
      fallback.packagingInstructions,
    ),
    tatDays: storedOr(stored, 'tatDays', positiveInteger, fallback.tatDays),
  };
  return {
    id: row.id,
    lineNo: row.line_no,
    scopeLineId: row.scope_line_id,
    snapshot,
    unitPricePaise: row.unit_price_paise,
    samplePrepPaise: row.sample_prep_paise,
    gstRateBp: row.gst_rate_bp,
    gstPaise: row.gst_paise,
    lineTotalPaise: row.line_total_paise,
    requiredSampleQty: row.required_sample_qty === null ? null : Number(row.required_sample_qty),
    status: row.status,
    cancelledReason: row.cancelled_reason,
  };
}

function perLineQuantity(value: Json): BookingCounterLineQuantityView[] {
  if (!Array.isArray(value)) return [];
  const out: BookingCounterLineQuantityView[] = [];
  for (const item of value) {
    const object = objectOf(item);
    const lineId = textOf(object?.lineId);
    const unitCode = textOf(object?.unitCode);
    const sampleQty = object?.sampleQty;
    if (lineId !== null && unitCode !== null && typeof sampleQty === 'number' && sampleQty > 0) {
      out.push({ lineId, sampleQty, unitCode });
    }
  }
  return out;
}

/**
 * `getBooking`, the booking module's part. Out of the caller's scope (another organisation, or a
 * site the lab member is not assigned to) is `404 NOT_FOUND`, like an unknown id; a booking of the
 * organisation that a requester-only member did not request is `403 FORBIDDEN` (the contract).
 * A platform membership, or none, is `403`.
 */
export async function getBookingDetail(
  tx: Prisma.TransactionClient,
  actor: CurrentActor,
  bookingId: string,
): Promise<BookingDetail> {
  const visibility = bookingVisibility(actor);
  // Found within the organisation (and the lab member's sites); a requester's own-bookings rule is
  // checked after, because it is 403, not 404.
  const scope =
    visibility.party === 'customer'
      ? visibleBookingsSql({ ...visibility, requesterUserId: null })
      : visibleBookingsSql(visibility);
  const rows = await tx.$queryRaw<BookingRow[]>(Prisma.sql`
    SELECT b.id::text AS id, b.booking_no, b.status, b.status_changed_at,
           b.customer_org_id::text AS customer_org_id, b.lab_org_id::text AS lab_org_id,
           b.requester_user_id::text AS requester_user_id,
           b.on_behalf_by_user_id::text AS on_behalf_by_user_id,
           b.customer_site_id::text AS customer_site_id,
           o.display_name AS customer_display_name,
           s.id::text AS site_id, s.site_code, s.name AS site_name, s.address AS site_address,
           s.state_code AS site_state_code, s.pincode AS site_pincode,
           ST_Y(s.geo_point::geometry) AS site_lat, ST_X(s.geo_point::geometry) AS site_lng,
           b.lab_snapshot, b.item_name, b.batch_no,
           sl.id::text AS slot_id, sl.slot_date, sl.starts_at AS slot_starts_at,
           sl.ends_at AS slot_ends_at, d.code AS discipline_code, d.name AS discipline_name,
           b.preferred_drop_date, b.declared_package_count, b.current_trf_version,
           b.subtotal_paise, b.gst_paise, b.platform_fee_paise, b.total_paise,
           b.lab_decision_due_at, b.payment_due_at, b.drop_deadline_at, b.expected_report_date,
           b.report_released_at, b.dispute_window_ends_at, b.retain_until, b.completed_at,
           b.deviation_noted, b.deviation_notes,
           cn.code AS cancellation_code, cn.name AS cancellation_name, b.cancelled_by_party,
           b.cancellation_notes, rn.code AS rejection_code, rn.name AS rejection_name,
           b.rejection_notes, b.frozen_at, b.frozen_reason, b.created_at, b.lock_version,
           EXISTS (SELECT 1 FROM booking_status_history h
                    WHERE h.booking_id = b.id AND h.transition_id = 'T-09') AS paid
      FROM booking b
      JOIN organisation o ON o.id = b.customer_org_id
      JOIN lab_site s ON s.id = b.lab_site_id
      LEFT JOIN slot sl ON sl.id = b.slot_id
      LEFT JOIN md_node d ON d.id = sl.discipline_node_id
      LEFT JOIN md_node cn ON cn.id = b.cancellation_code_node_id
      LEFT JOIN md_node rn ON rn.id = b.rejection_reason_node_id
     WHERE b.id = ${bookingId}::uuid AND ${scope}`);
  const row = rows[0];
  if (row === undefined) throw new BookingError('NOT_FOUND');
  if (
    visibility.party === 'customer' &&
    visibility.requesterUserId !== null &&
    row.requester_user_id !== visibility.requesterUserId
  ) {
    throw new BookingError('FORBIDDEN', {
      detail: 'A requester reads the bookings they requested.',
    });
  }

  const lines = await tx.$queryRaw<LineRow[]>(Prisma.sql`
    SELECT bl.id::text AS id, bl.line_no, bl.scope_line_id::text AS scope_line_id, bl.snapshot,
           bl.unit_price_paise, bl.sample_prep_paise, bl.gst_rate_bp, bl.gst_paise,
           bl.line_total_paise, bl.required_sample_qty::text AS required_sample_qty, bl.status,
           bl.cancelled_reason,
           dn.code AS discipline_code, dn.name AS discipline_name,
           gn.code AS group_code, gn.name AS group_name,
           pn.code AS product_code, pn.name AS product_name,
           pa.code AS parameter_code, pa.name AS parameter_name,
           mn.code AS method_code, mn.name AS method_name,
           sc.method_text, sc.range_text, sc.site_type,
           pi.sample_qty::text AS sample_qty, un.code AS unit_code, un.name AS unit_name,
           pi.packaging_instructions, pi.tat_days
      FROM booking_line bl
      JOIN scope_line sc ON sc.id = bl.scope_line_id
      JOIN price_item pi ON pi.id = bl.price_item_id
      JOIN md_node dn ON dn.id = sc.discipline_node_id
      LEFT JOIN md_node gn ON gn.id = sc.group_node_id
      LEFT JOIN md_node pn ON pn.id = sc.product_node_id
      JOIN md_node pa ON pa.id = sc.parameter_node_id
      LEFT JOIN md_node mn ON mn.id = sc.method_node_id
      JOIN md_node un ON un.id = pi.sample_unit_node_id
     WHERE bl.booking_id = ${row.id}::uuid
     ORDER BY bl.line_no`);

  const trfs = await tx.trf.findMany({
    where: { bookingId: row.id, versionNo: row.current_trf_version },
    take: 1,
  });
  const trf = trfs[0];
  if (trf === undefined) throw new Error(`booking ${row.id} has no current TRF`);

  const history = await tx.bookingStatusHistory.findMany({
    where: { bookingId: row.id },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  });

  const counters = await tx.$queryRaw<CounterRow[]>(Prisma.sql`
    SELECT c.id::text AS id, c.status, c.per_line_quantity, c.message, c.expires_at, c.created_at,
           c.responded_at, sl.id::text AS slot_id, sl.slot_date, sl.starts_at AS slot_starts_at,
           sl.ends_at AS slot_ends_at, d.code AS discipline_code, d.name AS discipline_name
      FROM counter_offer c
      LEFT JOIN slot sl ON sl.id = c.proposed_slot_id
      LEFT JOIN md_node d ON d.id = sl.discipline_node_id
     WHERE c.booking_id = ${row.id}::uuid
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1`);
  const counter = counters[0];

  // The accreditation the booked scope is under: the lab snapshot's fallback.
  const accreditations = await tx.$queryRaw<AccreditationRow[]>(Prisma.sql`
    SELECT a.certificate_no, ab.code AS body_code, ab.name AS body_name,
           ab.verification_url_template, st.code AS standard_code, st.name AS standard_name,
           a.lab_category::text AS lab_category, a.valid_from::text AS valid_from,
           a.valid_to::text AS valid_to, a.status::text AS status,
           a.status_as_of::text AS status_as_of
      FROM booking_line bl
      JOIN scope_line sc ON sc.id = bl.scope_line_id
      JOIN accreditation a ON a.id = sc.accreditation_id
      JOIN accreditation_body ab ON ab.id = a.accreditation_body_id
      JOIN accreditation_standard st ON st.id = a.standard_id
     WHERE bl.booking_id = ${row.id}::uuid
     ORDER BY bl.line_no
     LIMIT 1`);
  const accreditationRow = accreditations[0];
  if (accreditationRow === undefined) throw new Error(`booking ${row.id} has no booked scope`);
  const currentAccreditation: AccreditationView = {
    certificateNo: accreditationRow.certificate_no,
    accreditationBody: { code: accreditationRow.body_code, name: accreditationRow.body_name },
    standard: { code: accreditationRow.standard_code, name: accreditationRow.standard_name },
    labCategory: accreditationRow.lab_category,
    validFrom: accreditationRow.valid_from,
    validTo: accreditationRow.valid_to,
    status: accreditationRow.status,
    statusAsOf: accreditationRow.status_as_of,
    verificationUrl: accreditationVerificationUrl(
      accreditationRow.verification_url_template,
      accreditationRow.certificate_no,
    ),
  };
  const currentAddress = siteAddress(row.site_address, {
    name: row.site_name,
    state_code: row.site_state_code,
    pincode: row.site_pincode,
  });
  const labSnapshot = objectOf(row.lab_snapshot);

  const common: BookingDetailCommon = {
    id: row.id,
    bookingNo: row.booking_no,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    customerDisplayName: row.customer_display_name,
    labSite: {
      id: row.site_id,
      siteCode: row.site_code,
      name: row.site_name,
      address: currentAddress,
      location:
        row.site_lat === null || row.site_lng === null
          ? null
          : { lat: row.site_lat, lng: row.site_lng },
    },
    labSnapshot: {
      siteName: storedOr(labSnapshot, 'siteName', (v) => textOf(v) ?? undefined, row.site_name),
      address: storedOr(labSnapshot, 'address', storedAddress, currentAddress),
      accreditation: storedOr(
        labSnapshot,
        'accreditation',
        storedAccreditation,
        currentAccreditation,
      ),
    },
    itemName: row.item_name,
    batchNo: row.batch_no,
    slot: slotFromColumns(row),
    preferredDropDate: row.preferred_drop_date,
    declaredPackageCount: row.declared_package_count,
    lines: lines.map(lineView),
    trf: {
      versionNo: trf.versionNo,
      schemaVersion: trf.schemaVersion,
      form: objectOf(trf.form) ?? {},
      conformityRequired: trf.conformityRequired,
      decisionRule: trf.decisionRule,
      submittedAt: trf.createdAt,
    },
    subtotalPaise: row.subtotal_paise,
    gstPaise: row.gst_paise,
    platformFeePaise: row.platform_fee_paise,
    totalPaise: row.total_paise,
    labDecisionDueAt: row.lab_decision_due_at,
    paymentDueAt: row.payment_due_at,
    dropDeadlineAt: row.drop_deadline_at,
    expectedReportDate: row.expected_report_date,
    reportReleasedAt: row.report_released_at,
    disputeWindowEndsAt: row.dispute_window_ends_at,
    retainUntil: row.retain_until,
    completedAt: row.completed_at,
    deviationNoted: row.deviation_noted,
    deviationNotes: row.deviation_notes,
    counterOffer:
      counter === undefined
        ? null
        : {
            id: counter.id,
            status: counter.status,
            proposedSlot: slotFromColumns(counter),
            perLineQuantity: perLineQuantity(counter.per_line_quantity),
            message: counter.message,
            expiresAt: counter.expires_at,
            createdAt: counter.created_at,
            respondedAt: counter.responded_at,
          },
    cancellation:
      row.cancelled_by_party === null
        ? null
        : {
            reason: node(row.cancellation_code, row.cancellation_name) ?? {
              code: 'UNSPECIFIED',
              name: 'Not given',
            },
            byParty: row.cancelled_by_party,
            notes: row.cancellation_notes,
          },
    rejection:
      row.rejection_code === null
        ? null
        : {
            reason: { code: row.rejection_code, name: row.rejection_name ?? row.rejection_code },
            notes: row.rejection_notes,
          },
    frozen:
      row.frozen_at === null ? null : { frozenAt: row.frozen_at, reason: row.frozen_reason ?? '' },
    statusHistory: history.map((change) => ({
      transitionId: change.transitionId,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      occurredAt: change.occurredAt,
      actorParty: change.actorParty,
      reason: change.reason,
    })),
    createdAt: row.created_at,
    lockVersion: row.lock_version,
  };

  let customer: BookingDetail['customer'] = null;
  if (visibility.party === 'customer') {
    // The requester and the customer site belong to the caller's own organisation (RLS shows them).
    const requester = await tx.appUser.findUnique({
      where: { id: row.requester_user_id },
      select: { fullName: true },
    });
    const site =
      row.customer_site_id === null
        ? null
        : await tx.customerSite.findUnique({
            where: { id: row.customer_site_id },
            select: { id: true, name: true },
          });
    customer = {
      requester: { userId: row.requester_user_id, fullName: requester?.fullName ?? '' },
      customerSite: site,
      placedByPlatform: row.on_behalf_by_user_id !== null,
    };
  }

  return {
    party: visibility.party,
    common,
    refs: { labSiteId: row.site_id, customerOrgId: row.customer_org_id, labOrgId: row.lab_org_id },
    paid: row.paid,
    customer,
  };
}
