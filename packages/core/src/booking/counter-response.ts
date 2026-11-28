import { Prisma, uuidv7 } from '@labconnect/database';
import { lockSlot, moveSlotPlace, readSlot, slotHasRoom } from '../labs/capacity.js';
import { BookingError } from './errors.js';
import { confirmSlotHold } from './lab-decisions.js';
import type { TransitionRegistry } from './registry.js';
import type { EffectContext, TransitionContext } from './types.js';

// The customer's answer to the lab's counter-offer (I3-LAB-01, BOOKING_STATE_MACHINE §3):
// - T-07 AcceptCounter: guards "counter is PENDING" (and not past its expiry) and "the new slot
//   still has capacity". The slot swap: the booking moves to the proposed slot, the old place is
//   released and a booked place taken in the new slot, the two slots locked in id order
//   (`labs/capacity.ts`). Without another slot, the hold is confirmed as on T-03. The agreed
//   quantities are written to the lines (`required_sample_qty`). The engine sets `payment_due_at`
//   and the default effects schedule the payment timers.
// - T-08 DeclineCounter (the owner) or ExpireCounter (the timer): the offer becomes DECLINED or
//   EXPIRED; the hold is released by `booking.release-slot-hold` (lab-decisions.ts). A T-25
//   cancellation of a COUNTERED booking also closes its offer as EXPIRED.
// The offer answered is the booking's latest one; a booking is COUNTERED once (T-04 is from
// REQUESTED only), so there is at most one PENDING offer.

interface PendingOffer {
  id: string;
  proposedSlotId: string | null;
  proposedDropDate: Date | null;
  expiresAt: Date;
  perLineQuantity: { lineId: string; sampleQty: number; unitCode: string }[];
}

