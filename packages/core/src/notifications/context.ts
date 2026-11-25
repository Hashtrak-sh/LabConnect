import type { EventEnvelope } from '../platform/events.js';

// What the notifications consumer needs to know about an event that the event does not carry.
// A booking event holds ids and a status change (`{ bookingId, fromStatus, toStatus,
// transitionId }`), not the booking number, the parties or the lab's name. The consumer may not
// read the booking or labs tables (MODULE_BOUNDARIES.md), so it asks a port, and the module
// that owns the data implements it (OQ-140). An adapter that returns this shape is all a
// module has to provide.

export interface NotificationContext {
  /** The booking, when the event is about one. Ids only; used for the deep link. */
  bookingId?: string;
  /** Human-readable reference, `bookingNo` in the templates. */
  bookingNo?: string;
  labName?: string;
  /** For `user.invited` the inviting organisation, for `payout.released` the paid lab. */
  organisationName?: string;
  /**
   * Where the notification leads, a path on the web app (`/bookings/<id>`): ids only, never
   * personal data. Defaults to `/bookings/<bookingId>` when a booking is known.
   */
  actionPath?: string;
  /**
   * The customer side. `userIds` are the people the matrix means by "the customer" (the
   * requester). Each must still be an active member of the organisation; if none is, the
   * organisation's active `CUSTOMER_ADMIN` users are told instead (OQ-144). An event that
   * concerns several customers (`accreditation.changed`) lists several entries.
   */
  customers?: { organisationId: string; userIds: readonly string[] }[];
  /** The lab side: the organisation and, if the event belongs to one site, the site (Makers and Checkers are site-bound). */
  lab?: { organisationId: string; siteId?: string };
  /** The one user a `user.invited` event is for. */
  invitee?: { userId: string; organisationId: string };
}

export interface NotificationContextPort {
  /**
   * The context of an event, or `null` when the subject of the event cannot be found (the
   * consumer then fails the message, so it is retried and, if it stays unknown, ends in the
   * dead-letter queue where someone sees it). Must not return another organisation's people
   * for the event: the consumer trusts the organisation ids it is given.
   */
  resolve(envelope: EventEnvelope): Promise<NotificationContext | null>;
}

/** A context source for tests and for development with no booking adapter: contexts are put in by hand. */
export class InMemoryNotificationContext implements NotificationContextPort {
  private readonly byAggregate = new Map<string, NotificationContext>();

  /** The context of events of this aggregate (a booking id, an organisation id, ...). */
  set(aggregateId: string, context: NotificationContext): this {
    this.byAggregate.set(aggregateId, context);
    return this;
  }

  resolve(envelope: EventEnvelope): Promise<NotificationContext | null> {
    return Promise.resolve(this.byAggregate.get(envelope.aggregate.id) ?? null);
  }
}

/** The event's subject could not be found. */
export class NotificationContextMissingError extends Error {
  override name = 'NotificationContextMissingError';
  constructor(readonly eventType: string) {
    super(`No notification context for an event of type ${eventType}.`);
  }
}
