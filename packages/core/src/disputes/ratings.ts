import type { Prisma, RatingDirection } from '@labconnect/database';

/** A rating on a booking (`BookingRating`). */
export interface BookingRatingView {
  direction: RatingDirection;
  scoreOverall: number;
  scoreTat: number | null;
  scoreCommunication: number | null;
  comment: string | null;
  isPublic: boolean;
  createdAt: Date;
}

/**
 * The rating given on a booking in one direction, or `null` (disputes owns `rating`). The caller
 * asks only for its own side's rating: `CUSTOMER_TO_LAB` for the customer, `LAB_TO_CUSTOMER` for
 * the lab. RLS also keeps the lab's rating of a customer from the customer.
 */
export async function bookingRating(
  tx: Prisma.TransactionClient,
  bookingId: string,
  direction: RatingDirection,
): Promise<BookingRatingView | null> {
  const found = await tx.rating.findUnique({
    where: { bookingId_direction: { bookingId, direction } },
  });
  if (found === null) return null;
  return {
    direction: found.direction,
    scoreOverall: found.scoreOverall,
    scoreTat: found.scoreTat,
    scoreCommunication: found.scoreCommunication,
    comment: found.comment,
    isPublic: found.isPublic,
    createdAt: found.createdAt,
  };
}
