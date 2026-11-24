// The routes the Nest app really registers, read from the Express router (not listed by hand),
// and their mapping to contract operations.
import type { INestApplication } from '@nestjs/common';
import { type Contract, type ContractOperation, routeSkeleton } from './document.js';

export interface RegisteredRoute {
  /** Upper case; `ALL` for `@All()` handlers. */
  method: string;
  /** As registered, Express syntax: `/v1/bookings/:id`. */
  path: string;
}

interface ExpressLayer {
  route?: { path: string | string[]; methods: Record<string, boolean | undefined> };
  handle?: { stack?: ExpressLayer[] };
  /** Mount path of a `use()` layer (Express 5 router). */
  rawPath?: string;
  name?: string;
}

function joinPaths(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

/**
 * Nest's not-found fallback (`ExpressAdapter.setNotFoundHandler`): a router mounted at the
 * global prefix with `all('*path')`. It is framework plumbing, not an endpoint.
 */
function isNotFoundFallback(path: string, method: string): boolean {
  return method === '_all' && /^\/?(\*\w*|\{\*\w+\})$/.test(path);
}

function collect(stack: ExpressLayer[], prefix: string, routes: RegisteredRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const path of paths) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (!enabled || isNotFoundFallback(path, method)) continue;
          routes.push({
            method: method === '_all' ? 'ALL' : method.toUpperCase(),
            path: joinPaths(prefix, path),
          });
        }
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      if (layer.rawPath === undefined) {
        throw new Error(`Cannot read the mount path of router ${layer.name ?? '(anonymous)'}`);
      }
      collect(layer.handle.stack, joinPaths(prefix, layer.rawPath), routes);
    }
  }
}

export function registeredRoutes(app: INestApplication): RegisteredRoute[] {
  const adapter = app.getHttpAdapter();
  if (adapter.getType() !== 'express') {
    throw new Error(
      `registeredRoutes() reads the Express router; this app uses ${adapter.getType()}`,
    );
  }
  const instance: unknown = adapter.getInstance();
  const stack = (instance as { router?: { stack?: ExpressLayer[] } } | undefined)?.router?.stack;
  if (!Array.isArray(stack)) {
    throw new Error('Cannot read the Express router stack (Express 5 `app.router.stack`)');
  }
  const routes: RegisteredRoute[] = [];
  collect(stack, '', routes);
  return routes;
}

export interface RouteMapping {
  implemented: ContractOperation[];
  /** Registered routes with no contract operation. */
  undocumented: RegisteredRoute[];
}

export function mapRoutesToContract(
  routes: readonly RegisteredRoute[],
  contract: Contract,
): RouteMapping {
  const byKey = new Map(contract.operations.map((op) => [op.routeKey, op]));
  const implemented = new Map<string, ContractOperation>();
  const undocumented: RegisteredRoute[] = [];
  for (const route of routes) {
    const op = byKey.get(`${route.method} ${routeSkeleton(route.path)}`);
    if (op) implemented.set(op.operationId, op);
    else undocumented.push(route);
  }
  return { implemented: [...implemented.values()], undocumented };
}
