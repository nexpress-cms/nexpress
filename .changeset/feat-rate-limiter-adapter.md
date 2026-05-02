---
"@nexpress/core": minor
---

Adds a pluggable rate-limiter contract so multi-node deploys can
swap in Redis (or any other implementation) without touching the
proxy / middleware (Phase 23.7, closes #269).

New surface at `@nexpress/core/rate-limit` (also re-exported from
the root catch-all):

- `NxRateLimiterAdapter` — single `check(key, limit, windowMs)`
  method returning `{ limited, retryAfterSeconds? }`. Optional
  `shutdown()` for adapters that hold network connections.
- `InMemoryRateLimiter` — the default. Wraps the previous
  in-process `Map<string, RateLimitEntry>` that lived inside
  `apps/web/src/proxy.ts`; same fixed-window behavior, same
  `globalThis`-pinned store + cleanup interval (HMR durability,
  #315).
- `setRateLimiter` / `getRateLimiter` / `getOptionalRateLimiter`
  — singleton registration mirroring `setStorageAdapter` /
  `setJobQueue`. `getRateLimiter()` lazily installs the in-memory
  default when nothing has been wired, so single-node deploys
  remain zero-config.

`apps/web/src/proxy.ts` migrated to call
`getRateLimiter().check(...)` so the proxy is now neutral to
topology. The first-party Redis adapter is intentionally not
included here — it lands as `@nexpress/rate-limiter-redis` in a
follow-up so `@nexpress/core` stays Redis-free.

Bumped to `minor` because the new public symbols (subpath +
adapter contract + registry helpers) are additive surface that
external code can now reach for.
