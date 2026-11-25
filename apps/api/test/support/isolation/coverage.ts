// The isolation coverage rule (P3-05): every tenant-scoped route with an id in its path has a
// registered isolation case, and every registered case is backed by a real test. Pure, so the
// same function checks the real app and, in the tests of the rule itself, a fixture module.
import type { Exemption, IsolationCase } from '../../isolation/registry.js';
import type { RouteDeclaration } from '../permissions/route-declarations.js';

/**
 * A route the rule applies to: it takes an id in its path and is not public (a public route
 * serves reference data to anyone and has no tenant to isolate; a public route that returns
 * tenant data by id needs its own test and is not covered by this rule).
 */
export const needsIsolationCase = (route: RouteDeclaration): boolean =>
  route.pathParameters.length > 0 && route.category !== 'public';

export interface CoverageInput {
  cases: readonly IsolationCase[];
  exemptions: readonly Exemption[];
  /** The text of a spec file (path from `apps/api`), or undefined when it does not exist. */
  readSpec: (path: string) => string | undefined;
}

/** `expectIsolated({ route: '<route>'`, with any whitespace between the tokens. */
export function callsExpectIsolated(spec: string, route: string): boolean {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
  return new RegExp(`expectIsolated\\(\\{\\s*route:\\s*'${escaped}'`).test(spec);
}

export function checkIsolationCoverage(
  routes: readonly RouteDeclaration[],
  input: CoverageInput,
): string[] {
  const problems: string[] = [];
  const served = new Set(routes.map((route) => route.key));
  const registered = new Map(input.cases.map((entry) => [entry.route, entry]));
  const exempt = new Map(input.exemptions.map((entry) => [entry.route, entry]));

  for (const route of routes.filter(needsIsolationCase)) {
    if (registered.has(route.key) || exempt.has(route.key)) continue;
    problems.push(
      `${route.key} is a tenant-scoped route with an id and has no isolation case. Write one ` +
        '(expectIsolated) under test/integration/isolation/ and register it in ' +
        'test/isolation/registry.ts, or add an exemption with the reason.',
    );
  }
  for (const entry of input.cases) {
    if (!served.has(entry.route)) {
      problems.push(
        `${entry.route} is registered but the app does not serve it. Remove the entry.`,
      );
      continue;
    }
    const spec = input.readSpec(entry.spec);
    if (spec === undefined) {
      problems.push(`${entry.route}: the spec ${entry.spec} does not exist.`);
    } else if (!callsExpectIsolated(spec, entry.route)) {
      problems.push(
        `${entry.route}: ${entry.spec} has no expectIsolated({ route: '${entry.route}', ... }) call.`,
      );
    }
  }
  for (const entry of input.exemptions) {
    if (entry.reason.trim().length < 10) problems.push(`${entry.route}: exemption has no reason.`);
    if (!served.has(entry.route)) {
      problems.push(`${entry.route} is exempt but the app does not serve it. Remove the entry.`);
    } else if (registered.has(entry.route)) {
      problems.push(`${entry.route} is both registered and exempt. Keep one.`);
    }
  }
  return problems;
}
