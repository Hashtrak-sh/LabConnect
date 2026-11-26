import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { LeadService } from '@labconnect/core';
import { parseLeadCreate } from './leads.dto.js';

/**
 * `POST /v1/public/leads` (`createLead`, FR-DIS-07, AC-DIS-04, I1-CUS-07). No authentication:
 * anyone can ask for a lab. `Idempotency-Key` is accepted and not yet enforced (OQ-87: no
 * idempotency store is wired); a repeated lead is harmless. The public rate limit is not
 * enforced yet (OQ-194, I1-CUS-09). Nothing about the lead is returned (204).
 */
@Controller('public/leads')
export class LeadsController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Post()
  @HttpCode(204)
  async createLead(@Body() body: unknown): Promise<void> {
    await this.leads.createLead(parseLeadCreate(body));
  }
}
