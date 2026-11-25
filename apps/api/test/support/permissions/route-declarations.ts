// What every implemented route requires, read from the guard metadata of the real app (P3-05).
//
// `registeredRoutes()` (contract harness) lists the Express routes the app serves, but an Express
// layer does not know which controller method it belongs to. This reads the Nest side: every
// controller of every module, its handlers, their guards and the declarations the guards read
// (`permissionRequirementOf`, `stepUpOf`, `allowsPartialSession`), then joins the two by
// method + path. A served route with no handler found is reported, never skipped: a route the
// coverage rules cannot see is a route nobody checked.
import 'reflect-metadata';
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { allowsPartialSession, AuthGuard } from '../../../src/modules/identity/auth.guard.js';
import { MembershipGuard } from '../../../src/modules/identity/membership.guard.js';
import { stepUpOf } from '../../../src/modules/identity/mfa.guard.js';
import {
  type PermissionRequirement,
  permissionRequirementOf,
} from '../../../src/modules/identity/permission.guard.js';
import { registeredRoutes, type RegisteredRoute } from '../contract/routes.js';
import { routeSkeleton } from '../contract/document.js';

/** Nest keeps the guards of `@UseGuards()` under this key, on the class and on the method. */
const GUARDS_METADATA = '__guards__';

export type RouteCategory =
  /** No `AuthGuard`: anyone may call it. Must be in the reviewed allow-list. */
  | 'public'
  /** `AuthGuard` only: a signed-in user, no membership questions (`/me`, `/auth/mfa/*`). */
  | 'authenticated'
  /** `MembershipGuard` and a declaration: `permission` (all), `anyPermission` or none required. */
  | 'authorised-all'
  | 'authorised-any'
  | 'authorised-none'
  /** `MembershipGuard` with no declaration: the guard refuses every request (fails closed). */
  | 'undeclared';

export interface RouteDeclaration {
  /** Upper case. */
  method: string;
  /** As served, Express syntax: `/v1/bookings/:id`. */
  path: string;
  /** `METHOD path`, the key used by the allow-lists and the registries. */
  key: string;
  controller: string;
  handler: string;
  category: RouteCategory;
  guards: readonly string[];
  requirement: PermissionRequirement | undefined;
  /** Declared step-up: `maxAgeSeconds` is `undefined` for the default of 5 minutes. */
  stepUp: { maxAgeSeconds: number | undefined } | undefined;
  allowPartialSession: boolean;
  /** Names of the path parameters, in order. */
  pathParameters: string[];
}

export interface DescribeOptions {
  /** The global prefix `configureApp` sets. */
  prefix?: string;
  /** Only controllers whose class name passes. Default: all. */
  controller?: (name: string) => boolean;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === 'string' ? value : ''];
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');
  return `/${joined}`;
}

function guardClass(guard: unknown): Type | undefined {
  if (typeof guard === 'function') return guard as Type;
  if (typeof guard === 'object' && guard !== null) return guard.constructor as Type;
  return undefined;
}

/** The guards in force on a handler: the controller's first, then the method's (Nest order). */
function guardsOf(handler: object, controller: object): Type[] {
  const read = (target: object): unknown[] => {
    const found = Reflect.getMetadata(GUARDS_METADATA, target) as unknown;
    return Array.isArray(found) ? (found as unknown[]) : [];
  };
  return [...read(controller), ...read(handler)]
    .map(guardClass)
    .filter((guard): guard is Type => guard !== undefined);
}

function categoryOf(
  guards: readonly Type[],
  requirement: PermissionRequirement | undefined,
): RouteCategory {
  if (!guards.includes(AuthGuard)) return 'public';
  if (!guards.includes(MembershipGuard)) return 'authenticated';
  switch (requirement?.mode) {
    case 'ALL':
      return 'authorised-all';
    case 'ANY':
      return 'authorised-any';
    case 'NONE':
      return 'authorised-none';
    case undefined:
      return 'undeclared';
  }
}

interface Handler {
  method: string;
  path: string;
  controller: string;
  handler: string;
  guards: Type[];
  requirement: PermissionRequirement | undefined;
  stepUp: { maxAgeSeconds: number | undefined } | undefined;
  allowPartialSession: boolean;
}

