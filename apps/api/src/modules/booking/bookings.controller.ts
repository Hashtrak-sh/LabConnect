import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatEtag, parseIfMatch } from '../../common/etag.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
import { requestMeta } from '../identity/auth.controller.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { CurrentActor } from '../identity/current-actor.js';
import type { BookingViewBody } from './booking-view.js';
import {
  parseBookingCancel,
  parseBookingCounter,
  parseBookingListQuery,
  parseBookingReject,
  requireBookingId,
} from './bookings.dto.js';
import { type BookingListBody, BookingsService } from './bookings.service.js';

/**
 * Booking reads under `/v1/bookings` (API_CONTRACTS.md §4, `paths/bookings.yaml`). Any member of
 * either party may read (session-only declaration): the booking module decides what the active
 * membership sees and refuses a platform membership with 403 (staff use `/admin/bookings`).
 */
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** `listBookings`: newest first, a page at a time. */
  @Get()
  @Authorised({ noPermissionRequired: true })
  async listBookings(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingListBody> {
    const input = parseBookingListQuery(query);
    const result = await this.bookings.list(actor, input);
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }

  /**
   * `getBooking`: the view of the caller's party, with its `ETag`. Out of scope is 404 like an
   * unknown id; a requester reading a colleague's booking is 403.
   */
  @Get(':id')
  @Authorised({ noPermissionRequired: true })
  async getBooking(
    @Param('id') id: string,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    const { body, lockVersion } = await this.bookings.get(actor, requireBookingId(id));
    response.setHeader('ETag', formatEtag(lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return body;
  }

  /** `acceptBooking` (T-03): needs `If-Match`; the lab's view after the decision. */
  @Post(':id/accept')
  @HttpCode(200)
  @Authorised({ permission: 'booking.decide' })
  @Idempotent()
  async acceptBooking(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.bookings.assertDecider(actor);
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    return this.answer(
      response,
      await this.bookings.decide(
        actor,
        { transitionId: 'T-03' },
        bookingId,
        version,
        requestMeta(request),
      ),
    );
  }

  /** `rejectBooking` (T-05): a REJECTION_REASON code and an explanation. */
  @Post(':id/reject')
  @HttpCode(200)
  @Authorised({ permission: 'booking.decide' })
  @Idempotent()
  async rejectBooking(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.bookings.assertDecider(actor);
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    const input = parseBookingReject(body);
    return this.answer(
      response,
      await this.bookings.decide(
        actor,
        { transitionId: 'T-05', ...input },
        bookingId,
        version,
        requestMeta(request),
      ),
    );
  }

  /** `counterBooking` (T-04): another slot and/or more sample, never a price or a method. */
  @Post(':id/counter')
  @HttpCode(200)
  @Authorised({ permission: 'booking.decide' })
  @Idempotent()
  async counterBooking(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.bookings.assertDecider(actor);
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    const input = parseBookingCounter(body);
    return this.answer(
      response,
      await this.bookings.decide(
        actor,
        { transitionId: 'T-04', ...input },
        bookingId,
        version,
        requestMeta(request),
      ),
    );
  }

  /** `acceptBookingCounter` (T-07): the owner or a `CUSTOMER_ADMIN`; needs `If-Match`. */
  @Post(':id/counter/accept')
  @HttpCode(200)
  @Authorised({ permission: 'counter.respond' })
  @Idempotent()
  async acceptBookingCounter(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    return this.answer(
      response,
      await this.bookings.respondToCounter(actor, 'T-07', bookingId, version, requestMeta(request)),
    );
  }

  /** `declineBookingCounter` (T-08): the owner only; needs `If-Match`. */
  @Post(':id/counter/decline')
  @HttpCode(200)
  @Authorised({ permission: 'counter.respond' })
  @Idempotent()
  async declineBookingCounter(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    return this.answer(
      response,
      await this.bookings.respondToCounter(actor, 'T-08', bookingId, version, requestMeta(request)),
    );
  }

  /** `cancelBooking`: T-25 before handover (free); a reason code, optional notes, `If-Match`. */
  @Post(':id/cancel')
  @HttpCode(200)
  @Authorised({ permission: 'booking.cancel' })
  @Idempotent()
  async cancelBooking(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.bookings.assertCanceller(actor);
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    const input = parseBookingCancel(body);
    return this.answer(
      response,
      await this.bookings.cancel(actor, bookingId, version, input, requestMeta(request)),
    );
  }

  private answer(
    response: Response,
    result: { body: BookingViewBody; lockVersion: number },
  ): BookingViewBody {
    response.setHeader('ETag', formatEtag(result.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return result.body;
  }
}
