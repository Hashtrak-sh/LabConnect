import type { Prisma } from '@labconnect/database';

/**
 * What a notification about a booking needs to know that the event does not carry: the
 * reference, the parties and the lab's name. Ids and two display strings only; nothing about
 * the item, the prices, the people's contact details or any report. The booking module offers
 * this read so that the notifications adapter does not read the booking table itself
 * (MODULE_BOUNDARIES.md: a module's tables belong to the module).
 */
export interface BookingNotificationFacts {
  bookingId: string;
  bookingNo: string;
  requesterUserId: string;
  customerOrgId: string;
  labOrgId: string;
  labSiteId: string;
  /**
   * The lab's name as it was when the booking was submitted (`lab_snapshot.labName`). Absent
   * when the snapshot has none; the adapter then asks identity for the organisation's name.
   */
  labName?: string;
}

function snapshotLabName(snapshot: unknown): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return undefined;
  }
  const name = (snapshot as Record<string, unknown>).labName;
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

/**
 * The notification facts of one booking, or `null` if there is no such booking. Run it in the
 * system context (the notifications consumer does): it must see bookings of every organisation.
 */
export async function loadBookingNotificationContext(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<BookingNotificationFacts | null> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingNo: true,
      requesterUserId: true,
      customerOrgId: true,
      labOrgId: true,
      labSiteId: true,
      labSnapshot: true,
    },
  });
  if (!booking) return null;
  const labName = snapshotLabName(booking.labSnapshot);
  return {
    bookingId: booking.id,
    bookingNo: booking.bookingNo,
    requesterUserId: booking.requesterUserId,
    customerOrgId: booking.customerOrgId,
    labOrgId: booking.labOrgId,
    labSiteId: booking.labSiteId,
    ...(labName === undefined ? {} : { labName }),
  };
}
