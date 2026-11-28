import { Prisma, uuidv7 } from '@labconnect/database';
import { lockSlot, moveSlotPlace, readSlot, slotHasRoom } from '../labs/capacity.js';
import { configParsers } from '../platform/config-parameters.js';
import type { CoreErrorIssue } from '../platform/errors.js';
import { BookingError } from './errors.js';
import type { TransitionRegistry } from './registry.js';
import { addMinutes, BOOKING_CONFIG_KEYS } from './status-columns.js';
import type { EffectContext, TransitionContext } from './types.js';

// The lab's decision on a request (I3-LAB-01, BOOKING_STATE_MACHINE §3) and the slot hold it moves:
// - T-03 AcceptBooking: guard "site still bookable"; the hold converts to a booking (SOFT to
//   CONFIRMED, one place from held to booked). The engine sets `payment_due_at` and the default
//   effects schedule the payment timers.
// - T-04 CounterBooking: only a slot of the same site and/or more sample per line (BR-017); the
//   proposed slot is checked for room but not held (it is checked again on T-07). The engine's
//   default effect schedules `COUNTER_RESPONSE_DUE`; this writes the `counter_offer` row.
// - T-05 RejectBooking: the engine writes the reason; the hold is released here.
// The hold is also released when the request expires undecided (T-06), the counter is declined or
// expires (T-08), the payment window expires (T-10), the sample is not dropped (T-12), and on every
// cancellation (T-25 to T-28), as the table says for each ("Hold released", "Slot released").
// A hold is changed only where it is still live (`released_at IS NULL`), and a count moves only when
// that change happened, so no path can release or confirm the same place twice.

/** What `counterBooking` sends to the engine (`command.input`). */
export interface CounterOfferInput {
  proposedSlotId?: string;
  perLineQuantity?: { lineId: string; sampleQty: number; unitCode: string }[];
  message: string;
}

const RELEASE_ON = [
  'T-05',
  'T-06',
  'T-08',
  'T-10',
  'T-12',
  'T-25',
  'T-26',
  'T-27',
  'T-28',
] as const;

function invalid(issues: CoreErrorIssue[]): BookingError {
  return new BookingError('VALIDATION_FAILED', {
    detail: 'Some fields are missing or not valid.',
    errors: issues,
  });
}

function counterInput(context: TransitionContext): CounterOfferInput {
  const input = context.command.input as Partial<CounterOfferInput> | undefined;
  if (input === undefined || typeof input.message !== 'string') {
    throw invalid([{ path: 'message', code: 'REQUIRED', message: 'Explain the counter-offer.' }]);
  }
  return input as CounterOfferInput;
}

