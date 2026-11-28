import { Inject, Injectable } from '@nestjs/common';
import type { components } from '@labconnect/api-contract';
import {
  type BookingEngine,
  type BookingListInput,
  BookingError,
  type CounterOfferInput,
  rejectionReasonNodeId,
  type RequestMeta,
  bookingRating,
  type BookingSummaryView,
  bookingVisibility,
  type CurrentActor,
  getBookingDetail,
  getLabInbox,
  type LabInboxInput,
  type LabInboxItemView,
  labSitePublicContact,
  latestBookingHoldCase,
  listBookings,
  TenantScope,
} from '@labconnect/core';
import { type BookingViewBody, toBookingViewBody, toPublicSlotBody } from './booking-view.js';
import type { Prisma } from '@labconnect/database';
import { CURRENCY, paiseToJson } from '@labconnect/shared';
import { DomainError } from '../../common/domain-error.js';
import { BOOKING_ENGINE } from './booking-engine.token.js';

type Schemas = components['schemas'];
export type BookingListBody = Schemas['BookingList'];
type BookingSummaryBody = Schemas['BookingSummary'];
export type LabInboxListBody = Schemas['LabInboxList'];
type LabInboxItemBody = Schemas['LabInboxItem'];

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());

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

export function toLabInboxItemBody(item: LabInboxItemView): LabInboxItemBody {
  const { booking } = item;
  return {
    booking: {
      id: booking.id,
      bookingNo: booking.bookingNo,
      status: booking.status,
      statusChangedAt: booking.statusChangedAt.toISOString(),
      labSite: booking.labSite,
      customerDisplayName: booking.customerDisplayName,
      itemName: booking.itemName,
      batchNo: booking.batchNo,
      lineCount: booking.lineCount,
      declaredPackageCount: booking.declaredPackageCount,
      total: { amountPaise: paiseToJson(booking.totalPaise), currency: CURRENCY },
      slot:
        booking.slot === null
          ? null
          : {
              startsAt: booking.slot.startsAt.toISOString(),
              endsAt: booking.slot.endsAt.toISOString(),
            },
      preferredDropDate: isoDate(booking.preferredDropDate),
      labDecisionDueAt: isoOrNull(booking.labDecisionDueAt),
      paymentDueAt: isoOrNull(booking.paymentDueAt),
      dropDeadlineAt: isoOrNull(booking.dropDeadlineAt),
      expectedReportDate:
        booking.expectedReportDate === null ? null : isoDate(booking.expectedReportDate),
    },
    pendingApproval: item.pendingApproval,
    viewerWasMaker: item.viewerWasMaker,
  };
}

