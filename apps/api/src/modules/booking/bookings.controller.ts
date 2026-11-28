import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Authorised } from '../identity/authorised.decorator.js';
import { CurrentActor } from '../identity/current-actor.js';
import { parseBookingListQuery } from './bookings.dto.js';
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
}
