import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Authorised } from '../identity/authorised.decorator.js';
import { CurrentActor } from '../identity/current-actor.js';
import { parseLabInboxQuery } from './bookings.dto.js';
import { BookingsService, type LabInboxListBody } from './bookings.service.js';

/**
 * `GET /v1/lab/inbox` (`getLabInbox`, `paths/lab-inbox.yaml`, FR-LAB-01): the bookings of the
 * caller's assigned sites that need the lab, most urgent first. The route needs
 * `lab_inbox.view`; the booking module then lets only a `LAB_MAKER` or `LAB_CHECKER` through, as
 * the contract says (403 for any other membership, including Ops, who have no lab sites).
 */
@Controller('lab/inbox')
export class LabInboxController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @Authorised({ permission: 'lab_inbox.view' })
  async getLabInbox(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LabInboxListBody> {
    const input = parseLabInboxQuery(query);
    const result = await this.bookings.labInbox(actor, input);
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
