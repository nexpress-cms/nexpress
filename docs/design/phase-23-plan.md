# Phase 23 plan — publish, harden, polish

**Opened:** 2026-05-02
**Status:** in progress (23.7.1 done — Redis reference adapter shipped; 23.6.2 still pending; 23.8 still blocked on CI billing)
**Parent roadmap:** [`../roadmap.md`](../roadmap.md), categories 1 + 2 + 4

This file is a planning snapshot. It freezes the sub-phase sequence and the
dependency graph so we don't drift mid-flight. Update *only* the status line
above and the per-sub-phase status as PRs land. Don't rewrite the plan
mid-phase — open a Phase 24 plan instead.

## Goal

Take what the v0.1 surface promises and put it under real production
weight: ship the packages, fix the operational gaps real deployers will
hit first, and tighten the on-ramp so the next contributor's first hour
isn't spent guessing.

## Sub-phase sequence

Order is chosen to bank small wins early, weave a DX item between the
ops-hardening items so momentum doesn't fade, and end with the heaviest
piece (rate-limit adapter) so its interface decisions can absorb
everything we've learned by then.

| #    | Title                                 | Category  | Size   | Status   |
| ---- | ------------------------------------- | --------- | ------ | -------- |
| 23.1 | Backup & restore docs                 | 2 (ops)   | S      | done     |
| 23.2 | LocalStorage production boot warning  | 2 (ops)   | XS     | done     |
| 23.3 | Plugin author quickstart              | 4 (DX)    | S      | done     |
| 23.4 | Multi-instance token revocation verify| 2 (ops)   | S      | done     |
| 23.5 | Stuck-job detector + admin surface    | 2 (ops)   | M      | done     |
| 23.6 | E2E coverage on golden paths          | 4 (DX)    | M      | partial  |
| 23.6.1 | Bugs surfaced by E2E (blocks loop + seo strip + auth helper) | 4 (DX) | S | done |
| 23.6.2 | E2E publish flow + theme switch (re-attempt)| 4 (DX) | S | pending |
| 23.7 | Multi-node rate-limit adapter         | 2 (ops)   | L      | done     |
| 23.7.1 | `@nexpress/rate-limiter-redis` reference adapter | 2 (ops) | M | done |
| 23.8 | First publish run (when CI unblocks)  | 1 (ship)  | S      | blocked  |

Sizes are rough: XS ≈ 1h, S ≈ half day, M ≈ 1–2 days, L ≈ several days.

## Dependencies

```
23.1 ──► 23.2 ──► 23.3 ──► 23.4 ──► 23.5 ──► 23.6 ──► 23.7
                                                       │
                                          (CI billing) ▼
                                                      23.8
```

23.1–23.7 are sequential because each is small enough to merge before
the next opens, and a serial cadence keeps the changeset queue legible.
Parallelizing buys little; the bottleneck is review, not authoring.

23.8 is gated on the GitHub Actions billing unlock that's tracked in
the roadmap "Open questions" section. When billing clears, 23.8 runs
the first `pnpm release` against whatever's queued — it doesn't wait
for 23.7 to finish.

## What's deliberately *not* in Phase 23

- **Plugin v2** (roadmap category 3) — research project, 1.x.
- **Stability promotion** (category 6) — defer; roadmap says "pick
  one in 23." We're picking *zero* this round so 23 finishes on time.
  Move it to Phase 24.
- **Marketplace MVP** (category 8) — depends on category 4 momentum.
  Re-evaluate after 23.6 lands.
- **Shop plugin** (category 9) — locked to 1.x.
- **Multi-tenant features** (category 7) — out of scope.

## Per-sub-phase notes

Brief sketches so each sub-phase doesn't need its own design doc.

### 23.1 — Backup & restore docs

Single live guide under `docs/`. Sections: pg_dump recipe with the
NexPress-specific tables to keep an eye on (`nx_users`, `nx_c_*`,
`nx_revisions`, `nx_settings`, `nx_audit_events`), media bucket sync
for both local and S3 adapters, restore order (DB → media → workers),
post-restore verification checklist, planned-maintenance vs incident
recovery split. Cross-link from `operations.md`.

No code change. Add the file to `docs/README.md` live-guides table.

### 23.2 — LocalStorage production boot warning

Add a branch to `verifyStartupSafety` that fires when
`NX_STORAGE_ADAPTER` resolves to `local` and an explicit production
hint is set (`NODE_ENV=production` plus a multi-replica indicator —
either `NX_REPLICAS>1` or any of the well-known
`{KUBERNETES_SERVICE_HOST,FLY_REGION,RENDER_INSTANCE_ID}` env vars).
Routed through the structured logger, severity `warn`, with a doc
link to `docs/deployment.md` "Multi-node notes."

