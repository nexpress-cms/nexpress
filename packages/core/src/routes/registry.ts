/**
 * Developer-declared custom-route registry. Hand-coded Next.js routes
 * under `apps/web/src/app/(site)/*` are invisible to the framework
 * (the catch-all `[[...slug]]` only knows about CMS pages, plugins
 * declare their own routes via `definePlugin({ routes })`). Operators
 * still need to discover and link to those hand-coded surfaces from
 * the admin — the navigation editor in particular.
 *
 * App code declares each navigable hand-coded route with
 * `registerCustomRoute(...)` at boot. The admin reads the registry
 * via `getCustomRoutes()` to populate a Settings tab and the nav
 * editor's URL autocomplete.
 *
 * Re-registering the same `path` overwrites silently — same HMR-safe
 * convention as the block registry. The registry is process-scoped;
 * sites in a multi-tenant deployment share the same set because all
 * sites share the same code bundle.
 */
export interface NpCustomRoute {
  /**
   * The route's URL path. Must start with `/`. May include dynamic
   * segments for documentation purposes (e.g. `/u/[username]`), but
   * such routes won't appear as nav-link targets — the autocomplete
   * filters them out because a literal href can't be derived.
   */
  path: string;
  /** Short human label for the admin UI. */
  label: string;
  /** Optional one-line description. */
  description?: string;
  /**
   * Optional Lucide icon name (lowercase kebab-case, matching the
   * shared `BlockIcon` resolver). Defaults to `route` if unset.
   */
  icon?: string;
  /** Optional grouping key for the admin list (e.g. "content", "community"). */
  group?: string;
}

const registry = new Map<string, NpCustomRoute>();

export function registerCustomRoute(route: NpCustomRoute): void {
  if (typeof route.path !== "string" || !route.path.startsWith("/")) {
    throw new TypeError(
      `registerCustomRoute: 'path' must start with '/', got ${JSON.stringify(route.path)}`,
    );
  }
  if (typeof route.label !== "string" || route.label.trim().length === 0) {
    throw new TypeError("registerCustomRoute: 'label' must be a non-empty string");
  }
  registry.set(route.path, { ...route });
}

export function getCustomRoutes(): NpCustomRoute[] {
  return Array.from(registry.values());
}

export function clearCustomRoutes(): void {
  registry.clear();
}
