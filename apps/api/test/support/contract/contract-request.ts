// The supertest wrapper every HTTP-level API test uses (task P2-08):
//
//   const response = await contractRequest(app).get('/v1/health');
//
// It finds the contract operation for the request, checks the request before sending it, sends
// it, checks the response, records the operation as exercised and returns the supertest
// response. Any violation fails the test with the operation, the JSON pointer and the reason.
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import { type Contract, describeOperation, loadContract } from './document.js';
import { recordExercised } from './exercised.js';
import {
  type ExchangeResponse,
  formatViolations,
  operationHeading,
  validateProblem,
  validateRequest,
  validateResponse,
} from './validate.js';

export class ContractViolationError extends Error {
  override name = 'ContractViolationError';
}

export interface ContractRequestOptions {
  headers?: Record<string, string>;
  /** JSON request body. */
  body?: string | object;
  /**
   * Skips the request check, for tests that send invalid input on purpose. Give the reason:
   * `{ invalidRequest: 'missing Idempotency-Key must give 422' }`. The response is still checked.
   */
  invalidRequest?: string;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ContractRequester = Record<
  Method,
  (path: string, options?: ContractRequestOptions) => Promise<Response>
>;

/** The supertest response as the validator sees it. */
export function toExchangeResponse(response: Response): ExchangeResponse {
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    text: response.text,
  };
}

function send(
  app: INestApplication<Server>,
  method: Method,
  path: string,
  options: ContractRequestOptions,
): Promise<Response> {
  let test = request(app.getHttpServer())[method](path);
  for (const [name, value] of Object.entries(options.headers ?? {})) test = test.set(name, value);
  if (options.body !== undefined) test = test.send(options.body);
  return test.then((response) => response);
}

function requester(
  handler: (method: Method, path: string, options: ContractRequestOptions) => Promise<Response>,
): ContractRequester {
  return {
    get: (path, options = {}) => handler('get', path, options),
    post: (path, options = {}) => handler('post', path, options),
    put: (path, options = {}) => handler('put', path, options),
    patch: (path, options = {}) => handler('patch', path, options),
    delete: (path, options = {}) => handler('delete', path, options),
  };
}

function routeOf(path: string): string {
  return new URL(path, 'http://contract.test').pathname;
}

/** Calls a documented operation and holds both sides of the exchange to the contract. */
export function contractRequest(
  app: INestApplication<Server>,
  contract: Contract = loadContract(),
): ContractRequester {
  return requester(async (method, path, options) => {
    const matched = contract.match(method, routeOf(path));
    if (!matched) {
      throw new ContractViolationError(
        `No contract operation matches ${method.toUpperCase()} ${routeOf(path)}. ` +
          'Add it to the contract first (contract-first, COLLABORATION_GUIDE.md §2), or use ' +
          'undocumentedRequest() for a test that calls an undocumented route on purpose.',
      );
    }
    const { operation, pathParameters } = matched;
    if (options.invalidRequest !== undefined && options.invalidRequest.trim() === '') {
      throw new ContractViolationError('invalidRequest needs a reason');
    }
    if (options.invalidRequest === undefined) {
      const violations = validateRequest(contract, operation, pathParameters, {
        method,
        path,
        headers: options.headers,
        body: options.body,
      });
      if (violations.length > 0) {
        throw new ContractViolationError(
          formatViolations(
            operationHeading(operation, 'request'),
            violations,
            'If the test sends invalid input on purpose, pass { invalidRequest: "<why>" }.',
          ),
        );
      }
    }
    const response = await send(app, method, path, options);
    const violations = validateResponse(contract, operation, toExchangeResponse(response));
    if (violations.length > 0) {
      throw new ContractViolationError(
        formatViolations(operationHeading(operation, 'response', response.status), violations),
      );
    }
    recordExercised(operation.operationId);
    return response;
  });
}

/**
 * Calls a route that is not in the contract on purpose (an unknown path, a path outside the
 * server prefix). Fails if the route is documented after all; does not check the response, so
 * pair it with expectProblemResponse() where the shared error shape applies.
 */
export function undocumentedRequest(
  app: INestApplication<Server>,
  contract: Contract = loadContract(),
): ContractRequester {
  return requester(async (method, path, options) => {
    const matched = contract.match(method, routeOf(path));
    if (matched) {
      throw new ContractViolationError(
        `${method.toUpperCase()} ${routeOf(path)} is documented as ` +
          `${describeOperation(matched.operation)}; use contractRequest().`,
      );
    }
    return send(app, method, path, options);
  });
}

/** Fails unless the response is the shared problem shape with a code from the catalogue. */
export function expectProblemResponse(
  response: Response,
  contract: Contract = loadContract(),
): void {
  const violations = validateProblem(contract, toExchangeResponse(response));
  if (violations.length > 0) {
    throw new ContractViolationError(
      formatViolations(
        `Error response ${String(response.status)} is not the shared problem shape:`,
        violations,
      ),
    );
  }
}
