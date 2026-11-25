import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentActor as Actor } from '@labconnect/core';
import type { Request } from 'express';
import { DomainError } from '../../common/domain-error.js';
import type { AuthenticatedSession } from './identity.service.js';

/** The request as the guards leave it: the session (`AuthGuard`) and the actor (`MembershipGuard`). */
export type RequestWithActor = Request & { authSession?: AuthenticatedSession; actor?: Actor };

/** What the request may act as. The type is the core's `CurrentActor`. */
export type CurrentActor = Actor;

/**
 * The actor of the request, built by `MembershipGuard` from the session and the database. Use only
 * on routes behind it (`@Authorised(...)` applies it). Without the guard it answers
 * `401 UNAUTHENTICATED` rather than guessing.
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    if (!actor) throw new DomainError('UNAUTHENTICATED');
    return actor;
  },
);
