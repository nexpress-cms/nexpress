import { AsyncLocalStorage } from "node:async_hooks";

import { npIsCanonicalSiteId } from "./id-contract.js";

/**
 * Process-level fallback used by runtime adapters such as Next.js. Request,
 * worker, CLI, and test execution scopes should use `withCurrentSite()`;
 * scoped values take precedence over this resolver.
 */
type Resolver = () => string | null | Promise<string | null>;

const siteContext = new AsyncLocalStorage<string>();
let resolver: Resolver | null = null;

function requireCanonicalSiteId(value: unknown, source: string): string {
  if (!npIsCanonicalSiteId(value)) {
    throw new Error(`${source} must be a canonical lowercase site id beginning with a letter.`);
  }
  return value;
}

export function setCurrentSiteResolver(fn: Resolver | null): void {
  if (fn !== null && typeof fn !== "function") {
    throw new Error("Current site resolver must be a function or null.");
  }
  resolver = fn;
}

/** Reset only the process-level fallback; active async scopes remain intact. */
export function resetCurrentSiteResolver(): void {
  resolver = null;
}

export async function getCurrentSiteId(): Promise<string | null> {
  const scopedSiteId = siteContext.getStore();
  if (scopedSiteId !== undefined) return scopedSiteId;
  if (!resolver) return null;

  const resolved = await resolver();
  return resolved === null
    ? null
    : requireCanonicalSiteId(resolved, "Current site resolver result");
}

/**
 * Resolve the current site or fail when the caller omitted an execution
 * scope. Writes use this instead of silently falling through to the default
 * site because a missing scope is a server wiring error.
 */
export async function requireSiteId(): Promise<string> {
  const id = await getCurrentSiteId();
  if (!id) {
    const { NpSiteContextMissingError } = await import("../errors.js");
    throw new NpSiteContextMissingError(
      "site context required for this write but none is set — " +
        "wrap the call in withCurrentSite() or stamp siteId on the job payload",
    );
  }
  return id;
}

/**
 * Run work inside an async-local site scope.
 *
 * Nested and concurrent calls are isolated, and async resources created in
 * the callback retain this site even when they settle after the callback has
 * returned. Persisted background jobs still need to carry `siteId` because a
 * later worker dispatch is a separate async execution graph.
 */
export async function withCurrentSite<T>(siteId: string, fn: () => T | Promise<T>): Promise<T> {
  const canonicalSiteId = requireCanonicalSiteId(siteId, "Site context id");
  if (typeof fn !== "function") {
    throw new Error("Site context callback must be a function.");
  }
  return await siteContext.run(canonicalSiteId, fn);
}
