/**
 * Integration tests don't go through `proxy.ts` (Next's middleware) —
 * `buildRequest()` constructs `NextRequest` objects in-memory and the
 * route handlers receive them directly. The bootstrap-installed
 * resolver reads `headers()` / `cookies()` from Next's request-scope
 * AsyncLocalStorage which isn't populated for these synthetic
 * requests, so it returns `null` and writes that newly call
 * `requireSiteId()` (#272) trip `NxSiteContextMissing`.
 *
 * Pin the resolver to the default site for every test. Multi-site
 * tests still override per-block via `withCurrentSite()` — that
 * helper swaps and restores the resolver, so the override lives only
 * inside the block.
 *
 * Eagerly run `ensureCoreServices()` so bootstrap's idempotent
 * `collectionsRegistered` flag flips to true *before* we install the
 * default-site resolver. Without this, the first route handler call
 * in each worker would race the bootstrap and stomp our resolver
 * with the production header-reading one.
 *
 * `beforeEach` is a belt-and-braces guard for tests that explicitly
 * reset the resolver (e.g. via `resetCurrentSiteResolver()`).
 */
import { beforeEach } from "vitest";

import { ensureCoreServices } from "@/lib/init-core";
import { NX_DEFAULT_SITE_ID, setCurrentSiteResolver } from "@nexpress/core";

await ensureCoreServices();
setCurrentSiteResolver(() => NX_DEFAULT_SITE_ID);

beforeEach(() => {
  setCurrentSiteResolver(() => NX_DEFAULT_SITE_ID);
});
