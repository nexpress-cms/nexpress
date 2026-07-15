import {
  NpCustomRouteContractError,
  npGetCustomRouteKind,
  npRequireCustomRouteDefinitions,
  npRequireCustomRouteSource,
} from "./contract.js";
import type {
  NpCustomRoute,
  NpCustomRouteContractIssue,
  NpCustomRouteDefinition,
} from "./types.js";

const routesBySource = new Map<string, readonly NpCustomRoute[]>();

/**
 * Atomically replaces every route owned by `source`.
 *
 * Re-running this function is HMR-safe: routes removed from the new catalog
 * disappear instead of surviving as stale process-global entries. A path may
 * have only one source; collisions fail without changing the previous catalog.
 */
export function npRegisterCustomRoutes(
  sourceValue: unknown,
  definitionsValue: unknown,
): readonly NpCustomRoute[] {
  const source = npRequireCustomRouteSource(sourceValue);
  const definitions = npRequireCustomRouteDefinitions(definitionsValue);
  const collisions: NpCustomRouteContractIssue[] = [];
  const otherOwners = new Map<string, string>();
  for (const [registeredSource, routes] of routesBySource) {
    if (registeredSource === source) continue;
    for (const route of routes) otherOwners.set(route.path, registeredSource);
  }
  for (const [index, definition] of definitions.entries()) {
    const owner = otherOwners.get(definition.path);
    if (owner) {
      collisions.push({
        code: "source-collision",
        path: `customRoutes.${index.toString()}.path`,
        message: `custom route path "${definition.path}" is already owned by source "${owner}".`,
      });
    }
  }
  if (collisions.length > 0) {
    const first = collisions[0];
    throw new NpCustomRouteContractError(
      `Custom route source collision: ${first?.path ?? "customRoutes"}: ${first?.message ?? "duplicate path"}`,
      collisions,
    );
  }

  const routes = Object.freeze(
    definitions.map((definition: NpCustomRouteDefinition) =>
      Object.freeze({
        ...definition,
        kind: npGetCustomRouteKind(definition.path),
        source,
      }),
    ),
  );
  routesBySource.set(source, routes);
  return routes;
}

/** Deterministic, immutable snapshot for Admin/API consumers. */
export function npGetCustomRoutes(): readonly NpCustomRoute[] {
  const routes = [...routesBySource.values()].flat();
  routes.sort(
    (left, right) =>
      compareCanonicalText(left.path, right.path) ||
      compareCanonicalText(left.source, right.source),
  );
  return Object.freeze(routes);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Removes one source's complete catalog. Unknown sources are an idempotent no-op. */
export function npUnregisterCustomRoutes(sourceValue: unknown): void {
  routesBySource.delete(npRequireCustomRouteSource(sourceValue));
}

/** Internal test isolation helper; intentionally not exported from the public subpath. */
export function resetCustomRoutesForTests(): void {
  routesBySource.clear();
}
