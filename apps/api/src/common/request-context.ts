import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** What later code (audit, logging) may need to know about the request it is serving. */
export interface RequestContext {
  readonly requestId: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Contract: `X-Request-Id` has `maxLength: 128` (parameters.yaml). */
export const REQUEST_ID_MAX_LENGTH = 128;

// Token characters only. Anything else (spaces, commas from repeated headers, control
// characters) is replaced, so a caller cannot inject into headers or log lines.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:-]+$/;

const storage = new AsyncLocalStorage<RequestContext>();

/** The context of the request being served, or `undefined` outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` with `context` as the current request context. Used by the middleware and tests. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function isValidRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= REQUEST_ID_MAX_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  );
}

/** Echoes a valid caller `X-Request-Id`, otherwise generates a UUID. Never rejects. */
export function resolveRequestId(callerValue: unknown): string {
  return isValidRequestId(callerValue) ? callerValue : randomUUID();
}

/**
 * Express middleware, registered before routing so that 404s and body-parse errors are covered.
 * Sets `X-Request-Id` on the response and opens the request context.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  const context: RequestContext = {
    requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
  storage.run(context, next);
}
