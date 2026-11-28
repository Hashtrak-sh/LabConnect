import { Injectable } from '@nestjs/common';
import type { components } from '@labconnect/api-contract';
import {
  type BookingListInput,
  type BookingSlotView,
  type BookingSummaryView,
  bookingVisibility,
  type CurrentActor,
  listBookings,
  TenantScope,
} from '@labconnect/core';
import { CURRENCY, paiseToJson } from '@labconnect/shared';
import { DomainError } from '../../common/domain-error.js';

type Schemas = components['schemas'];
export type BookingListBody = Schemas['BookingList'];
type BookingSummaryBody = Schemas['BookingSummary'];
type PublicSlotBody = Schemas['PublicSlot'];

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export function toPublicSlotBody(slot: BookingSlotView): PublicSlotBody {
  return {
    id: slot.id,
    date: isoDate(slot.date),
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    discipline: slot.discipline,
  };
}

export function toBookingSummaryBody(booking: BookingSummaryView): BookingSummaryBody {
  return {
    id: booking.id,
    bookingNo: booking.bookingNo,
    status: booking.status,
    statusChangedAt: booking.statusChangedAt.toISOString(),
    itemName: booking.itemName,
    batchNo: booking.batchNo,
    customerDisplayName: booking.customerDisplayName,
    labSite: booking.labSite,
    slot: booking.slot === null ? null : toPublicSlotBody(booking.slot),
    preferredDropDate: isoDate(booking.preferredDropDate),
    total: { amountPaise: paiseToJson(booking.totalPaise), currency: CURRENCY },
    labDecisionDueAt: isoOrNull(booking.labDecisionDueAt),
    paymentDueAt: isoOrNull(booking.paymentDueAt),
    dropDeadlineAt: isoOrNull(booking.dropDeadlineAt),
    expectedReportDate:
      booking.expectedReportDate === null ? null : isoDate(booking.expectedReportDate),
    createdAt: booking.createdAt.toISOString(),
  };
}

/**
 * The booking reads (I3-SHR-01). Every query runs as the actor's organisation
 * (`TenantScope.run`); what the actor sees within it (own bookings for a requester, assigned
 * sites for a lab member) is decided by `bookingVisibility` in the booking module.
 */
@Injectable()
export class BookingsService {
  constructor(private readonly scope: TenantScope) {}

  async list(actor: CurrentActor, input: BookingListInput): Promise<BookingListBody> {
    // A platform membership is 403 first; then a scope of the other side is 422 with the field
    // named in `errors[]` (ERROR_HANDLING §2). The booking module checks it again.
    const party = bookingVisibility(actor).party;
    if (input.scope !== undefined && input.scope !== party) {
      throw new DomainError('VALIDATION_FAILED', {
        detail: 'Some parameters are not valid.',
        errors: [
          {
            path: 'scope',
            code: 'INVALID_VALUE',
            message: `The active membership acts as ${party}.`,
          },
        ],
      });
    }
    const result = await this.scope.run(actor, (tx) => listBookings(tx, actor, input));
    return { data: result.data.map(toBookingSummaryBody), page: result.page };
  }
}
