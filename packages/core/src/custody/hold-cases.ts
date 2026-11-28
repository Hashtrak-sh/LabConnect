import type { HoldDecision, HoldStatus, Prisma } from '@labconnect/database';

/** A hold case as the booking detail shows it (`BookingHoldCase`). */
export interface BookingHoldCaseView {
  id: string;
  status: HoldStatus;
  reason: { code: string; name: string };
  details: string | null;
  dueAt: Date;
  decision: HoldDecision | null;
  decidedAt: Date | null;
  escalatedAt: Date | null;
}

/**
 * The latest hold case of a booking, or `null` (custody owns `hold_case`). It reads inside the
 * caller's transaction, so RLS limits it to the booking's two parties; the caller has already
 * checked that the actor may read the booking.
 */
export async function latestBookingHoldCase(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<BookingHoldCaseView | null> {
  const found = await tx.holdCase.findFirst({
    where: { bookingId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { reasonNode: { select: { code: true, name: true } } },
  });
  if (found === null) return null;
  return {
    id: found.id,
    status: found.status,
    reason: { code: found.reasonNode.code, name: found.reasonNode.name },
    details: found.details,
    dueAt: found.dueAt,
    decision: found.customerDecision,
    decidedAt: found.decidedAt,
    escalatedAt: found.escalatedAt,
  };
}