function handlersOf(app: INestApplication, prefix: string, accept: (n: string) => boolean) {
  const found: Handler[] = [];
  const modules = app.get(ModulesContainer, { strict: false });
  for (const module of modules.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (typeof controller !== 'function' || !accept(controller.name)) continue;
      const basePaths = asArray(Reflect.getMetadata(PATH_METADATA, controller));
      const seen = new Set<string>();
      for (
        let proto: object | null = controller.prototype as object;
        proto !== null && proto !== Object.prototype;
        proto = Object.getPrototypeOf(proto) as object | null
      ) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor' || seen.has(name)) continue;
          const handler = (proto as Record<string, unknown>)[name];
          if (typeof handler !== 'function') continue;
          const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (verb === undefined) continue;
          seen.add(name);
          const methodName = RequestMethod[verb];
          for (const base of basePaths) {
            for (const own of asArray(Reflect.getMetadata(PATH_METADATA, handler))) {
              found.push({
                method: methodName,
                path: joinPath(prefix, base, own),
                controller: controller.name,
                handler: name,
                guards: guardsOf(handler, controller),
                requirement: permissionRequirementOf(handler, controller),
                stepUp: stepUpOf(handler, controller),
                allowPartialSession: allowsPartialSession(handler, controller),
              });
            }
          }
        }
      }
    }
  }
  return found;
}

/** Providers registered as `APP_GUARD` run on every route and are not modelled here: fail closed. */
function assertNoGlobalGuards(app: INestApplication): void {
  const modules = app.get(ModulesContainer, { strict: false });
  for (const module of modules.values()) {
    for (const wrapper of module.providers.values()) {
      if (String(wrapper.token).startsWith('APP_GUARD')) {
        throw new Error(
          'The app registers a global guard (APP_GUARD). Route introspection reads the guards of ' +
            'each handler and does not model global ones: extend route-declarations.ts first.',
        );
      }
    }
  }
}

/**
 * Every route the app serves, with what it declares. Throws if a served route has no handler
 * (the reader would otherwise silently skip it) or if a route is served twice.
 */
export function describeRoutes(
  app: INestApplication,
  options: DescribeOptions = {},
): RouteDeclaration[] {
  assertNoGlobalGuards(app);
  const prefix = options.prefix ?? 'v1';
  const accept = options.controller ?? (() => true);
  const handlers = handlersOf(app, prefix, accept);
  const byKey = new Map<string, Handler>();
  for (const handler of handlers) {
    byKey.set(`${handler.method} ${routeSkeleton(handler.path)}`, handler);
  }
  const served: RegisteredRoute[] = registeredRoutes(app);
  const routes: RouteDeclaration[] = [];
  const unmatched: string[] = [];
  for (const route of served) {
    const handler = byKey.get(`${route.method} ${routeSkeleton(route.path)}`);
    if (!handler) {
      // A filtered run (`controller`) only wants the matching controllers.
      if (options.controller === undefined) unmatched.push(`${route.method} ${route.path}`);
      continue;
    }
    routes.push({
      method: route.method,
      path: route.path,
      key: `${route.method} ${route.path}`,
      controller: handler.controller,
      handler: handler.handler,
      category: categoryOf(handler.guards, handler.requirement),
      guards: handler.guards.map((guard) => guard.name),
      requirement: handler.requirement,
      stepUp: handler.stepUp,
      allowPartialSession: handler.allowPartialSession,
      pathParameters: [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? ''),
    });
  }
  if (unmatched.length > 0) {
    throw new Error(
      `Served routes with no controller handler found (route introspection cannot see their ` +
        `guards): ${unmatched.join(', ')}`,
    );
  }
  const duplicates = routes.filter(
    (route, index) => routes.findIndex((other) => other.key === route.key) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(`Routes served twice: ${duplicates.map((route) => route.key).join(', ')}`);
  }
  return routes;
}

/**
 * A reader that finds nothing is broken, not satisfied: every rule over zero routes passes
 * vacuously. The real app always serves at least the health route.
 */
export function assertRoutesFound(routes: readonly RouteDeclaration[]): void {
  if (routes.length === 0) {
    throw new Error(
      'Route introspection found no routes at all. The reader is broken (Nest or Express ' +
        'internals changed?) and every coverage rule would pass vacuously.',
    );
  }
}

/** Counts per category, in a fixed order, for the summary line. */
export function summariseRoutes(routes: readonly RouteDeclaration[]): string {
  const order: RouteCategory[] = [
    'public',
    'authenticated',
    'authorised-all',
    'authorised-any',
    'authorised-none',
    'undeclared',
  ];
  const counts = order
    .map(
      (category) => `${category}: ${String(routes.filter((r) => r.category === category).length)}`,
    )
    .join(', ');
  const stepUp = routes.filter((route) => route.stepUp !== undefined).length;
  return `${String(routes.length)} routes (${counts}); step-up declared: ${String(stepUp)}`;
}
