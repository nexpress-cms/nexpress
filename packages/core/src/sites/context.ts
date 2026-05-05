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
 * Throws `NpSiteContextMissingError` (code `SITE_CONTEXT_MISSING`,
 * status 500). The 500 is deliberate — this is a server-side
 * wiring bug, not user input fault, and the API layer surfaces
 * it through the standard NpError envelope.
 */
export async function requireSiteId(): Promise<string> {
  const id = await getCurrentSiteId();
  if (!id) {
    // Defer the import to keep this module's load graph thin —
    // `errors.js` doesn't currently reach back into sites/, but
    // the dynamic specifier costs nothing on the happy path
    // (resolver hit) and avoids a future cycle.
    const { NpSiteContextMissingError } = await import("../errors.js");
    throw new NpSiteContextMissingError(
      "site context required for this write but none is set — " +
        "wrap the call in withCurrentSite() or stamp siteId on the job payload",
    );
  }
  return id;
}

/**
 * Tests / scripts that want to pin the current site id for the
 * duration of a block use the `withCurrentSite` helper — it swaps
 * in a constant resolver, runs `fn`, and restores the previous
 * resolver on exit.
 *
 * Contract — read this carefully (#320):
 *
 *   `withCurrentSite` covers ONLY work that completes (synchronously
 *   or via `await`) before `fn` returns. Any fire-and-forget async
 *   work spawned inside `fn` runs AFTER the `finally` block has
 *   already restored the previous resolver, so it sees the OUTER
 *   site context — typically `null` for a CLI / job, or the wrong
 *   site for a request that was acting on a different tenant.
 *
 *   Concretely:
 *     - `enqueueJob(...)` persists the row immediately but the
 *       handler runs later in the worker. The worker has no
 *       resolver wired, so `getCurrentSiteId()` returns `null`
 *       and `requireSiteId()` throws — even though the enqueuer
 *       was inside a `withCurrentSite` block.
 *     - `void someAsyncFn()` patterns inside `fn` are similarly
 *       exposed.
 *
 *   How to do it safely:
 *     - Stamp `siteId` explicitly onto every job payload at
 *       enqueue time. The handler reads it back from the payload
 *       and wraps its own work in `withCurrentSite(payload.siteId,
 *       handlerBody)`.
 *     - `await` everything that needs the site context inside
 *       `fn`. Don't return from `fn` while a site-dependent
 *       operation is still pending.
 *
 *   This is a fundamental limit of plain module-scoped state. A
 *   future refactor could switch the resolver to
 *   `AsyncLocalStorage` so the site follows the async boundary
 *   automatically — that's tracked under #320 but out of scope
 *   for this helper today.
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
