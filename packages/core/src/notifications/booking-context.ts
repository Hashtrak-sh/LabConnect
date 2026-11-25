import { type PrismaClient, withDbContext } from '@labconnect/database';
import { BOOKING_AGGREGATE } from '../booking/default-effects.js';
import { loadBookingNotificationContext } from '../booking/notification-context.js';
import { loadOrganisationName } from '../identity/recipients.js';
import type { EventEnvelope } from '../platform/events.js';
import type { NotificationContext, NotificationContextPort } from './context.js';

/**
 * The `NotificationContextPort` for events of a booking (aggregate type `booking`): every
 * `booking.*`, `payment.*`, `handover.*`, `receipt.*`, `testing.*`, `report.*`, `hold.*` and
 * `approval.*` event the booking engine and the booking timers raise, and `dispute.opened` of
 * transition T-22. All of them are about one booking and the matrix names the people from its
 * parties, so the booking row is enough.
 *
 * Events of any other aggregate (a dispute, a refund, a payout, an accreditation, a lead, an
 * invitation, a label reprint) need modules that do not exist yet: they get `null` ("no
 * context"), which the consumer treats like a missing subject (the message fails, is retried and
 * ends in the dead-letter queue after 5 receives, and only its own message group waits).
 *
 * The aggregate id of the envelope is the only thing trusted; the organisations and the
 * requester come from the booking row, never from the event data.
 */
export class BookingNotificationContext implements NotificationContextPort {
  constructor(private readonly prisma: Pick<PrismaClient, '$transaction'>) {}

  resolve(envelope: EventEnvelope): Promise<NotificationContext | null> {
    if (envelope.aggregate.type !== BOOKING_AGGREGATE) return Promise.resolve(null);
    const bookingId = envelope.aggregate.id;
    return withDbContext(this.prisma, { kind: 'system' }, async (tx) => {
      const facts = await loadBookingNotificationContext(tx, bookingId);
      if (!facts) return null;
      const labName = facts.labName ?? (await loadOrganisationName(tx, facts.labOrgId));
      return {
        bookingId: facts.bookingId,
        bookingNo: facts.bookingNo,
        ...(labName === null ? {} : { labName }),
        customers: [{ organisationId: facts.customerOrgId, userIds: [facts.requesterUserId] }],
        lab: { organisationId: facts.labOrgId, siteId: facts.labSiteId },
      };
    });
  }
}
