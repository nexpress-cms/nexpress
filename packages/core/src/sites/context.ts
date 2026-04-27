/**
 * Phase 15.1 — process-wide "current site" resolver hook.
 *
 * The pipeline doesn't know how to find the current request's
 * site on its own (the runtime layer does — it reads the
 * `x-nx-site-id` header the middleware sets). This module
 * exposes a setter the runtime calls at boot:
 *
 *   setCurrentSiteResolver(async () => {
 *     const headerList = await headers();
 *     return headerList.get("x-nx-site-id") ?? null;
 *   });
 *
 * Pipeline / hooks call `getCurrentSiteId()` to read the
 * resolved id (or `null` when no resolver is wired, e.g.
 * background workers, scripts).
 *
 * This is intentionally async — the canonical Next.js
 * resolver awaits `headers()`. Sync paths (CLI, tests) can
 * register a sync resolver by returning the value directly.
 */

type Resolver = () => string | null | Promise<string | null>;

let resolver: Resolver | null = null;

export function setCurrentSiteResolver(fn: Resolver | null): void {
  resolver = fn;
}

export function resetCurrentSiteResolver(): void {
  resolver = null;
}

export async function getCurrentSiteId(): Promise<string | null> {
  if (!resolver) return null;
  return resolver();
}

/**
 * Tests / scripts that want to pin the current site id
 * for the duration of a block can use the `withCurrentSite`
 * helper — it swaps in a constant resolver, runs `fn`, and
 * restores the previous resolver on exit.
 */
export async function withCurrentSite<T>(
  siteId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = resolver;
  resolver = () => siteId;
  try {
    return await fn();
  } finally {
    resolver = previous;
  }
}
