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
 * Like `getCurrentSiteId()` but throws when no site context is set.
 *
 * Use this on write paths that must NEVER silently fall through to
 * the default site — community moderation, ban/mute writes, report
 * creation, notification fan-out. Reading from the default site
 * when context is missing is usually fine; *writing* to it is how
 * cross-site data leaks happen.
 *
 * Background jobs / CLI scripts: stamp the originating `siteId`
 * onto the job payload at enqueue time and wrap the handler in
 * `withCurrentSite(siteId, fn)` so this helper resolves correctly.
 *
 * The error code `SITE_CONTEXT_MISSING` is deliberately distinct
 * from `NxNotFoundError` / `NxValidationError` so handlers can
 * convert it to a 500 (genuinely a server-side wiring bug) rather
 * than a 4xx leaked to the user.
 */
export async function requireSiteId(): Promise<string> {
  const id = await getCurrentSiteId();
  if (!id) {
    const err = new Error(
      "site context required for this write but none is set — " +
        "wrap the call in withCurrentSite() or stamp siteId on the job payload",
    ) as Error & { code: string };
    err.name = "NxSiteContextMissing";
    err.code = "SITE_CONTEXT_MISSING";
    throw err;
  }
  return id;
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