async function pendingOffer(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<PendingOffer | null> {
  const offer = await tx.counterOffer.findFirst({
    where: { bookingId, status: 'PENDING' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (offer === null) return null;
  const quantities = Array.isArray(offer.perLineQuantity)
    ? (offer.perLineQuantity as unknown as PendingOffer['perLineQuantity'])
    : [];
  return {
    id: offer.id,
    proposedSlotId: offer.proposedSlotId,
    proposedDropDate: offer.proposedDropDate,
    expiresAt: offer.expiresAt,
    perLineQuantity: quantities,
  };
}

/** The pending, unexpired offer of the booking, or 409 (the contract: "the counter-offer has expired"). */
async function liveOffer(context: TransitionContext): Promise<PendingOffer> {
  const offer = await pendingOffer(context.tx, context.booking.id);
  if (offer === null || offer.expiresAt.getTime() <= context.now.getTime()) {
    throw new BookingError('INVALID_STATE_TRANSITION', {
      detail: 'The counter-offer is no longer open.',
      meta: { currentState: context.booking.status, transitionId: context.transition.id },
    });
  }
  return offer;
}

/** The proposed slot, when it is another slot than the booking's. */
function movesTo(offer: PendingOffer, booking: { slotId: string | null }): string | null {
  return offer.proposedSlotId !== null && offer.proposedSlotId !== booking.slotId
    ? offer.proposedSlotId
    : null;
}

function slotUnavailable(): BookingError {
  return new BookingError('SLOT_UNAVAILABLE', {
    detail: 'The proposed slot is now closed or full.',
  });
}

export function registerCounterResponseRules(registry: TransitionRegistry): TransitionRegistry {
  registry.addGuard('T-07', {
    name: 'booking.counter-is-pending',
    async run(context) {
      const offer = await liveOffer(context);
      const target = movesTo(offer, context.booking);
      if (target === null) return;
      // A read: the slot is locked and checked again by the effect, in id order with the old one.
      const slot = await readSlot(context.tx, target);
      if (slot === null || !slotHasRoom(slot, context.now)) throw slotUnavailable();
    },
  });

  registry.addColumns('T-07', {
    name: 'booking.counter-slot',
    async build(context) {
      const offer = await liveOffer(context);
      const target = movesTo(offer, context.booking);
      if (target === null) return {};
      return {
        slotId: target,
        ...(offer.proposedDropDate !== null && { preferredDropDate: offer.proposedDropDate }),
      };
    },
  });

  registry.addEffect('T-07', {
    name: 'booking.accept-counter-offer',
    async run(context) {
      const offer = await liveOffer(context);
      const target = movesTo(offer, context.booking);
      if (target === null) {
        await confirmSlotHold(context, 'The booked slot is closed or full.');
      } else {
        await swapSlot(context, target);
      }
      for (const quantity of offer.perLineQuantity) {
        await context.tx.$executeRaw(Prisma.sql`
          UPDATE booking_line SET required_sample_qty = ${quantity.sampleQty}::numeric,
                                  updated_at = now()
           WHERE id = ${quantity.lineId}::uuid AND booking_id = ${context.updated.id}::uuid`);
      }
      await answerOffer(context, offer.id, 'ACCEPTED');
    },
  });

  // T-25 from COUNTERED: the booking is cancelled before the customer answered; the offer lapses.
  registry.addEffect(['T-08', 'T-25'], {
    name: 'booking.close-counter-offer',
    async run(context) {
      const offer = await pendingOffer(context.tx, context.updated.id);
      if (offer === null) return;
      // An offer past its expiry whose timer has not fired yet expired; a decline does not
      // change that (the booking ends EXPIRED either way).
      const lapsed = offer.expiresAt.getTime() <= context.now.getTime();
      await answerOffer(
        context,
        offer.id,
        context.transition.id === 'T-08' && context.command.actor.kind === 'USER' && !lapsed
          ? 'DECLINED'
          : 'EXPIRED',
      );
    },
  });

  return registry;
}

/**
 * The booking leaves its old place (if it still has a live hold) for a booked place in `target`.
 * Both slots are locked in id order (deadlock-free, `labs/capacity.ts`), and the new one is
 * checked again under the lock.
 */
async function swapSlot(context: EffectContext, target: string): Promise<void> {
  const hold = await context.tx.slotHold.findFirst({
    where: { bookingId: context.updated.id, releasedAt: null },
  });
  const ids = [...new Set([target, ...(hold === null ? [] : [hold.slotId])])].sort();
  const locked = new Map<string, Awaited<ReturnType<typeof lockSlot>>>();
  for (const id of ids) locked.set(id, await lockSlot(context.tx, id));
  const slot = locked.get(target) ?? null;
  if (slot === null || !slotHasRoom(slot, context.now)) throw slotUnavailable();
  if (hold !== null) {
    const released = await context.tx.slotHold.updateMany({
      where: { id: hold.id, releasedAt: null },
      data: { releasedAt: context.now },
    });
    if (released.count === 1) {
      await moveSlotPlace(
        context.tx,
        hold.slotId,
        hold.kind === 'SOFT' ? 'releaseHeld' : 'releaseBooked',
      );
    }
  }
  await context.tx.slotHold.create({
    data: {
      id: uuidv7(),
      bookingId: context.updated.id,
      customerOrgId: context.updated.customerOrgId,
      labOrgId: context.updated.labOrgId,
      slotId: target,
      kind: 'CONFIRMED',
    },
  });
  await moveSlotPlace(context.tx, target, 'book');
}

async function answerOffer(
  context: EffectContext,
  offerId: string,
  status: 'ACCEPTED' | 'DECLINED' | 'EXPIRED',
): Promise<void> {
  const actor = context.command.actor;
  const userId = actor.kind === 'USER' ? actor.userId : null;
  await context.tx.counterOffer.updateMany({
    where: { id: offerId, status: 'PENDING' },
    data: {
      status,
      respondedByUserId: status === 'EXPIRED' ? null : userId,
      respondedAt: status === 'EXPIRED' ? null : context.now,
      updatedAt: context.now,
      lockVersion: { increment: 1 },
    },
  });
}
