import { Prisma, uuidv7 } from '@labconnect/database';
import { lockSlot, moveSlotPlace, readSlot, slotHasRoom } from '../labs/capacity.js';
import {
  type BusinessCalendar,
  istDateKey,
  NoWorkingTimeError,
} from '../platform/business-calendar.js';
import type { ConfigParameters } from '../platform/config-parameters.js';
import { configParsers } from '../platform/config-parameters.js';
import type { TimerService } from '../platform/timers.js';
import { bookingAggregate } from './default-effects.js';
import type { BookingEngine } from './engine.js';
import { BookingError } from './errors.js';
import { labSnapshotOf, type PricedBooking, priceBooking } from './pricing.js';
import { addMinutes } from './status-columns.js';
import type { BookingActor, WorkingHoursProvider } from './types.js';

// Submitting and editing a booking (I3-CUS-01): T-01 `SubmitBooking` and T-02 `EditBooking`,
// both through the booking engine, plus the two reads the booking steps make before submitting
// (the estimate and the duplicate warning). What the engine does not own is written here, in the
// same transaction: the priced lines and their snapshots (BR-020), the TRF version, the lab
// snapshot, the slot's soft hold (BR-010, BR-011) and the lab decision timers (BR-012 to BR-014,
// counted in the site's business hours: OQ-96, decided 2026-11-29).

export const SUBMISSION_CONFIG_KEYS = {
  slaBusinessMinutes: 'booking.lab_decision_sla_business_minutes', // BR-012
  graceMinutes: 'booking.lab_decision_grace_minutes', // BR-014
  holdExtraMinutes: 'booking.slot_hold_extra_minutes', // BR-010
  maxOpenRequests: 'booking.max_open_requests_per_customer', // BR-015
  duplicateWindowDays: 'booking.duplicate_warning_days', // BR-016
} as const;

export interface SubmissionDeps {
  engine: BookingEngine;
  config: ConfigParameters;
  timers: TimerService;
  workingHours: WorkingHoursProvider | undefined;
  now: Date;
}

/** The TRF as the API has validated it (`packages/validation`). */
export interface TrfInput {
  schemaVersion: string;
  form: Prisma.InputJsonObject & { itemName: string; batchNo?: string };
  conformityRequired: boolean;
  decisionRule: string | null;
}

export interface SubmitBookingInput {
  labSiteId: string;
  customerSiteId?: string;
  slotId: string;
  preferredDropDate: string;
  declaredPackageCount: number;
  scopeLineIds: string[];
  trf: TrfInput;
}

export type CustomerActor = Extract<BookingActor, { kind: 'USER' }> & { orgId: string };

function invalid(path: string, message: string): BookingError {
  return new BookingError('VALIDATION_FAILED', {
    detail: 'Some fields are missing or not valid.',
    errors: [{ path, code: 'INVALID_VALUE', message }],
  });
}

async function minutes(deps: SubmissionDeps, tx: Prisma.TransactionClient, key: string) {
  return deps.config.get(tx, key, configParsers.nonNegativeInteger);
}

/** The deadlines of a request sent `now`: decision due, reminders, expiry and the hold's end. */
async function decisionClock(
  deps: SubmissionDeps,
  tx: Prisma.TransactionClient,
  labSiteId: string,
) {
  const sla = await minutes(deps, tx, SUBMISSION_CONFIG_KEYS.slaBusinessMinutes);
  const grace = await minutes(deps, tx, SUBMISSION_CONFIG_KEYS.graceMinutes);
  const extra = await minutes(deps, tx, SUBMISSION_CONFIG_KEYS.holdExtraMinutes);
  let calendar: BusinessCalendar | null = null;
  try {
    calendar = deps.workingHours ? await deps.workingHours.calendarForSite(tx, labSiteId) : null;
  } catch (error) {
    // A site with no receiving hours yet: plain minutes, so a deadline always exists. Any other
    // error (a failed query aborts the transaction) is not hidden.
    if (!(error instanceof NoWorkingTimeError)) throw error;
    calendar = null;
  }
  const add = (from: Date, count: number) => {
    if (calendar === null) return addMinutes(from, count);
    try {
      return calendar.addBusinessMinutes(from, count);
    } catch (error) {
      if (!(error instanceof NoWorkingTimeError)) throw error;
      return addMinutes(from, count);
    }
  };
  const due = add(deps.now, sla);
  return {
    due,
    reminder50: add(deps.now, Math.round(sla * 0.5)),
    reminder90: add(deps.now, Math.round(sla * 0.9)),
    expires: add(due, grace),
    holdUntil: add(due, extra),
  };
}

