import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { MeView } from '@labconnect/core';
import type { Request } from 'express';
import { parseActiveMembership } from './auth.dto.js';
import { requestMeta } from './auth.controller.js';
import { AuthGuard, CurrentSession } from './auth.guard.js';
import { IdentityErrorInterceptor } from './identity-errors.js';
import { type AuthenticatedSession, IdentityService } from './identity.service.js';

/** `/v1/me`: the current user (API_CONTRACTS.md section 1). Full sessions only. */
@Controller('me')
@UseGuards(AuthGuard)
@UseInterceptors(IdentityErrorInterceptor)
export class MeController {
  constructor(private readonly identity: IdentityService) {}

  /**
   * `X-Active-Membership` only chooses among the user's own active memberships; one that is
   * not theirs is `404 NOT_FOUND`. The organisation always comes from the user's memberships.
   */
  @Get()
  getMe(
    @CurrentSession() session: AuthenticatedSession,
    @Headers('x-active-membership') activeMembership: string | undefined,
  ): Promise<MeView> {
    return this.identity.getMe(session, activeMembership);
  }

  @Post('active-membership')
  @HttpCode(200)
  setActiveMembership(
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
  ): Promise<MeView> {
    const { membershipId } = parseActiveMembership(body);
    return this.identity.setActiveMembership(session, membershipId, requestMeta(request));
  }
}
