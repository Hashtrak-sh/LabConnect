// The assertion kit of the tenant-isolation suite (P3-05). A test says who asks (`as`), whose
// resource it is (`resourceOf`) and how to ask; the kit checks the answer the way
// TENANT_ISOLATION.md section 2 rule 5 wants it: 404 (not 403), the shared problem shape, nothing
// of the other tenant in the body, and an answer that does not tell "exists elsewhere" from
// "does not exist".
//
//   await expectIsolated({
//     route: 'GET /v1/bookings/:id',                 // the entry of test/isolation/registry.ts
//     as: clientOf(customerA.user('CUSTOMER_ADMIN')),
//     resourceOf: customerB,
//     resourceId: bookingOfB.id,                     // sent by the caller, so it may be echoed
//     request: (client) => client.get(`/v1/bookings/${bookingOfB.id}`),
//     unknownRequest: (client) => client.get(`/v1/bookings/${randomUUID()}`),
//   });
import { expect } from 'vitest';
import type { Response } from 'supertest';
import { ISOLATION_CASES } from '../../isolation/registry.js';
import type { Client, Tenant } from './world.js';

const problem = (response: Response) =>
  response.body as { code?: string; title?: string; detail?: string; status?: number };

/** The values that identify the tenant, minus those the caller itself put in the request. */
function secretsOf(tenant: Tenant, sent: readonly string[]): string[] {
  const own = new Set(sent.map((value) => value.toLowerCase()));
  return tenant.markers().filter((value) => value.trim() !== '' && !own.has(value.toLowerCase()));
}

/** Fails, naming the value, if any marker of the tenant appears anywhere in the response. */
export function expectNoLeak(
  response: Response,
  tenant: Tenant,
  sent: readonly string[] = [],
): void {
  const haystack = `${JSON.stringify(response.body ?? null)}\n${response.text}`.toLowerCase();
  const leaked = secretsOf(tenant, sent).filter((value) => haystack.includes(value.toLowerCase()));
  expect(leaked, `the response leaks data of ${tenant.label}`).toEqual([]);
}

/** A registered case: the registry is checked in, and only a call like this can satisfy it. */
function assertRegistered(route: string): void {
  expect(
    ISOLATION_CASES.some((entry) => entry.route === route),
    `${route} is not in test/isolation/registry.ts. Register the case there.`,
  ).toBe(true);
}

export interface IsolatedInput {
  /** `METHOD /v1/path/:id`, as in the registry. */
  route: string;
  as: Client;
  resourceOf: Tenant;
  /** Ids the request itself carries; a 404 that echoes them is not a leak. */
  resourceId?: string | readonly string[];
  request: (as: Client) => Promise<Response>;
  /** The same request for an id that exists nowhere: the answers must not differ. */
  unknownRequest?: (as: Client) => Promise<Response>;
}

/**
 * Another tenant's resource, asked for by id: `404 NOT_FOUND` in the problem shape, with no data
 * of that tenant in it, and (when `unknownRequest` is given) the same answer as for an id that
 * does not exist.
 */
export async function expectIsolated(input: IsolatedInput): Promise<Response> {
  assertRegistered(input.route);
  expect(input.as.user.organisationId, 'the caller must belong to another tenant').not.toBe(
    input.resourceOf.organisationId,
  );
  const response = await input.request(input.as);
  expect(response.status, `${input.route} as ${input.as.user.role} of another tenant`).toBe(404);
  expect(problem(response).code).toBe('NOT_FOUND');
  expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
  const sent = [input.resourceId ?? []].flat();
  expectNoLeak(response, input.resourceOf, sent);
  if (input.unknownRequest) {
    const unknown = await input.unknownRequest(input.as);
    expect(unknown.status).toBe(404);
    const [a, b] = [problem(response), problem(unknown)];
    expect({ code: a.code, title: a.title, detail: a.detail, status: a.status }).toEqual({
      code: b.code,
      title: b.title,
      detail: b.detail,
      status: b.status,
    });
  }
  return response;
}

export interface ListInput {
  route?: string;
  as: Client;
  /** The tenant whose rows must not appear. */
  resourceOf: Tenant;
  request: (as: Client) => Promise<Response>;
  /** The ids of the rows in a response body. */
  extract: (body: unknown) => readonly string[];
  /** Rows of the caller's own tenant that must be there (omit for "only: nothing foreign"). */
  expectOwn?: readonly string[];
  /** Ids the request itself carries. */
  sent?: readonly string[];
}

/** A list: 200, none of the other tenant's rows, and (when given) all of the caller's own. */
export async function expectListExcludes(input: ListInput): Promise<readonly string[]> {
  if (input.route !== undefined) assertRegistered(input.route);
  const response = await input.request(input.as);
  expect(response.status, `${input.route ?? 'list'} as ${input.as.user.role}`).toBe(200);
  const ids = input.extract(response.body);
  const foreign = new Set(input.resourceOf.markers().map((value) => value.toLowerCase()));
  expect(
    ids.filter((id) => foreign.has(id.toLowerCase())),
    `the list contains rows of ${input.resourceOf.label}`,
  ).toEqual([]);
  expectNoLeak(response, input.resourceOf, input.sent ?? []);
  if (input.expectOwn !== undefined) {
    expect([...ids].sort()).toEqual([...input.expectOwn].sort());
  }
  return ids;
}

/** Counterpart of `expectIsolated`: the owner reads its own resource. */
export async function expectOwnVisible(input: {
  route?: string;
  as: Client;
  request: (as: Client) => Promise<Response>;
  expectBody?: (body: unknown) => void;
}): Promise<Response> {
  if (input.route !== undefined) assertRegistered(input.route);
  const response = await input.request(input.as);
  expect(response.status, `${input.route ?? 'own'} as its own tenant`).toBe(200);
  input.expectBody?.(response.body);
  return response;
}
