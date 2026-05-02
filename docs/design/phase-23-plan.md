# Phase 23 plan — publish, harden, polish

**Opened:** 2026-05-02
**Status:** in progress (23.6 partial — auth golden path + Playwright infra; 23.6.1 next)
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
| 23.6.1 | E2E publish flow + theme switch     | 4 (DX)    | S      | pending  |
| 23.7 | Multi-node rate-limit adapter         | 2 (ops)   | L      | pending  |
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

### 23.6.1 — E2E publish flow + theme switch (deferred from 23.6)

Builds on the Playwright infra shipped in 23.6.

- `publish.spec.ts` — sign in (re-using the helper from `auth.spec.ts`),
  navigate to `/admin/collections/posts/new`, fill title + a single
  text block (Lexical input is the load-bearing tricky part), publish,
  then `page.goto("/blog/<slug>")` and assert the public view renders
  the title and body.
- `theme.spec.ts` — sign in, navigate to `/admin/settings/theme`,
  switch from default → minimal, assert `/` renders with the new
  theme's body class.
- `install-plugin.spec.ts` *(if cheap)* — assert `/admin/plugins`
  surfaces the bundled plugins (reading-time, seo-audit, forum,
  oauth-github, oauth-google) and that one of them is enabled.
  Pure read-only check; install-from-marketplace is a 1.x feature
  so we don't simulate config edits here.
- Stretch: `search.spec.ts` — type a query that matches a seeded
  post, assert results render with a highlight.

Open question: do we share a single signed-in browser context
across the publish + theme specs (faster, less reliable on
isolation) or sign in fresh per test (slower, deterministic). Keep
fresh per-test until the suite is large enough to feel the cost.

### 23.7 — Multi-node rate-limit adapter

Define `NxRateLimiterAdapter` interface in `@nexpress/core` with
`InMemoryRateLimiter` (current behavior) as the default and
`RedisRateLimiter` as the reference multi-node implementation.
`apps/web/src/proxy.ts` reads the configured adapter via
`ensureFor("read")` plumbing. Issue #269 closes when this lands.

Open question to settle inside the PR: do we ship the Redis
adapter from `@nexpress/core` or as a separate
`@nexpress/rate-limiter-redis` package? Default to "separate
package" — keeps `@nexpress/core` Redis-free.

### 23.8 — First publish run

When `.github/workflows/ci.yml` and `release.yml` regain push/PR
triggers, queue any open changesets, merge the version-packages PR,
and watch `pnpm release` run end-to-end with provenance attestation.

No code change inside Phase 23 — this is the trigger event. Capture
install-time friction notes from the first external user reports
into a Phase 24 input list.
