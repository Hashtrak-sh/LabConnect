// The declaration coverage rules of P3-05. They fail the build when a route is served without
// saying who may call it. Pure functions over `RouteDeclaration[]`, so the same code checks the
// real app and, in the tests of the rules themselves, fixture modules with deliberate mistakes.
//
//   A. every route is on the reviewed allow-list of public routes, or carries `AuthGuard`;
//   B. every route with `MembershipGuard` declares a permission (or `noPermissionRequired`), and
//      the guards that enforce the declaration are present and in order;
//   C. every `/admin` route declares the permission whose platform holders are exactly the
//      contract's `x-roles` for that operation, except the differences recorded in OQ-112;
//   D. every route the contract marks as needing step-up declares `stepUp`.
import { type PermissionCode, ROLE_CODES, ROLES, type RoleCode, grantOf } from '@labconnect/shared';
import { AuthGuard } from '../../../src/modules/identity/auth.guard.js';
import { MembershipGuard } from '../../../src/modules/identity/membership.guard.js';
import { MfaGuard } from '../../../src/modules/identity/mfa.guard.js';
import { PermissionGuard } from '../../../src/modules/identity/permission.guard.js';
import type { Contract, ContractOperation } from '../contract/document.js';
import { routeSkeleton } from '../contract/document.js';
import type { RouteDeclaration } from './route-declarations.js';

export interface PublicRoute {
  /** `METHOD /v1/path`, Express syntax. */
  route: string;
  /** Why anyone may call it. Reviewed with the entry. */
  reason: string;
}

/** What the contract says about the operation a route implements. */
export interface ContractInfo {
  operationId: string;
  /** `bearer`: the default; `none`: `security: []`; `other`: a different scheme (cookie, signature). */
  security: 'bearer' | 'none' | 'other';
  /** The operation answers `401 STEP_UP_REQUIRED` (the contract's marker of a step-up action). */
  stepUp: boolean;
  /** `x-roles` of an `/admin` operation. */
  xRoles: readonly RoleCode[] | undefined;
  /** `METHOD /admin/path/{id}` as the contract writes it (the key of the known-differences list). */
  operationKey: string;
}

export type ContractInfoOf = (route: RouteDeclaration) => ContractInfo | undefined;

export type Rule = 'A' | 'B' | 'C' | 'D' | 'S';

export interface Violation {
  rule: Rule;
  route: string;
  message: string;
}

export interface RuleOptions {
  publicRoutes: readonly PublicRoute[];
  contractInfoOf: ContractInfoOf;
  /** `METHOD /admin/path/{id}` keys that differ from `x-roles` today (OQ-112). */
  knownAdminDifferences: readonly string[];
  /** Also fail an allow-list entry or known difference that names nothing served (real app only). */
  checkStale?: boolean;
}

