import { Inject, Injectable } from '@nestjs/common';
import type { components } from '@labconnect/api-contract';
import {
  type BookingEngine,
  type Clock,
  ConfigParameters,
  type CurrentActor,
  type CustomerActor,
  type EditBookingInput,
  editBooking,
  estimateBooking,
  findDuplicateBookings,
  getBookingDetail,
  labWorkingHours,
  type PricedBooking,
  type SubmissionDeps,
  type SubmitBookingInput,
  submitBooking,
  TenantScope,
  TimerService,
} from '@labconnect/core';
import { CURRENCY, paiseToJson, type RoleCode } from '@labconnect/shared';
import { DomainError } from '../../common/domain-error.js';
import { CLOCK } from '../platform/platform.providers.js';
import { BOOKING_ENGINE } from './booking-engine.token.js';
import { type BookingViewBody, toBookingViewBody } from './booking-view.js';
import { BookingsService } from './bookings.service.js';

type Schemas = components['schemas'];
export type BookingEstimateBody = Schemas['BookingEstimate'];
export type BookingDuplicateCheckBody = Schemas['BookingDuplicateCheck'];

/** The customer roles that book, widest first (the engine narrows edits to owner or admin). */
const BOOKING_ROLES: readonly RoleCode[] = ['CUSTOMER_ADMIN', 'CUSTOMER_REQUESTER'];
/** Roles that see every booking of the organisation (duplicate matches). */
const WIDE_ROLES: readonly RoleCode[] = ['CUSTOMER_ADMIN', 'CUSTOMER_FINANCE'];

const money = (paise: bigint): Schemas['Money'] => ({
  amountPaise: paiseToJson(paise),
  currency: CURRENCY,
});

function toEstimateBody(priced: PricedBooking): BookingEstimateBody {
  return {
    labSiteId: priced.labSiteId,
    priceList: {
      versionNo: priced.priceList.versionNo,
      effectiveFrom: priced.priceList.effectiveFrom.toISOString(),
    },
    lines: priced.lines.map((line) => ({
      scopeLineId: line.scopeLineId,
      snapshot: line.snapshot,
      unitPrice: money(line.unitPricePaise),
      samplePrep: money(line.samplePrepPaise),
      gstRateBp: line.gstRateBp,
      gst: money(line.gstPaise),
      lineTotal: money(line.lineTotalPaise),
    })),
    subtotal: money(priced.subtotalPaise),
    gst: money(priced.gstPaise),
    platformFee: money(0n),
    total: money(priced.totalPaise),
  };
}

/**
 * Submitting and editing bookings (I3-CUS-01): `estimateBooking`, `checkBookingDuplicates`,
 * `createBooking` (T-01) and `updateBooking` (T-02). Every write runs in the customer's tenant
 * transaction; the organisation is the active membership's, never the request's.
 */
@Injectable()
export class SubmissionService {
  private readonly workingHours;

  constructor(
    private readonly scope: TenantScope,
    private readonly bookings: BookingsService,
    private readonly config: ConfigParameters,
    private readonly timers: TimerService,
    @Inject(BOOKING_ENGINE) private readonly engine: BookingEngine,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.workingHours = labWorkingHours(clock);
  }

  private deps(): SubmissionDeps {
    return {
      engine: this.engine,
      config: this.config,
      timers: this.timers,
      workingHours: this.workingHours,
      now: this.clock.now(),
    };
  }

  /** A customer membership (any role): estimate and duplicate check. Otherwise 403. */
  assertCustomer(actor: CurrentActor): string {
    if (actor.orgType !== 'CUSTOMER' || actor.orgId === null) {
      throw new DomainError('FORBIDDEN', {
        detail: 'Bookings are made by a member of a customer organisation.',
      });
    }
    return actor.orgId;
  }

  /**
   * Who books: a `CUSTOMER_ADMIN` or `CUSTOMER_REQUESTER` of the active customer organisation.
   * Ops booking on behalf of a customer (`onBehalfOf`) is not built yet: 403 (decided
   * 2026-11-29). Checked before the body is read.
   */
  bookerOf(actor: CurrentActor): CustomerActor {
    const role = BOOKING_ROLES.find((code) => actor.roles.includes(code));
    if (actor.orgType !== 'CUSTOMER' || actor.orgId === null || role === undefined) {
      throw new DomainError('FORBIDDEN', {
        detail: 'A Customer Admin or Requester of the organisation books.',
      });
    }
    return {
      kind: 'USER',
      userId: actor.userId,
      role,
      orgId: actor.orgId,
      ...(actor.membershipId !== null && { membershipId: actor.membershipId }),
    };
  }

  async estimate(
    actor: CurrentActor,
    input: { labSiteId: string; scopeLineIds: string[]; slotId?: string },
  ): Promise<BookingEstimateBody> {
    this.assertCustomer(actor);
    const now = this.clock.now();
    const priced = await this.scope.run(actor, (tx) => estimateBooking(tx, now, input));
    return toEstimateBody(priced);
  }

  async duplicates(
    actor: CurrentActor,
    input: { itemName: string; batchNo: string; scopeLineIds: string[] },
  ): Promise<BookingDuplicateCheckBody> {
    const orgId = this.assertCustomer(actor);
    const wide = actor.roles.some((role) => WIDE_ROLES.includes(role));
    const result = await this.scope.run(actor, (tx) =>
      findDuplicateBookings(tx, this.deps(), { orgId, userId: actor.userId, wide }, input),
    );
    return {
      duplicateFound: result.matches.length > 0,
      windowDays: result.windowDays,
      matches: result.matches
        .filter((match) => match.visible)
        .map((match) => ({
          id: match.id,
          bookingNo: match.bookingNo,
          status: match.status as Schemas['BookingStatus'],
          createdAt: match.createdAt.toISOString(),
          labSiteName: match.labSiteName,
        })),
    };
  }

  /** `createBooking` (T-01): the customer's view of the new booking, and its version. */
  async create(
    actor: CurrentActor,
    input: SubmitBookingInput,
  ): Promise<{ body: BookingViewBody; lockVersion: number }> {
    const booker = this.bookerOf(actor);
    const read = await this.scope.run(actor, async (tx) => {
      const id = await submitBooking(tx, this.deps(), booker, input);
      return this.bookings.readView(tx, actor, id);
    });
    return this.answer(read);
  }

  /**
   * `updateBooking` (T-02). Read in the caller's scope first: out of scope is 404, a requester's
   * colleague's booking 403; the engine then checks the state (409) and `If-Match` (412).
   */
  async update(
    actor: CurrentActor,
    bookingId: string,
    ifMatch: number,
    input: EditBookingInput,
  ): Promise<{ body: BookingViewBody; lockVersion: number }> {
    const booker = this.bookerOf(actor);
    const read = await this.scope.run(actor, async (tx) => {
      await getBookingDetail(tx, actor, bookingId);
      await editBooking(tx, this.deps(), booker, bookingId, ifMatch, input);
      return this.bookings.readView(tx, actor, bookingId);
    });
    return this.answer(read);
  }

  private answer(read: Awaited<ReturnType<BookingsService['readView']>>) {
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