Test it in `apps/web` integration suite by stubbing the env.

### 23.3 — Plugin author quickstart

`docs/plugin-quickstart.md`: scaffold a plugin from
`packages/plugins/reading-time` template, register a hook, ship.
End-to-end: `pnpm create plugin foo` → edit `definePlugin` → wire
into `nexpress.config.ts` → restart → see effect.

May need a small `pnpm create plugin` scaffold script if missing;
if so, that ships in the same PR.

### 23.4 — Multi-instance token revocation verify

`tokenVersion` already lives on `nx_users` and `verifyTokenFull`
already reads it per request. This sub-phase confirms that under
multi-instance load — write an integration test that bumps
`tokenVersion` on instance A and asserts instance B's next
`verifyTokenFull` call rejects the stale token. Document the bump
procedure in `docs/operations.md` (forced sign-out for compromised
account).

### 23.5 — Stuck-job detector + admin surface

pg-boss has `expired` and `failed` states already. Add a
`/admin/jobs` widget showing counts per terminal state with a
threshold-based warning (configurable via `nexpress.config.ts`).
Plus a job log query helper in `@nexpress/core/jobs` so plugin
authors can build their own monitoring on top.

**Status update (2026-05-03):** the count + threshold + widget
piece shipped. The job-log query helper was deferred to a
follow-up — `listJobLogs`/`countJobLogs` already exist on the
`@nexpress/core/jobs` subpath (Phase 19), so the build-your-own-
monitoring path is unblocked; what's still missing is a curated
"recent failures" helper that joins counts with their last log
entries. Tracked under category 5 (API completeness).

### 23.6 — E2E coverage on golden paths

Playwright suite in `apps/web/tests/e2e/`. Covers: sign in, publish
a post, install a built-in plugin (via config edit), switch theme,
sign out. Wire to the CI integration job that already runs against
Postgres.

Stretch: cover a pgsql-backed search query through the `/search`
page to lock in the search UX behavior.

**Status update (2026-05-03):** Playwright is wired
(`apps/web/playwright.config.ts`, `tests/e2e/`, `pnpm test:e2e`),
the global setup seeds an idempotent e2e admin
(`E2E_ADMIN` fixture), the auth golden path is covered by
`auth.spec.ts` (sign in via form, lands on `/admin`, dropdown
exposes the logout entry, direct POST to `/api/auth/logout`
clears the session, `/admin` then 302s back to login, plus a
negative-path "wrong password stays on login" assertion), and
the CI workflow has a dedicated `e2e` job using the Postgres
service container with `PLAYWRIGHT_USE_BUILD=1` so Playwright
runs against `next start` (production-shaped output). Browsers
land via `playwright install --with-deps chromium`.

The publish-a-post / theme-switch / install-plugin specs are
deferred to **23.6.1** to keep the infra PR digestible. Same
Playwright wiring; the open work is just the additional `.spec.ts`
files and any selector resilience the publish/theme flows need.

### 23.6.1 — Bugs surfaced by attempting E2E (done)

Writing the publish/theme spec from 23.6 immediately tripped two
production-relevant bugs in the admin's create-page render plus
exposed a sign-in form behavior the spec couldn't drive past.

**Shipped:**

- **`BlockPageEditor` infinite-update loop** — the "RESET on
  `initialBlocks` change" effect compared by reference, but the
  parent's `toBlockInstances` returns a fresh array on every
  render. Combined with the `onChange(blocks)` effect, that
  produced a `Maximum update depth exceeded` storm whenever a page
  was opened with empty blocks. Fix: dispatch RESET only when the
  *serialized* blocks change (`JSON.stringify` key) so reference
  churn doesn't re-fire the effect.
- **`toClientCollectionConfig` leaks `seo.urlPath`** — the helper
  stripped `access`, `hooks`, and field functions but left the
  `seo` block untouched. Pages and posts both define
  `seo.urlPath` as a function, so the admin create form 500'd on
  RSC serialization (`Functions cannot be passed directly to
  Client Components`). Fix: walk the `seo` block and drop any
  function-valued slot.
- **Sign-in helper** — extracted `signInAsE2EAdmin(page)` to
  `tests/e2e/fixtures/auth-helpers.ts` so 23.6.2's specs share a
  single, durable login flow. `auth.spec.ts` consumes it too.

**Not shipped (deferred to 23.6.2):**