/** The platform roles that satisfy a requirement: what the shared permission map gives them. */
export function platformRolesSatisfying(
  mode: 'ALL' | 'ANY',
  codes: readonly PermissionCode[],
): RoleCode[] {
  return ROLE_CODES.filter((role) => {
    if (ROLES[role].orgType !== 'PLATFORM') return false;
    const holds = (code: PermissionCode): boolean => grantOf(role, code) !== undefined;
    return mode === 'ALL' ? codes.every(holds) : codes.some(holds);
  });
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

const ORDER = [AuthGuard, MembershipGuard, PermissionGuard, MfaGuard].map((guard) => guard.name);

function guardOrderProblem(guards: readonly string[]): string | undefined {
  const positions = ORDER.map((name) => guards.indexOf(name)).filter((index) => index >= 0);
  const sorted = [...positions].sort((a, b) => a - b);
  return positions.every((value, index) => value === sorted[index])
    ? undefined
    : `guards run in the order ${guards.join(' -> ')}, expected ${ORDER.join(' -> ')}`;
}

export function checkDeclarations(
  routes: readonly RouteDeclaration[],
  options: RuleOptions,
): Violation[] {
  const violations: Violation[] = [];
  const add = (rule: Rule, route: RouteDeclaration | string, message: string): void => {
    violations.push({ rule, route: typeof route === 'string' ? route : route.key, message });
  };
  const allowed = new Map(options.publicRoutes.map((entry) => [entry.route, entry]));

  for (const route of routes) {
    const info = options.contractInfoOf(route);
    const has = (guard: string): boolean => route.guards.includes(guard);

    // A. public routes are listed; everything else carries AuthGuard (category says which).
    if (route.category === 'public') {
      if (!allowed.has(route.key)) {
        add(
          'A',
          route,
          'has no AuthGuard and is not in the public-route allow-list. Protect it with ' +
            '@Authorised(...) or @UseGuards(AuthGuard), or add it to test/permissions/public-routes.ts ' +
            'with the reason it is public.',
        );
      } else if (info?.security === 'bearer') {
        add(
          'A',
          route,
          `is public, but the contract (${info.operationId}) requires a bearer token. ` +
            'Contract and implementation disagree: fix the guard or the contract first.',
        );
      }
    } else if (allowed.has(route.key)) {
      add('A', route, 'is in the public-route allow-list but carries AuthGuard. Remove the entry.');
    }

    // B. a membership-level route declares who may call it, and the guards that enforce it exist.
    if (route.category === 'undeclared') {
      add(
        'B',
        route,
        'uses MembershipGuard but declares no permission (PermissionGuard would refuse every ' +
          'request). Add @Authorised({ permission | anyPermission | noPermissionRequired }).',
      );
    }
    if (route.requirement !== undefined) {
      if (!has(AuthGuard.name) || !has(MembershipGuard.name) || !has(PermissionGuard.name)) {
        add(
          'B',
          route,
          'declares a permission requirement but is missing AuthGuard, MembershipGuard or ' +
            `PermissionGuard (guards: ${route.guards.join(', ') || 'none'}), so nothing enforces it. ` +
            'Use @Authorised(...).',
        );
      }
    } else if (has(MembershipGuard.name) && !has(PermissionGuard.name)) {
      add('B', route, 'uses MembershipGuard without PermissionGuard.');
    }
    if (has(MembershipGuard.name) && !has(AuthGuard.name)) {
      add('B', route, 'uses MembershipGuard without AuthGuard.');
    }
    const order = guardOrderProblem(route.guards);
    if (order !== undefined) add('B', route, order);

    // D. step-up: both directions, and the guard that enforces it.
    if (info?.stepUp === true && route.stepUp === undefined) {
      add(
        'D',
        route,
        `implements ${info.operationId}, which the contract marks as needing step-up ` +
          '(401 STEP_UP_REQUIRED), but declares no stepUp. Add stepUp: true to @Authorised(...).',
      );
    }
    if (route.stepUp !== undefined) {
      if (!has(MfaGuard.name)) {
        add('D', route, 'declares stepUp but MfaGuard is missing, so nothing enforces it.');
      }
      if (info !== undefined && !info.stepUp) {
        add(
          'D',
          route,
          `declares stepUp but the contract (${info.operationId}) does not document ` +
            '401 STEP_UP_REQUIRED. Contract first: document it, or remove stepUp.',
        );
      }
    }

    // C. /admin routes against x-roles.
    if (info?.xRoles !== undefined) {
      const known = options.knownAdminDifferences.includes(info.operationKey);
      const mode =
        route.requirement?.mode === 'ALL' || route.requirement?.mode === 'ANY'
          ? route.requirement.mode
          : undefined;
      if (mode === undefined || route.requirement === undefined) {
        if (!known) {
          add(
            'C',
            route,
            `implements ${info.operationKey} (x-roles ${info.xRoles.join(', ')}) but declares ` +
              'no permission. Platform operations need @Authorised({ permission | anyPermission }).',
          );
        }
      } else {
        const holders = platformRolesSatisfying(mode, route.requirement.codes);
        const agrees = sameSet(holders, info.xRoles);
        if (!agrees && !known) {
          add(
            'C',
            route,
            `declares ${route.requirement.codes.join(' + ')}, held by platform roles ` +
              `[${holders.join(', ')}], but x-roles of ${info.operationKey} is ` +
              `[${info.xRoles.join(', ')}]. Settle the difference (OQ-112) or add it to ` +
              'test/permissions/known-admin-differences.ts with the reason.',
          );
        }
        if (agrees && known) {
          add(
            'C',
            route,
            `${info.operationKey} is listed as a known difference (OQ-112) but now agrees with ` +
              'x-roles. Remove it from test/permissions/known-admin-differences.ts.',
          );
        }
      }
    }
  }

  if (options.checkStale === true) {
    const served = new Set(routes.map((route) => route.key));
    for (const entry of options.publicRoutes) {
      if (!served.has(entry.route)) {
        add(
          'A',
          entry.route,
          'is in the public-route allow-list but the app does not serve it. Remove the entry.',
        );
      }
    }
  }
  return violations;
}

/** A readable list for a failing assertion. */
export function formatViolations(violations: readonly Violation[]): string[] {
  return violations.map((v) => `[${v.rule}] ${v.route} ${v.message}`);
}

// ---------------------------------------------------------------------------------- contract

function effectiveSecurity(
  contract: Contract,
  operation: ContractOperation,
): ContractInfo['security'] {
  const document = contract.document as unknown as { security?: Record<string, unknown>[] };
  const declared =
    (operation.operation as unknown as { security?: Record<string, unknown>[] }).security ??
    document.security ??
    [];
  if (declared.length === 0) return 'none';
  return declared.some((requirement) => 'bearerAuth' in requirement) ? 'bearer' : 'other';
}

function documentsStepUp(contract: Contract, operation: ContractOperation): boolean {
  const response = operation.operation.responses?.['401'];
  if (response === undefined) return false;
  // The marker is the operation's own text for its 401 (a `description` beside the `$ref`, as
  // packages/api-contract/test/admin.test.ts reads it); the shared response's text is generic.
  const own = (response as { description?: string }).description;
  const text =
    own ??
    contract.follow(response, [...operation.pointer, 'responses', '401']).value.description ??
    '';
  return /`STEP_UP_REQUIRED`/.test(text);
}

export function contractInfoOfOperation(
  contract: Contract,
  operation: ContractOperation,
): ContractInfo {
  const roles = (operation.operation as unknown as { 'x-roles'?: RoleCode[] })['x-roles'];
  return {
    operationId: operation.operationId,
    security: effectiveSecurity(contract, operation),
    stepUp: documentsStepUp(contract, operation),
    xRoles: roles,
    operationKey: `${operation.method} ${operation.pathTemplate}`,
  };
}

/** Looks a served route up in the contract by method and path shape. */
export function contractInfoFrom(contract: Contract): ContractInfoOf {
  const byKey = new Map(contract.operations.map((op) => [op.routeKey, op]));
  return (route) => {
    const operation = byKey.get(`${route.method} ${routeSkeleton(route.path)}`);
    return operation === undefined ? undefined : contractInfoOfOperation(contract, operation);
  };
}