/** The node id of an active REJECTION_REASON code, or `null` (the caller answers 422). */
export async function rejectionReasonNodeId(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT n.id::text AS id
      FROM md_node n JOIN md_taxonomy t ON t.id = n.taxonomy_id
     WHERE t.code = 'REJECTION_REASON' AND n.code = ${code} AND n.status = 'ACTIVE'`);
  return rows[0]?.id ?? null;
}

/**
 * The booking's place in its slot becomes a booked one (T-03, and T-07 without another slot): a
 * SOFT hold is confirmed (held to booked). A booking with a slot whose hold is gone (released by
 * expiry) takes a place again, or is refused with `SLOT_UNAVAILABLE`, so an accepted booking
 * always counts in its slot (BR-011). No slot: nothing to do.
 */
export async function confirmSlotHold(context: EffectContext, fullDetail: string): Promise<void> {
  const hold = await context.tx.slotHold.findFirst({
    where: { bookingId: context.updated.id, releasedAt: null },
  });
  if (hold === null) {
    const slotId = context.updated.slotId;
    if (slotId === null) return;
    const slot = await lockSlot(context.tx, slotId);
    if (slot === null || !slotHasRoom(slot, context.now)) {
      throw new BookingError('SLOT_UNAVAILABLE', { detail: fullDetail });
    }
    await context.tx.slotHold.create({
      data: {
        id: uuidv7(),
        bookingId: context.updated.id,
        customerOrgId: context.updated.customerOrgId,
        labOrgId: context.updated.labOrgId,
        slotId,
        kind: 'CONFIRMED',
      },
    });
    await moveSlotPlace(context.tx, slotId, 'book');
    return;
  }
  if (hold.kind === 'CONFIRMED') return;
  await lockSlot(context.tx, hold.slotId);
  const changed = await context.tx.slotHold.updateMany({
    where: { id: hold.id, releasedAt: null, kind: 'SOFT' },
    data: { kind: 'CONFIRMED', expiresAt: null },
  });
  if (changed.count === 1) await moveSlotPlace(context.tx, hold.slotId, 'confirm');
}

export function registerLabDecisionRules(registry: TransitionRegistry): TransitionRegistry {
  registry.addGuard('T-03', {
    name: 'booking.site-still-bookable',
    async run(context) {
      const rows = await context.tx.$queryRaw<{ is_bookable: boolean; reasons: string[] }[]>(
        Prisma.sql`SELECT is_bookable, bookability_reasons AS reasons FROM lab_site
                    WHERE id = ${context.booking.labSiteId}::uuid`,
      );
      const site = rows[0];
      if (site?.is_bookable !== true) {
        throw new BookingError('SITE_NOT_BOOKABLE', {
          detail: 'The site cannot take bookings at the moment.',
          meta: { reasons: site?.reasons ?? [] },
        });
      }
    },
  });

  registry.addEffect('T-03', {
    name: 'booking.confirm-slot-hold',
    run: (context) =>
      confirmSlotHold(context, 'The booked slot is closed or full: counter with another slot.'),
  });

  registry.addEffect([...RELEASE_ON], {
    name: 'booking.release-slot-hold',
    async run(context) {
      const hold = await context.tx.slotHold.findFirst({
        where: { bookingId: context.updated.id, releasedAt: null },
      });
      if (hold === null) return;
      await lockSlot(context.tx, hold.slotId);
      const changed = await context.tx.slotHold.updateMany({
        where: { id: hold.id, releasedAt: null },
        data: { releasedAt: context.now },
      });
      if (changed.count !== 1) return;
      await moveSlotPlace(
        context.tx,
        hold.slotId,
        hold.kind === 'SOFT' ? 'releaseHeld' : 'releaseBooked',
      );
    },
  });

  registry.addGuard('T-04', {
    name: 'booking.counter-offer-is-valid',
    async run(context) {
      const input = counterInput(context);
      const issues: CoreErrorIssue[] = [];
      if (input.proposedSlotId === undefined && (input.perLineQuantity ?? []).length === 0) {
        issues.push({
          path: 'proposedSlotId',
          code: 'REQUIRED',
          message: 'Propose another slot, more sample, or both.',
        });
      }
      if (input.proposedSlotId !== undefined) {
        // A read, not a lock: the proposed slot is not held (it is checked again on T-07).
        const slot = await readSlot(context.tx, input.proposedSlotId);
        if (slot === null || slot.labSiteId !== context.booking.labSiteId) {
          issues.push({
            path: 'proposedSlotId',
            code: 'INVALID_VALUE',
            message: 'Propose a slot of the same site.',
          });
        } else if (!slotHasRoom(slot, context.now)) {
          throw new BookingError('SLOT_UNAVAILABLE', {
            detail: 'The proposed slot is closed, full or already started.',
          });
        }
      }
      const quantities = input.perLineQuantity ?? [];
      if (quantities.length > 0) {
        // The unit and the quantity the lab needs now of each line: an agreed counter's, else the
        // stored snapshot's, else the price item's. A counter only asks for more (BR-017).
        const lines = await context.tx.$queryRaw<
          { id: string; unit_code: string; current_qty: string }[]
        >(Prisma.sql`
          SELECT bl.id::text AS id,
                 COALESCE(bl.snapshot->'sampleUnit'->>'code', un.code) AS unit_code,
                 COALESCE(bl.required_sample_qty,
                          CASE WHEN jsonb_typeof(bl.snapshot->'sampleQty') = 'number'
                               THEN (bl.snapshot->>'sampleQty')::numeric END,
                          pi.sample_qty)::text AS current_qty
            FROM booking_line bl
            JOIN price_item pi ON pi.id = bl.price_item_id
            JOIN md_node un ON un.id = pi.sample_unit_node_id
           WHERE bl.booking_id = ${context.booking.id}::uuid`);
        const unitOf = new Map(lines.map((line) => [line.id, line.unit_code]));
        const quantityOf = new Map(lines.map((line) => [line.id, Number(line.current_qty)]));
        const seen = new Set<string>();
        quantities.forEach((quantity, index) => {
          const path = `perLineQuantity[${String(index)}]`;
          const unit = unitOf.get(quantity.lineId.toLowerCase());
          if (unit === undefined) {
            issues.push({
              path: `${path}.lineId`,
              code: 'INVALID_VALUE',
              message: 'A line of this booking.',
            });
          } else if (unit !== quantity.unitCode) {
            issues.push({
              path: `${path}.unitCode`,
              code: 'INVALID_VALUE',
              message: `The line's unit is ${unit}.`,
            });
          } else if (quantity.sampleQty <= (quantityOf.get(quantity.lineId.toLowerCase()) ?? 0)) {
            issues.push({
              path: `${path}.sampleQty`,
              code: 'INVALID_VALUE',
              message: 'A counter-offer can only ask for more sample than the line needs now.',
            });
          }
          if (seen.has(quantity.lineId.toLowerCase())) {
            issues.push({
              path: `${path}.lineId`,
              code: 'DUPLICATE',
              message: 'A line may appear once.',
            });
          }
          seen.add(quantity.lineId.toLowerCase());
        });
      }
      if (issues.length > 0) throw invalid(issues);
    },
  });

  registry.addEffect('T-04', {
    name: 'booking.write-counter-offer',
    async run(context) {
      const input = counterInput(context);
      const actor = context.command.actor;
      if (actor.kind !== 'USER') throw new Error('A counter-offer is made by a lab Checker.');
      const minutes = await context.services.config.get(
        context.tx,
        BOOKING_CONFIG_KEYS.counterResponseMinutes,
        configParsers.positiveInteger,
      );
      const slot =
        input.proposedSlotId === undefined
          ? null
          : await context.tx.slot.findUnique({
              where: { id: input.proposedSlotId },
              select: { slotDate: true },
            });
      const quantities = (input.perLineQuantity ?? []).map((quantity) => ({
        lineId: quantity.lineId.toLowerCase(),
        sampleQty: quantity.sampleQty,
        unitCode: quantity.unitCode,
      }));
      await context.tx.counterOffer.create({
        data: {
          id: uuidv7(),
          bookingId: context.updated.id,
          customerOrgId: context.updated.customerOrgId,
          labOrgId: context.updated.labOrgId,
          proposedSlotId: input.proposedSlotId ?? null,
          proposedDropDate: slot?.slotDate ?? null,
          perLineQuantity: quantities.length === 0 ? Prisma.DbNull : quantities,
          message: input.message,
          status: 'PENDING',
          expiresAt: addMinutes(context.now, minutes),
          proposedByUserId: actor.userId,
          createdByUserId: actor.userId,
        },
      });
    },
  });

  return registry;
}