/**
 * The booking reads (I3-SHR-01). Every query runs as the actor's organisation
 * (`TenantScope.run`); what the actor sees within it (own bookings for a requester, assigned
 * sites for a lab member) is decided by `bookingVisibility` in the booking module.
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly scope: TenantScope,
    @Inject(BOOKING_ENGINE) private readonly engine: BookingEngine,
  ) {}

  /** The booking module's view plus the hold case and the own side's rating, in one transaction. */
  private async readView(tx: Prisma.TransactionClient, actor: CurrentActor, bookingId: string) {
    const detail = await getBookingDetail(tx, actor, bookingId);
    const holdCase = await latestBookingHoldCase(tx, bookingId);
    const ownRating = await bookingRating(
      tx,
      bookingId,
      detail.party === 'customer' ? 'CUSTOMER_TO_LAB' : 'LAB_TO_CUSTOMER',
    );
    return { detail, holdCase, ownRating };
  }

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

  /** `getLabInbox`: the caller's assigned sites only, in the tenant transaction. */
  async labInbox(actor: CurrentActor, input: LabInboxInput): Promise<LabInboxListBody> {
    const result = await this.scope.run(actor, (tx) => getLabInbox(tx, actor, input));
    return { data: result.data.map(toLabInboxItemBody), page: result.page };
  }

  /**
   * `getBooking`: the booking module's part, then what custody (hold case) and disputes (the
   * caller's own side's rating) own, in the same tenant transaction. The lab contact is read under
   * a system scope (RLS keeps `lab_site_private` to the lab), and only for the customer of a paid
   * booking, after the tenant read has shown that the caller may see the booking.
   */
  async get(
    actor: CurrentActor,
    bookingId: string,
  ): Promise<{ body: BookingViewBody; lockVersion: number }> {
    const read = await this.scope.run(actor, (tx) => this.readView(tx, actor, bookingId));
    const { detail } = read;
    const labContact =
      detail.party === 'customer' && detail.paid
        ? await this.scope.runAsSystem(
            'booking: lab contact for the customer of a paid booking',
            (tx) => labSitePublicContact(tx, detail.refs.labSiteId),
          )
        : null;
    return {
      body: toBookingViewBody(detail, {
        holdCase: read.holdCase,
        ownRating: read.ownRating,
        labContact,
      }),
      lockVersion: detail.common.lockVersion,
    };
  }

  /**
   * Who decides on a request: a `LAB_CHECKER` of a lab. Checked before the request is read, so a
   * role that holds `booking.decide` only conditionally (`PLATFORM_OPS`) is 403 whatever it sends.
   */
  assertDecider(actor: CurrentActor): void {
    if (actor.orgType !== 'LAB' || !actor.roles.includes('LAB_CHECKER')) {
      throw new DomainError('FORBIDDEN', {
        detail: "Only a Checker of the booking's site decides on a request.",
      });
    }
  }

  /**
   * The lab's decision on a request (I3-LAB-01): T-03 accept, T-04 counter, T-05 reject, through
   * the booking engine. Who: a `LAB_CHECKER` assigned to the booking's site. The route needs
   * `booking.decide`, which `PLATFORM_OPS` holds only to override an undecided request; Ops
   * cannot decide for a lab (OQ-24), so any role but `LAB_CHECKER` is 403 here. The booking is
   * looked up within the actor's organisation and sites first (404 otherwise, like an unknown id);
   * the engine then checks the state (409), `If-Match` (412) and the site of the Checker. The
   * answer is the lab's view of the booking after the decision, from the same transaction.
   */
  async decide(
    actor: CurrentActor,
    command:
      | { transitionId: 'T-03' }
      | { transitionId: 'T-05'; reasonCode: string; notes: string }
      | ({ transitionId: 'T-04' } & CounterOfferInput),
    bookingId: string,
    ifMatch: number,
    meta: RequestMeta,
  ): Promise<{ body: BookingViewBody; lockVersion: number }> {
    this.assertDecider(actor);
    const read = await this.scope.run(actor, async (tx) => {
      // 404 before anything else when the booking is out of the Checker's organisation or sites.
      await getBookingDetail(tx, actor, bookingId);
      let input: Record<string, unknown> = {};
      if (command.transitionId === 'T-05') {
        const nodeId = await rejectionReasonNodeId(tx, command.reasonCode);
        if (nodeId === null) {
          throw new BookingError('VALIDATION_FAILED', {
            detail: 'Some fields are missing or not valid.',
            errors: [
              {
                path: 'reasonCode',
                code: 'INVALID_VALUE',
                message: 'An active rejection reason code.',
              },
            ],
          });
        }
        input = { rejectionReasonNodeId: nodeId, rejectionNotes: command.notes };
      } else if (command.transitionId === 'T-04') {
        input = {
          ...(command.proposedSlotId !== undefined && { proposedSlotId: command.proposedSlotId }),
          ...(command.perLineQuantity !== undefined && {
            perLineQuantity: command.perLineQuantity,
          }),
          message: command.message,
        };
      }
      await this.engine.transition(tx, {
        bookingId,
        transitionId: command.transitionId,
        actor: {
          kind: 'USER',
          userId: actor.userId,
          role: 'LAB_CHECKER',
          ...(actor.membershipId !== null && { membershipId: actor.membershipId }),
          ...(actor.orgId !== null && { orgId: actor.orgId }),
          labSiteIds: actor.siteIds,
        },
        expectedLockVersion: ifMatch,
        input,
        requestContext: {
          ...(meta.requestId !== undefined && { requestId: meta.requestId }),
          ...(meta.ipAddress !== undefined && { ip: meta.ipAddress }),
          ...(meta.userAgent !== undefined && { userAgent: meta.userAgent }),
        },
      });
      return this.readView(tx, actor, bookingId);
    });
    return {
      body: toBookingViewBody(read.detail, {
        holdCase: read.holdCase,
        ownRating: read.ownRating,
        labContact: null,
      }),
      lockVersion: read.detail.common.lockVersion,
    };
  }
}
