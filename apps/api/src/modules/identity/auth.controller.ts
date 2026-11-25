import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdentityError, type RequestMeta, type TotpEnrolment } from '@labconnect/core';
import type { Request, Response } from 'express';
import { DomainError } from '../../common/domain-error.js';
import { getRequestContext } from '../../common/request-context.js';
import { parseMfaCode, parseOtpRequest, parseOtpVerify } from './auth.dto.js';
import { AllowPartialSession, AuthGuard, CurrentSession } from './auth.guard.js';
import { IdentityErrorInterceptor } from './identity-errors.js';
import {
  type AuthenticatedSession,
  IdentityService,
  type MfaChallengeBody,
  type RefreshCookie,
  type SessionBody,
} from './identity.service.js';
import { IdentityRuntime } from './identity.runtime.js';
import {
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
} from './refresh-cookie.js';

/** Where the request came from, for the audit log and the session record. */
export function requestMeta(request: Request): RequestMeta {
  const context = getRequestContext();
  const userAgent = request.headers['user-agent'];
  return {
    ...(context?.requestId !== undefined && { requestId: context.requestId }),
    ...(request.ip !== undefined && { ipAddress: request.ip }),
    ...(userAgent !== undefined && { userAgent }),
  };
}

/** Token responses must never be cached (RFC 6749 section 5.1). */
export function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function withRefresh(response: Response, refresh: RefreshCookie | undefined): void {
  if (refresh) setRefreshCookie(response, refresh.token, refresh.maxAgeSeconds);
}

/** `/v1/auth`: API_CONTRACTS.md section 1. */
@Controller('auth')
@UseInterceptors(IdentityErrorInterceptor)
export class AuthController {
  constructor(
    private readonly identity: IdentityService,
    private readonly runtime: IdentityRuntime,
  ) {}

  /** Always 202, whether or not the address has an account. */
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@Body() body: unknown, @Req() request: Request): Promise<void> {
    await this.identity.requestOtp(parseOtpRequest(body), requestMeta(request));
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody | MfaChallengeBody> {
    const result = await this.identity.verifyOtp(parseOtpVerify(body), requestMeta(request));
    noStore(response);
    withRefresh(response, result.refresh);
    return result.body;
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowPartialSession()
  async verifyMfa(
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody> {
    const result = await this.identity.verifyMfa(session, parseMfaCode(body), requestMeta(request));
    noStore(response);
    withRefresh(response, result.refresh);
    return result.body;
  }

  @Post('mfa/enrol')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  @AllowPartialSession()
  async startMfaEnrolment(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TotpEnrolment> {
    noStore(response);
    return this.identity.startMfaEnrolment(session, requestMeta(request));
  }

  @Post('mfa/enrol/confirm')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AllowPartialSession()
  async confirmMfaEnrolment(
    @Body() body: unknown,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    noStore(response);
    return this.identity.confirmMfaEnrolment(session, parseMfaCode(body), requestMeta(request));
  }

  /**
   * The only route that reads the refresh cookie. SameSite=Lax does not stop every cross-site
   * POST, so the `Origin` header must be one of `AUTH_ALLOWED_ORIGINS` (a browser always
   * sends it on a POST); a missing or foreign origin is `403 FORBIDDEN` before the cookie
   * is looked at.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionBody> {
    const origin = request.headers.origin;
    if (origin === undefined || !this.runtime.allowedOrigins.has(origin.replace(/\/$/, ''))) {
      throw new DomainError('FORBIDDEN', { detail: 'This origin may not refresh a session.' });
    }
    const token = readCookie(request, REFRESH_COOKIE);
    if (token === undefined || token === '') throw new DomainError('UNAUTHENTICATED');
    noStore(response);
    try {
      const result = await this.identity.refresh(token, requestMeta(request));
      withRefresh(response, result.refresh);
      return result.body;
    } catch (error) {
      // A token that is expired, revoked or reused is no use to the browser any more.
      if (error instanceof IdentityError && error.code === 'UNAUTHENTICATED') {
        clearRefreshCookie(response);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @AllowPartialSession()
  async logout(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identity.logout(session, requestMeta(request));
    clearRefreshCookie(response);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logoutAll(
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.identity.logoutAll(session, requestMeta(request));
    clearRefreshCookie(response);
  }
}