The publish-page spec drove the form to the point of clicking
Publish, but the click never produced a `POST /api/auth/login`
or a `POST /api/collections/pages` in the dev server log — the
form's submit handler appears to short-circuit when run under
the Playwright browser context. The two production bugs above
are merged in isolation while the form-submission diagnosis
moves to 23.6.2.

### 23.6.2 — E2E publish flow + theme switch (re-attempt)

Pick up where 23.6.1 stalled.

Pre-requisite: diagnose why `<button type="submit">` clicks in
the admin login + create-page forms don't reach the server when
driven by Playwright. Suspects:
- React 19 form action / dev-mode boundary swallowing the submit.
- Hydration race — the click lands before the form's
  `onSubmit` handler is wired (the Playwright trace shows the
  click "succeeded" but no fetch fires).
- A reset-fixture timing issue — the e2e admin's `tokenVersion`
  is bumped between `globalSetup` and the first request, so the
  POSTed credentials sign a JWT that's already stale. (Less
  likely; the auth.spec happy path passes consistently.)

Once that's understood, the specs are the same as the original
23.6 plan:

- `publish.spec.ts` — sign in, `/admin/collections/pages/create`,
  fill title + seoDescription, Publish, assert public render at
  `/<slug>`.
- `theme.spec.ts` — sign in, `/admin/settings`, click an
  inactive theme's Activate button, assert the card flips to
  "In use" (admin round-trip). Public-site CSS verification
  is a stretch.
- `install-plugin.spec.ts` *(if cheap)* — read-only assertion
  that the bundled plugin set surfaces in `/admin/plugins`.

Open question: per-test fresh sign-in vs Playwright
`storageState` shared session. Default to fresh until the suite
is big enough to feel the cost.

### 23.7 — Multi-node rate-limit adapter (done)

Define `NxRateLimiterAdapter` interface in `@nexpress/core` with
`InMemoryRateLimiter` (current behavior) as the default and
`RedisRateLimiter` as the reference multi-node implementation.
`apps/web/src/proxy.ts` reads the configured adapter via
`ensureFor("read")` plumbing. Issue #269 closes when this lands.

Open question to settle inside the PR: do we ship the Redis
adapter from `@nexpress/core` or as a separate
`@nexpress/rate-limiter-redis` package? Default to "separate
package" — keeps `@nexpress/core` Redis-free.

**Status update (2026-05-03):** the contract + the in-memory
default + the proxy migration shipped (`@nexpress/core/rate-limit`
subpath). The `proxy.ts` is no longer aware of the storage —
`getRateLimiter().check(key, limit, windowMs)` is the only call.
Behavior is identical on single-node deploys; multi-node deploys
register a different adapter at boot. Open question settled:
**separate package** so `@nexpress/core` stays Redis-free.

### 23.7.1 — `@nexpress/rate-limiter-redis` reference adapter (done)

**Shipped:**

- New `packages/rate-limiter-redis/` workspace package
  (`@nexpress/rate-limiter-redis`) with `RedisRateLimiter`
  implementing `NxRateLimiterAdapter`.
- A single Lua script per check — `INCR` + `PTTL` + conditional
  `PEXPIRE` — for atomicity (no race between increment and TTL
  arm) and one round trip per request.
- Three constructor shapes: connection-string `url`, raw
  `RedisOptions`, or a caller-supplied ioredis client (shared
  ownership; `shutdown()` is a no-op in that mode).
- Configurable `keyPrefix` (default `nx:rl:`) so two deploys can
  share a Redis without colliding.
- 7 unit tests (RESP shape parsing, key prefixing, TTL fallback,
  shutdown semantics) running against a `vi.fn()`-stubbed
  client; live-Redis integration test deferred — see follow-ups
  below.
- Package README + `docs/deployment.md` updated with the install +
  wire snippet.

**Deferred for 23.7.2 if/when needed:**

- Live-Redis integration test (docker-compose Redis service,
  similar to the Postgres pattern). The unit suite covers the
  adapter surface; live coverage is mainly to pin the Lua
  semantics across Redis versions.
- Sliding-window / token-bucket variants. v0.1's contract is
  fixed-window, mirroring `InMemoryRateLimiter`.

### 23.8 — First publish run

When `.github/workflows/ci.yml` and `release.yml` regain push/PR
triggers, queue any open changesets, merge the version-packages PR,
and watch `pnpm release` run end-to-end with provenance attestation.

No code change inside Phase 23 — this is the trigger event. Capture
install-time friction notes from the first external user reports
into a Phase 24 input list.