async function scheduleDecisionTimers(
  deps: SubmissionDeps,
  tx: Prisma.TransactionClient,
  bookingId: string,
  clock: Awaited<ReturnType<typeof decisionClock>>,
): Promise<void> {
  const aggregate = bookingAggregate(bookingId);
  await deps.timers.schedule(tx, {
    type: 'LAB_DECISION_REMINDER_50',
    aggregate,
    dueAt: clock.reminder50,
  });
  await deps.timers.schedule(tx, {
    type: 'LAB_DECISION_REMINDER_90',
    aggregate,
    dueAt: clock.reminder90,
  });
  await deps.timers.schedule(tx, { type: 'LAB_DECISION_DUE', aggregate, dueAt: clock.expires });
}

/** The next booking number, `LC-YYMM-NNNNNNN` (IST month, a running number that never repeats). */
async function nextBookingNo(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_no_seq') AS n`;
  const yymm = istDateKey(now).slice(2, 7).replace('-', '');
  return `LC-${yymm}-${String(rows[0]?.n ?? 0n).padStart(7, '0')}`;
}

/** An active site of the organisation, or 422. */
async function requireCustomerSite(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerSiteId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id::text AS id FROM customer_site
     WHERE id = ${customerSiteId}::uuid AND organisation_id = ${orgId}::uuid AND status = 'ACTIVE'`);
  if (rows.length === 0) invalidSite();
}

function invalidSite(): never {
  throw invalid('customerSiteId', 'An active site of your organisation.');
}

/** An open slot of the site whose date is the preferred drop date (OQ-26: a slot is required). */
async function requireSlot(
  tx: Prisma.TransactionClient,
  labSiteId: string,
  slotId: string,
  preferredDropDate: string,
  now: Date,
): Promise<void> {
  const slot = await readSlot(tx, slotId);
  if (slot === null || slot.labSiteId !== labSiteId)
    throw invalid('slotId', 'A slot of this lab site.');
  if (slot.slotDate.toISOString().slice(0, 10) !== preferredDropDate) {
    throw invalid('preferredDropDate', "The slot's date.");
  }
  if (!slotHasRoom(slot, now)) {
    throw new BookingError('SLOT_UNAVAILABLE', {
      detail: 'The slot was taken or closed. Choose another.',
    });
  }
}

/** Takes a held place in `slotId` until `until`: the slot locked, its room checked again. */
async function holdPlace(
  tx: Prisma.TransactionClient,
  booking: { id: string; customerOrgId: string; labOrgId: string },
  slotId: string,
  until: Date,
  now: Date,
): Promise<void> {
  const slot = await lockSlot(tx, slotId);
  if (slot === null || !slotHasRoom(slot, now)) {
    throw new BookingError('SLOT_UNAVAILABLE', {
      detail: 'The slot was taken or closed. Choose another.',
    });
  }
  await tx.slotHold.create({
    data: {
      id: uuidv7(),
      bookingId: booking.id,
      customerOrgId: booking.customerOrgId,
      labOrgId: booking.labOrgId,
      slotId,
      kind: 'SOFT',
      expiresAt: until,
    },
  });
  await moveSlotPlace(tx, slotId, 'hold');
}

async function writeLines(
  tx: Prisma.TransactionClient,
  booking: { id: string; customerOrgId: string; labOrgId: string },
  priced: PricedBooking,
): Promise<void> {
  await tx.bookingLine.createMany({
    data: priced.lines.map((line) => ({
      id: uuidv7(),
      bookingId: booking.id,
      customerOrgId: booking.customerOrgId,
      labOrgId: booking.labOrgId,
      lineNo: line.lineNo,
      scopeLineId: line.scopeLineId,
      scopeLineVersionId: line.scopeLineVersionId,
      priceItemId: line.priceItemId,
      snapshot: line.snapshot as unknown as Prisma.InputJsonObject,
      unitPricePaise: line.unitPricePaise,
      samplePrepPaise: line.samplePrepPaise,
      gstRateBp: line.gstRateBp,
      gstPaise: line.gstPaise,
      lineTotalPaise: line.lineTotalPaise,
    })),
  });
}

/**
 * T-01: submits a REQUESTED booking for the actor's organisation, who becomes the owner. The
 * checks that need no lock come first (site, lines, slot, customer site); then the organisation's
 * open requests are counted under a per-organisation lock (BR-015); the engine inserts the
 * booking; the lines, TRF version 1 and the soft hold follow (the last place goes to the first to
 * commit, BR-011). Returns the new booking's id.
 */
export async function submitBooking(
  tx: Prisma.TransactionClient,
  deps: SubmissionDeps,
  actor: CustomerActor,
  input: SubmitBookingInput,
): Promise<string> {
  const priced = await priceBooking(tx, input.labSiteId, input.scopeLineIds, deps.now);
  if (input.customerSiteId !== undefined) {
    await requireCustomerSite(tx, actor.orgId, input.customerSiteId);
  }
  await requireSlot(tx, priced.labSiteId, input.slotId, input.preferredDropDate, deps.now);

  // BR-015: one submission at a time per organisation, so two cannot both pass the count.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('booking-open:' || ${actor.orgId}))`;
  const max = await deps.config.get(
    tx,
    SUBMISSION_CONFIG_KEYS.maxOpenRequests,
    configParsers.positiveInteger,
  );
  const open = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM booking
     WHERE customer_org_id = ${actor.orgId}::uuid AND status = 'REQUESTED'`;
  if ((open[0]?.n ?? 0) >= max) {
    throw new BookingError('OPEN_BOOKING_LIMIT', {
      detail: `Your organisation has ${String(max)} requests waiting for a lab. Wait for a decision or cancel one.`,
      meta: { limit: max },
    });
  }

  const clock = await decisionClock(deps, tx, priced.labSiteId);
  const firstLine = priced.lines[0];
  if (firstLine === undefined) throw invalid('lines', 'At least one test.');
  const labSnapshot = await labSnapshotOf(tx, priced.labSiteId, firstLine.accreditationId);
  const id = uuidv7(deps.now.getTime());
  const keys = { id, customerOrgId: actor.orgId, labOrgId: priced.labOrgId };
  await deps.engine.submit(tx, {
    actor,
    booking: {
      id,
      bookingNo: await nextBookingNo(tx, deps.now),
      customerOrgId: actor.orgId,
      ...(input.customerSiteId === undefined ? {} : { customerSiteId: input.customerSiteId }),
      requesterUserId: actor.userId,
      labSiteId: priced.labSiteId,
      labOrgId: priced.labOrgId,
      itemName: input.trf.form.itemName,
      batchNo: input.trf.form.batchNo ?? null,
      declaredPackageCount: input.declaredPackageCount,
      slotId: input.slotId,
      preferredDropDate: new Date(`${input.preferredDropDate}T00:00:00Z`),
      priceListId: priced.priceList.id,
      subtotalPaise: priced.subtotalPaise,
      gstPaise: priced.gstPaise,
      totalPaise: priced.totalPaise,
      labSnapshot,
      labDecisionDueAt: clock.due,
      createdByUserId: actor.userId,
    },
  });
  await writeLines(tx, keys, priced);
  await tx.trf.create({
    data: {
      id: uuidv7(),
      bookingId: id,
      customerOrgId: actor.orgId,
      labOrgId: priced.labOrgId,
      versionNo: 1,
      schemaVersion: input.trf.schemaVersion,
      form: input.trf.form,
      conformityRequired: input.trf.conformityRequired,
      decisionRule: input.trf.decisionRule,
      submittedByUserId: actor.userId,
      createdByUserId: actor.userId,
    },
  });
  await holdPlace(tx, keys, input.slotId, clock.holdUntil, deps.now);
  await scheduleDecisionTimers(deps, tx, id, clock);
  return id;
}

export interface EditBookingInput {
  customerSiteId?: string | null;
  slotId?: string;
  preferredDropDate?: string;
  declaredPackageCount?: number;
  scopeLineIds?: string[];
  trf?: TrfInput;
}

/**
 * T-02: edits a REQUESTED booking (FR-BKG-10, EC-11). The engine checks the state, the actor (owner
 * or Customer Admin) and `If-Match`. Then every line is re-priced against the price list in effect
 * now (BR-020) and the lines replaced, a new TRF version is written (the current form when none is
 * sent), the lab snapshot is taken again, the hold moves when the slot changes (both slots locked
 * in id order), and the lab decision clock restarts.
 */
export async function editBooking(
  tx: Prisma.TransactionClient,
  deps: SubmissionDeps,
  actor: CustomerActor,
  bookingId: string,
  ifMatch: number,
  input: EditBookingInput,
): Promise<void> {
  await deps.engine.transition(tx, {
    bookingId,
    transitionId: 'T-02',
    actor,
    expectedLockVersion: ifMatch,
  });
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const currentLines = await tx.bookingLine.findMany({
    where: { bookingId },
    orderBy: { lineNo: 'asc' },
    select: { scopeLineId: true },
  });
  const scopeLineIds = input.scopeLineIds ?? currentLines.map((line) => line.scopeLineId);
  const priced = await priceBooking(tx, booking.labSiteId, scopeLineIds, deps.now);
  if (input.customerSiteId !== undefined && input.customerSiteId !== null) {
    await requireCustomerSite(tx, booking.customerOrgId, input.customerSiteId);
  }
  const slotId = input.slotId ?? booking.slotId;
  if (slotId === null) throw invalid('slotId', 'A slot of this lab site.');
  const dropDate =
    input.preferredDropDate ??
    (input.slotId !== undefined
      ? ((await readSlot(tx, input.slotId))?.slotDate.toISOString().slice(0, 10) ?? '')
      : booking.preferredDropDate.toISOString().slice(0, 10));
  const slotChanged = slotId !== booking.slotId;
  if (slotChanged || input.preferredDropDate !== undefined) {
    // The current slot keeps its held place, so only a new slot is checked for room.
    const slot = await readSlot(tx, slotId);
    if (slot === null || slot.labSiteId !== booking.labSiteId) {
      throw invalid('slotId', 'A slot of this lab site.');
    }
    if (slot.slotDate.toISOString().slice(0, 10) !== dropDate) {
      throw invalid('preferredDropDate', "The slot's date.");
    }
    if (slotChanged && !slotHasRoom(slot, deps.now)) {
      throw new BookingError('SLOT_UNAVAILABLE', {
        detail: 'The slot was taken or closed. Choose another.',
      });
    }
  }

  const keys = { id: bookingId, customerOrgId: booking.customerOrgId, labOrgId: booking.labOrgId };
  // The booking's price list first: trg_booking_line_guard checks each new line's price item
  // against it (BR-020 re-snapshots against the list in effect now).
  await tx.booking.update({ where: { id: bookingId }, data: { priceListId: priced.priceList.id } });
  await tx.bookingLine.deleteMany({ where: { bookingId } });
  await writeLines(tx, keys, priced);

  const currentTrf = await tx.trf.findFirstOrThrow({
    where: { bookingId, versionNo: booking.currentTrfVersion },
  });
  const trf: TrfInput = input.trf ?? {
    schemaVersion: currentTrf.schemaVersion,
    form: currentTrf.form as TrfInput['form'],
    conformityRequired: currentTrf.conformityRequired,
    decisionRule: currentTrf.decisionRule,
  };
  const versionNo = booking.currentTrfVersion + 1;
  await tx.trf.create({
    data: {
      id: uuidv7(),
      bookingId,
      customerOrgId: booking.customerOrgId,
      labOrgId: booking.labOrgId,
      versionNo,
      schemaVersion: trf.schemaVersion,
      form: trf.form,
      conformityRequired: trf.conformityRequired,
      decisionRule: trf.decisionRule,
      submittedByUserId: actor.userId,
      createdByUserId: actor.userId,
    },
  });

  const clock = await decisionClock(deps, tx, booking.labSiteId);
  const firstLine = priced.lines[0];
  if (firstLine === undefined) throw invalid('lines', 'At least one test.');
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      ...(input.customerSiteId === undefined ? {} : { customerSiteId: input.customerSiteId }),
      ...(input.declaredPackageCount === undefined
        ? {}
        : { declaredPackageCount: input.declaredPackageCount }),
      itemName: trf.form.itemName,
      batchNo: trf.form.batchNo ?? null,
      slotId,
      preferredDropDate: new Date(`${dropDate}T00:00:00Z`),
      priceListId: priced.priceList.id,
      subtotalPaise: priced.subtotalPaise,
      gstPaise: priced.gstPaise,
      totalPaise: priced.totalPaise,
      labSnapshot: await labSnapshotOf(tx, booking.labSiteId, firstLine.accreditationId),
      currentTrfVersion: versionNo,
      labDecisionDueAt: clock.due,
    },
  });

  // The hold: moved to the new slot (both slots locked in id order), or its end moved with the
  // restarted clock.
  const hold = await tx.slotHold.findFirst({ where: { bookingId, releasedAt: null } });
  if (slotChanged) {
    const ids = [...new Set([slotId, ...(hold === null ? [] : [hold.slotId])])].sort();
    for (const id of ids) await lockSlot(tx, id);
    if (hold !== null) {
      const released = await tx.slotHold.updateMany({
        where: { id: hold.id, releasedAt: null },
        data: { releasedAt: deps.now },
      });
      if (released.count === 1) {
        await moveSlotPlace(
          tx,
          hold.slotId,
          hold.kind === 'SOFT' ? 'releaseHeld' : 'releaseBooked',
        );
      }
    }
    await holdPlace(tx, keys, slotId, clock.holdUntil, deps.now);
  } else if (hold !== null) {
    const slot = await lockSlot(tx, slotId);
    if (slot === null || slot.status !== 'OPEN' || slot.startsAt.getTime() <= deps.now.getTime()) {
      throw new BookingError('SLOT_UNAVAILABLE', {
        detail: 'The slot is closed or has started. Choose another.',
      });
    }
    await tx.slotHold.update({ where: { id: hold.id }, data: { expiresAt: clock.holdUntil } });
  } else {
    await holdPlace(tx, keys, slotId, clock.holdUntil, deps.now);
  }

  await deps.timers.cancelForAggregate(tx, bookingAggregate(bookingId), [
    'LAB_DECISION_REMINDER_50',
    'LAB_DECISION_REMINDER_90',
    'LAB_DECISION_DUE',
  ]);
  await scheduleDecisionTimers(deps, tx, bookingId, clock);
}

/** `estimateBooking`: prices the lines and checks the slot, holding nothing. */
export async function estimateBooking(
  tx: Prisma.TransactionClient,
  now: Date,
  input: { labSiteId: string; scopeLineIds: string[]; slotId?: string },
): Promise<PricedBooking> {
  const priced = await priceBooking(tx, input.labSiteId, input.scopeLineIds, now);
  if (input.slotId !== undefined) {
    const slot = await readSlot(tx, input.slotId);
    if (slot === null || slot.labSiteId !== priced.labSiteId) {
      throw invalid('slotId', 'A slot of this lab site.');
    }
    if (!slotHasRoom(slot, now)) {
      throw new BookingError('SLOT_UNAVAILABLE', { detail: 'The slot is closed or full.' });
    }
  }
  return priced;
}

export interface DuplicateMatchView {
  id: string;
  bookingNo: string;
  status: string;
  createdAt: Date;
  labSiteName: string;
  visible: boolean;
}

/**
 * `checkBookingDuplicates` (BR-016, FR-BKG-09): bookings of the organisation in the window with
 * the same item (ignoring case and spaces at the ends), the same batch and the same set of
 * parameters, at any lab. `visible` says whether the caller may see the match (a requester sees
 * their own); `duplicateFound` counts them all.
 */
export async function findDuplicateBookings(
  tx: Prisma.TransactionClient,
  deps: Pick<SubmissionDeps, 'config' | 'now'>,
  actor: { orgId: string; userId: string; wide: boolean },
  input: { itemName: string; batchNo: string; scopeLineIds: string[] },
): Promise<{ windowDays: number; matches: DuplicateMatchView[] }> {
  const windowDays = await deps.config.get(
    tx,
    SUBMISSION_CONFIG_KEYS.duplicateWindowDays,
    configParsers.positiveInteger,
  );
  const params = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT parameter_node_id::text AS id FROM scope_line
     WHERE id = ANY(${[...input.scopeLineIds]}::uuid[])`);
  if (params.length === 0) {
    throw invalid('lines', 'Known tests.');
  }
  const wanted = params.map((row) => row.id);
  const since = new Date(deps.now.getTime() - windowDays * 86_400_000);
  const rows = await tx.$queryRaw<
    {
      id: string;
      booking_no: string;
      status: string;
      created_at: Date;
      site_name: string;
      requester_user_id: string;
    }[]
  >(Prisma.sql`
    SELECT b.id::text AS id, b.booking_no, b.status::text AS status, b.created_at,
           s.name AS site_name, b.requester_user_id::text AS requester_user_id
      FROM booking b
      JOIN lab_site s ON s.id = b.lab_site_id
     WHERE b.customer_org_id = ${actor.orgId}::uuid
       AND b.created_at >= ${since}::timestamptz
       AND lower(btrim(b.item_name)) = lower(btrim(${input.itemName}))
       AND lower(btrim(b.batch_no)) = lower(btrim(${input.batchNo}))
       AND (SELECT array_agg(DISTINCT sl.parameter_node_id::text ORDER BY sl.parameter_node_id::text)
              FROM booking_line bl JOIN scope_line sl ON sl.id = bl.scope_line_id
             WHERE bl.booking_id = b.id)
           = (SELECT array_agg(x ORDER BY x) FROM unnest(${wanted}::text[]) x)
     ORDER BY b.created_at DESC
     LIMIT 50`);
  return {
    windowDays,
    matches: rows.map((row) => ({
      id: row.id,
      bookingNo: row.booking_no,
      status: row.status,
      createdAt: row.created_at,
      labSiteName: row.site_name,
      visible: actor.wide || row.requester_user_id === actor.userId,
    })),
  };
}
