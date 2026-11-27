// The permission-matrix generator (P3-05): for every implemented route that declares permissions
// and every role of the shared permission map, call the route as a user holding exactly that
// role and compare the answer with what `packages/shared/src/permissions.ts` says. The
// expectation never comes from the route: a route that declares the wrong permission, or a guard
// that lets an extra role through, shows up as a difference.
//
// Allowed roles must get past authorisation: anything other than 401 or 403 (the handler's own
// validation or not-found answers are fine, so a minimal request is enough: guards run before body
// validation, which `matrix.fixtures.spec.ts` verifies). Every other role must get 403 FORBIDDEN.
// No token must get 401 UNAUTHENTICATED.
import { type PermissionCode, ROLE_CODES, type RoleCode, grantOf } from '@labconnect/shared';
import type { PermissionRequirement } from '../../../src/modules/identity/permission.guard.js';
import {
  HANDLER_REFUSALS,
  type HandlerRefusal,
  SESSION_ONLY_REFUSALS,
  type SessionOnlyRefusal,
} from '../../permissions/handler-refusals.js';
import type { Client } from '../isolation/world.js';
import type { RouteDeclaration } from './route-declarations.js';

/** The roles the shared permission map allows through a route's declared requirement. */
export function rolesAllowedBy(requirement: PermissionRequirement): RoleCode[] {
  if (requirement.mode === 'NONE') return [...ROLE_CODES];
  const holds = (role: RoleCode, code: PermissionCode): boolean =>
    grantOf(role, code) !== undefined;
  return ROLE_CODES.filter((role) =>
    requirement.mode === 'ALL'
      ? requirement.codes.every((code) => holds(role, code))
      : requirement.codes.some((code) => holds(role, code)),
  );
}

export interface MatrixCell {
  route: RouteDeclaration;
  role: RoleCode;
  expected: 'allow' | 'deny';
}

/** Routes the matrix covers: the ones that declare a permission requirement. */
export const isMatrixRoute = (route: RouteDeclaration): boolean =>
  route.category === 'authorised-all' ||
  route.category === 'authorised-any' ||
  route.category === 'authorised-none';

/**
 * Every role against every route. A role the permission map lets through only as a conditional
 * grant that the handler refuses is expected to be denied (`handler-refusals.ts`).
 */
export function matrixCells(
  routes: readonly RouteDeclaration[],
  refusals: readonly HandlerRefusal[] = HANDLER_REFUSALS,
  sessionRefusals: readonly SessionOnlyRefusal[] = SESSION_ONLY_REFUSALS,
): MatrixCell[] {
  return routes.filter(isMatrixRoute).flatMap((route) => {
    const allowed = route.requirement ? rolesAllowedBy(route.requirement) : [];
    return ROLE_CODES.map((role) => ({
      route,
      role,
      expected:
        allowed.includes(role) &&
        !refusals.some((entry) => entry.route === route.key && entry.role === role) &&
        !sessionRefusals.some((entry) => entry.route === route.key && entry.roles.includes(role))
          ? ('allow' as const)
          : ('deny' as const),
    }));
  });
}

export interface Finding {
  route: string;
  role: RoleCode | 'NO TOKEN';
  expected: string;
  actual: string;
}

const PLACEHOLDER_ID = '00000000-0000-7000-8000-000000000000';

export const pathFor = (route: RouteDeclaration): string =>
  route.path.replace(/:[A-Za-z0-9_]+/g, PLACEHOLDER_ID);

const methodOf = (route: RouteDeclaration): 'get' | 'post' | 'put' | 'patch' | 'delete' => {
  const method = route.method.toLowerCase();
  if (method === 'all') return 'get';
  return method as 'get' | 'post' | 'put' | 'patch' | 'delete';
};

const bodyFor = (route: RouteDeclaration): { body?: unknown } =>
  ['GET', 'DELETE', 'HEAD'].includes(route.method) ? {} : { body: {} };

export interface MatrixRun {
  /** Role × route cells checked, plus the no-token calls. */
  cells: number;
  findings: Finding[];
}

/**
 * Runs the matrix. Role by role, so each role signs in once and its step-up is fresh while its
 * routes are called. `clientOf` returns a signed-in client for a user holding exactly that role.
 */
export async function runMatrix(input: {
  routes: readonly RouteDeclaration[];
  clientOf: (role: RoleCode) => Client;
  /** Also call each route without a token. Default true. */
  noToken?: boolean;
}): Promise<MatrixRun> {
  const cells = matrixCells(input.routes);
  const findings: Finding[] = [];
  let count = 0;
  for (const role of ROLE_CODES) {
    const client = input.clientOf(role);
    for (const cell of cells.filter((c) => c.role === role)) {
      count += 1;
      const response = await client.call(
        methodOf(cell.route),
        pathFor(cell.route),
        bodyFor(cell.route),
      );
      const code = (response.body as { code?: string } | undefined)?.code;
      const actual = `${String(response.status)}${code === undefined ? '' : ` ${code}`}`;
      if (cell.expected === 'allow') {
        if (response.status === 401 || response.status === 403) {
          findings.push({
            route: cell.route.key,
            role,
            expected: 'past authorisation (not 401/403)',
            actual,
          });
        }
      } else if (response.status !== 403 || code !== 'FORBIDDEN') {
        findings.push({ route: cell.route.key, role, expected: '403 FORBIDDEN', actual });
      }
    }
  }
  if (input.noToken !== false) {
    const anyClient = input.clientOf(ROLE_CODES[0]);
    for (const route of input.routes.filter(isMatrixRoute)) {
      count += 1;
      const response = await anyClient.call(methodOf(route), pathFor(route), {
        ...bodyFor(route),
        token: null,
      });
      const code = (response.body as { code?: string } | undefined)?.code;
      if (response.status !== 401 || code !== 'UNAUTHENTICATED') {
        findings.push({
          route: route.key,
          role: 'NO TOKEN',
          expected: '401 UNAUTHENTICATED',
          actual: `${String(response.status)}${code === undefined ? '' : ` ${code}`}`,
        });
      }
    }
  }
  return { cells: count, findings };
}

export const formatFindings = (findings: readonly Finding[]): string[] =>
  findings.map((f) => `${f.route} as ${f.role}: expected ${f.expected}, got ${f.actual}`);
