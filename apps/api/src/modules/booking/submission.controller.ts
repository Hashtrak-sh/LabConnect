import { Body, Controller, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { formatEtag, parseIfMatch } from '../../common/etag.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { CurrentActor } from '../identity/current-actor.js';
import type { BookingViewBody } from './booking-view.js';
import { requireBookingId } from './bookings.dto.js';
import {
  parseBookingCreate,
  parseBookingUpdate,
  parseDuplicateCheck,
  parseEstimate,
} from './submission.dto.js';
import {
  type BookingDuplicateCheckBody,
  type BookingEstimateBody,
  SubmissionService,
} from './submission.service.js';

/**
 * Booking submission under `/v1/bookings` (I3-CUS-01, `paths/bookings.yaml`): the estimate and
 * the duplicate warning (any customer role, session-only declaration: the service refuses any
 * other membership with 403), `createBooking` (T-01) and `updateBooking` (T-02), which need
 * `booking.create_edit`. The role is checked before the body is read, so a refused role is 403
 * whatever it sends.
 */
@Controller('bookings')
export class SubmissionController {
  constructor(private readonly submission: SubmissionService) {}

  /** `estimateBooking`: prices the lines, checks the slot, holds nothing. */
  @Post('estimate')
  @HttpCode(200)
  @Authorised({ noPermissionRequired: true })
  @Idempotent()
  async estimateBooking(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingEstimateBody> {
    this.submission.assertCustomer(actor);
    const result = await this.submission.estimate(actor, parseEstimate(body));
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }

  /** `checkBookingDuplicates` (BR-016): a warning only. */
  @Post('duplicate-check')
  @HttpCode(200)
  @Authorised({ noPermissionRequired: true })
  @Idempotent()
  async checkBookingDuplicates(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingDuplicateCheckBody> {
    this.submission.assertCustomer(actor);
    const result = await this.submission.duplicates(actor, parseDuplicateCheck(body));
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }

  /** `createBooking` (T-01): 201 with the customer's view and its `ETag`. */
  @Post()
  @HttpCode(201)
  @Authorised({ permission: 'booking.create_edit' })
  @Idempotent()
  async createBooking(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.submission.bookerOf(actor);
    const result = await this.submission.create(actor, parseBookingCreate(body));
    response.setHeader('ETag', formatEtag(result.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return result.body;
  }

  /** `updateBooking` (T-02): needs `If-Match`; the customer's view after the edit. */
  @Patch(':id')
  @Authorised({ permission: 'booking.create_edit' })
  async updateBooking(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookingViewBody> {
    this.submission.bookerOf(actor);
    const bookingId = requireBookingId(id);
    const version = parseIfMatch(ifMatch);
    const result = await this.submission.update(
      actor,
      bookingId,
      version,
      parseBookingUpdate(body),
    );
    response.setHeader('ETag', formatEtag(result.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return result.body;
  }
}
