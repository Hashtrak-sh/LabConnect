import type { components } from '@labconnect/api-contract';
import type {
  BookingDetail,
  BookingSlotView,
  BookingHoldCaseView,
  BookingRatingView,
  LabSiteContactView,
} from '@labconnect/core';
import { CURRENCY, paiseToJson } from '@labconnect/shared';

// The `BookingView` of `getBooking`, one shape per party (`BookingForCustomer`, `BookingForLab`).
// What one party must not see is absent from its shape, not merely empty: the lab view never gets
// the requester, the customer site, the platform flag or the lab contact.

type Schemas = components['schemas'];
export type BookingViewBody = Schemas['BookingView'];
type BookingCommonBody = Schemas['BookingCommon'];

const money = (paise: bigint): Schemas['Money'] => ({
  amountPaise: paiseToJson(paise),
  currency: CURRENCY,
});
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());
const dateOrNull = (date: Date | null): string | null => (date === null ? null : isoDate(date));

export function toPublicSlotBody(slot: BookingSlotView): Schemas['PublicSlot'] {
  return {
    id: slot.id,
    date: isoDate(slot.date),
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    discipline: slot.discipline,
  };
}

function ratingBody(rating: BookingRatingView | null): Schemas['BookingRating'] | null {
  if (rating === null) return null;
  return {
    direction: rating.direction,
    scoreOverall: rating.scoreOverall,
    scoreTat: rating.scoreTat,
    scoreCommunication: rating.scoreCommunication,
    comment: rating.comment,
    isPublic: rating.isPublic,
    createdAt: rating.createdAt.toISOString(),
  };
}

function holdCaseBody(hold: BookingHoldCaseView | null): Schemas['BookingHoldCase'] | null {
  if (hold === null) return null;
  return {
    id: hold.id,
    status: hold.status,
    reason: hold.reason,
    details: hold.details,
    dueAt: hold.dueAt.toISOString(),
    decision: hold.decision,
    decidedAt: isoOrNull(hold.decidedAt),
    escalatedAt: isoOrNull(hold.escalatedAt),
  };
}

function commonBody(detail: BookingDetail, hold: BookingHoldCaseView | null): BookingCommonBody {
  const b = detail.common;
  return {
    id: b.id,
    bookingNo: b.bookingNo,
    status: b.status,
    statusChangedAt: b.statusChangedAt.toISOString(),
    customerDisplayName: b.customerDisplayName,
    labSite: b.labSite,
    labSnapshot: b.labSnapshot as BookingCommonBody['labSnapshot'],
    itemName: b.itemName,
    batchNo: b.batchNo,
    slot: b.slot === null ? null : toPublicSlotBody(b.slot),
    preferredDropDate: isoDate(b.preferredDropDate),
    declaredPackageCount: b.declaredPackageCount,
    lines: b.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      scopeLineId: line.scopeLineId,
      snapshot: line.snapshot,
      unitPrice: money(line.unitPricePaise),
      samplePrep: money(line.samplePrepPaise),
      gstRateBp: line.gstRateBp,
      gst: money(line.gstPaise),
      lineTotal: money(line.lineTotalPaise),
      requiredSampleQty: line.requiredSampleQty,
      status: line.status,
      cancelledReason: line.cancelledReason,
    })),
    trf: { ...b.trf, submittedAt: b.trf.submittedAt.toISOString() },
    // Attachments come with `createBookingAttachmentUploadUrl`, which is not built yet.
    attachments: [],
    subtotal: money(b.subtotalPaise),
    gst: money(b.gstPaise),
    platformFee: money(b.platformFeePaise),
    total: money(b.totalPaise),
    labDecisionDueAt: isoOrNull(b.labDecisionDueAt),
    paymentDueAt: isoOrNull(b.paymentDueAt),
    dropDeadlineAt: isoOrNull(b.dropDeadlineAt),
    expectedReportDate: dateOrNull(b.expectedReportDate),
    reportReleasedAt: isoOrNull(b.reportReleasedAt),
    disputeWindowEndsAt: isoOrNull(b.disputeWindowEndsAt),
    retainUntil: dateOrNull(b.retainUntil),
    completedAt: isoOrNull(b.completedAt),
    deviationNoted: b.deviationNoted,
    deviationNotes: b.deviationNotes,
    counterOffer:
      b.counterOffer === null
        ? null
        : {
            id: b.counterOffer.id,
            status: b.counterOffer.status,
            proposedSlot:
              b.counterOffer.proposedSlot === null
                ? null
                : toPublicSlotBody(b.counterOffer.proposedSlot),
            perLineQuantity: b.counterOffer.perLineQuantity,
            message: b.counterOffer.message,
            expiresAt: b.counterOffer.expiresAt.toISOString(),
            createdAt: b.counterOffer.createdAt.toISOString(),
            respondedAt: isoOrNull(b.counterOffer.respondedAt),
          },
    holdCase: holdCaseBody(hold),
    cancellation: b.cancellation,
    rejection: b.rejection,
    frozen: b.frozen === null ? null : { ...b.frozen, frozenAt: b.frozen.frozenAt.toISOString() },
    statusHistory: b.statusHistory.map((change) => ({
      transitionId: change.transitionId as Schemas['BookingTransitionId'],
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      occurredAt: change.occurredAt.toISOString(),
      actorParty: change.actorParty,
      reason: change.reason,
    })),
    createdAt: b.createdAt.toISOString(),
    lockVersion: b.lockVersion,
  };
}

/** The view for the caller's party, with what other modules add. */
export function toBookingViewBody(
  detail: BookingDetail,
  extra: {
    holdCase: BookingHoldCaseView | null;
    ownRating: BookingRatingView | null;
    labContact: LabSiteContactView | null;
  },
): BookingViewBody {
  const common = commonBody(detail, extra.holdCase);
  if (detail.customer !== null) {
    return {
      ...common,
      viewerParty: 'CUSTOMER',
      requester: detail.customer.requester,
      customerSite: detail.customer.customerSite,
      placedByPlatform: detail.customer.placedByPlatform,
      labContact: extra.labContact,
      ownRating: ratingBody(extra.ownRating),
    };
  }
  return { ...common, viewerParty: 'LAB', ownRating: ratingBody(extra.ownRating) };
}
