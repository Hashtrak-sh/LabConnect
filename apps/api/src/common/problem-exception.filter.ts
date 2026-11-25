import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { ErrorCode } from '@labconnect/shared';
import { DomainError, type ProblemIssue } from './domain-error.js';
import { REQUEST_ID_HEADER, getRequestContext } from './request-context.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** The body of ERROR_HANDLING.md §1. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId: string;
  errors?: readonly ProblemIssue[];
  meta?: Record<string, unknown>;
}

// The catalogue has no generic 400/405/413/415 code. Those transport-level problems use
// VALIDATION_FAILED with their real HTTP status (decision recorded in ERROR_HANDLING.md §3).
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  412: 'CONCURRENT_MODIFICATION',
  429: 'RATE_LIMITED',
};

const DETAIL_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'The request is malformed and could not be parsed.',
  404: 'The requested resource was not found.',
  405: 'The method is not allowed for this resource.',
  413: 'The request body is too large.',
  415: 'The media type is not supported.',
};

function codeForStatus(status: number): ErrorCode {
  if (status >= 500) return 'INTERNAL_ERROR';
  return CODE_BY_STATUS[status] ?? 'VALIDATION_FAILED';
}

// VALIDATION_FAILED is the catalogue's 422. Transport-level 4xx reuse the code, not its wording.
function isTransportProblem(code: ErrorCode, status: number): boolean {
  return code === 'VALIDATION_FAILED' && status !== 422;
}

function titleOf(code: ErrorCode, status: number): string {
  if (isTransportProblem(code, status)) {
    return status === 400 ? 'Bad request' : `Request rejected (${String(status)})`;
  }
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function typeOf(code: ErrorCode, status: number): string {
  if (isTransportProblem(code, status)) {
    return `https://labconnect/errors/${status === 400 ? 'bad-request' : `http-${String(status)}`}`;
  }
  return `https://labconnect/errors/${code.toLowerCase().replaceAll('_', '-')}`;
}

/** The status of an http-errors error from Express or body-parser, if it is a safe client error. */
function transportStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode, expose } = exception as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };
  const value = typeof status === 'number' ? status : statusCode;
  return expose === true && typeof value === 'number' && value >= 400 && value < 500
    ? value
    : undefined;
}

/** Turns any thrown value into the problem body. Never exposes the message or stack of an unknown error. */
export function toProblem(exception: unknown, requestId: string): Problem {
  if (exception instanceof DomainError) {
    const { code, status } = exception;
    return {
      type: typeOf(code, status),
      title: titleOf(code, status),
      status,
      code,
      // The detail of a 5xx is never shown to users (ERROR_HANDLING.md §3).
      ...(exception.detail !== undefined && status < 500 && { detail: exception.detail }),
      requestId,
      ...(exception.errors !== undefined && { errors: exception.errors }),
      ...(exception.meta !== undefined && { meta: exception.meta }),
    };
  }
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : (transportStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR);
  const code = codeForStatus(status);
  const detail = status < 500 ? DETAIL_BY_STATUS[status] : undefined;
  return {
    type: typeOf(code, status),
    title: titleOf(code, status),
    status,
    code,
    ...(detail !== undefined && { detail }),
    requestId,
  };
}

function sendProblem(res: Response, problem: Problem): void {
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
}

/**
 * Express middleware: a path outside `/<prefix>` never reaches Nest's router, so Express would
 * answer with its own HTML 404. This answers it with the 404 problem instead.
 */
export function notFoundOutsidePrefix(prefix: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === `/${prefix}` || req.path.startsWith(`/${prefix}/`)) {
      next();
      return;
    }
    const header = res.getHeader(REQUEST_ID_HEADER);
    sendProblem(res, toProblem(new NotFoundException(), getRequestId(header)));
  };
}

function getRequestId(header: unknown): string {
  return getRequestContext()?.requestId ?? (typeof header === 'string' ? header : 'unknown');
}

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const header = res.getHeader(REQUEST_ID_HEADER);
    const requestId = getRequestId(header);
    if (res.headersSent) {
      res.end();
      return;
    }
    const problem = toProblem(exception, requestId);
    sendProblem(res, problem);
  }
}
