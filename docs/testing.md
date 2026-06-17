# Testing

NexPress has two tiers of tests. Choose the right one for the code you're
writing.

## Unit tests (`pnpm test`)

Live next to the source they test as `<name>.test.ts`. Run with `pnpm test`
(or `pnpm test:watch` inside a package). No external services required —
these mock the DB / filesystem / network where needed.

Use unit tests for:

- Pure functions (templates, guards, schema validation, helpers).
- Logic that can be verified against mocks (hook ordering, payload shape,
  capability checks).

Current size (post-Phase 19): roughly **230+ unit tests** across
`@nexpress/core`, `@nexpress/next`, `@nexpress/plugin-sdk`,
`@nexpress/plugin-oauth-github`, `@nexpress/plugin-oauth-google`, and
`create-nexpress`. Plus ~350 integration tests under
`packages/core/src/integration/` and `apps/web/tests/` (gated on
`TEST_DATABASE_URL`). Run `pnpm test` for current totals — file counts
drift quickly.

## Integration tests (`pnpm test:integration`)

Live under `packages/core/src/integration/` and `apps/web/tests/` as
`<name>.integration.test.ts` and run against a **real Postgres** so they
can exercise code paths that unit tests can't fake — drizzle SQL,
multi-statement transactions, pg-boss wiring, route-handler request /
response shape, etc.

Integration tests truncate every shared table in `beforeEach`, so the
root `pnpm test:integration` runs packages **sequentially**
(`--concurrency=1`) to avoid different packages wiping each other's
data mid-test. Each package internally serialises files via vitest's
`singleFork` (core) or `fileParallelism: false` (apps/web).

The default `pnpm test` excludes `*.integration.test.ts` from the core
package so unit tests stay parallel and fast — run integration suites
with `pnpm test:integration` (or per-package `pnpm test:integration`).

### One-time setup

1. Start the dev Postgres container:

   ```bash
   docker compose -f docker/docker-compose.yml up -d db
   ```

2. Create a dedicated `nexpress_test` database so fixture churn doesn't wipe
   your dev data:

   ```bash
   docker compose -f docker/docker-compose.yml exec db \
     psql -U nexpress -d nexpress -c "CREATE DATABASE nexpress_test;"
   ```

3. Export the connection string when running tests:

   ```bash
   export TEST_DATABASE_URL=postgres://nexpress:nexpress@localhost:5433/nexpress_test
   pnpm test:integration
   ```

### Behaviour

- Tests run **sequentially** in a single fork so they can share tables
  without stepping on each other.
- Each test truncates every table it touches in `beforeEach`, so order
  doesn't matter and state never leaks.
- Migrations (everything under `apps/web/drizzle/*.sql`) are applied once
  per test run. Re-runs are idempotent.
- When `TEST_DATABASE_URL` is unset, every integration test is skipped
  (reads as "skipped" in vitest output, not "failed"). Safe to run in
  any environment.
- `@nexpress/rate-limiter-redis` has an optional live Redis integration
  test. Start it with
  `docker compose -f docker/docker-compose.yml --profile redis up -d redis`,
  export `TEST_REDIS_URL=redis://localhost:6379`, then run
  `pnpm --filter @nexpress/rate-limiter-redis test`. When
  `TEST_REDIS_URL` is unset, that package's Redis integration test is
  skipped.

### Writing a new integration test

```ts
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { closeTestDb, ensureMigrated, getTestDb, skipIfNoTestDb, truncateAll } from "./setup.js";

describe.skipIf(skipIfNoTestDb())("my thing", () => {
  beforeAll(async () => {
    await ensureMigrated();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await closeTestDb();
  });

  it("does the thing", async () => {
    const db = await getTestDb();
    // … exercise real pipeline, helpers, etc.
  });
});
```

### Current integration coverage

> **Catalog drift warning.** The tables below were accurate through
> Phase 13. Phases 14–19 added more integration files (worker
> heartbeat, plugin schedules, site-scoped community/audit/storage,
> notification preferences, etc.) that are NOT enumerated here. For
> the live list, run `ls packages/core/src/integration/` and
> `ls apps/web/tests/`. The categories (pipeline / CLI / API) still
> describe the structure — it's only the per-file detail that drifts.

**Core pipeline (30+ tests, `packages/core/src/integration/`):**

| File                                         | Covers                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin-storage.integration.test.ts` (6)     | ctx.storage set/get/delete/list/has + TTL expiry via `np_plugin_storage`                                                                            |
| `plugin-persistence.integration.test.ts` (5) | syncPluginRegistrations / updatePluginState upsert + idempotence                                                                                    |
| `reset-token.integration.test.ts` (5)        | create→consume flow: password hash rotates, tokenVersion bumps, sessions delete                                                                     |
| `pipeline.integration.test.ts` (4)           | saveDocument create/update, revision versioning, findDocuments round-trip, deleteDocument                                                           |
| `scheduled.integration.test.ts` (4)          | pipeline coerces published+future → scheduled; publishScheduledDocuments flips due rows, fires afterUpdate + afterPublish with full doc, idempotent |
| `ctx-settings.integration.test.ts` (6)       | settings.getSite/getPlugin/setPlugin round-trip; theme.setTokens merges; ON CONFLICT prevents row duplication; capability gate                      |

**CLI templates (6 tests, `packages/cli/src/templates.test.ts`):**

Guards the structural invariants verified by manually scaffolding +
typechecking + `next build`. Tests catch regressions like the stub
`generated/collections.ts` going missing, the worker template's
top-level narrowing creeping back, or the admin login `onSubmit`
losing its void wrapper.

**API routes (14+ tests, `apps/web/tests/`):**

| File                                    | Covers                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `health.integration.test.ts` (1)        | `/api/health` smoke (no DB)                                                                      |
| `auth.integration.test.ts` (3)          | `/api/auth/me` with valid/missing/tampered session cookie                                        |
| `collections.integration.test.ts` (3)   | `/api/collections/[slug]` + `/[id]` — POST/GET round-trip, PATCH, DELETE, 401 without auth       |
| `import-export.integration.test.ts` (7) | export full / partial / unknown-slug / non-admin; import dry-run / partial filter / unknown-slug |

Run the API suite with the same `TEST_DATABASE_URL` — `pnpm test`
from the repo root fans out to every workspace, including `apps/web`.
The harness lives at `apps/web/tests/harness.ts` and reuses the same
core setup (`ensureMigrated`, `truncateAll`) plus app-side helpers
(`seedUser`, `buildRequest`, `readJson`). Route handlers are invoked
directly with synthetic `NextRequest` objects rather than through a
running server.

The pipeline/scheduled tests reuse `apps/web`'s `posts` collection via a
test-only fixture (`src/integration/fixtures.ts`). Core's main tsconfig
excludes `src/integration/` so the cross-directory import doesn't trip
`tsc --noEmit`; vitest handles the TS resolution at test run time.

### Not yet covered (follow-ups)

- **SMTP adapter against a real relay** — use a mail-capturing service
  (Mailtrap, Ethereal, or a local MailHog) rather than a production SMTP.
- **Search vector ranking** — would need seeded docs with varied
  full-text content and `ts_rank` assertions.
- **pg-boss queue** — add a test that enqueues a job, waits for the
  worker to pick it up, and asserts the handler ran.

## E2E tests (`pnpm --filter @nexpress/web test:e2e`)

Playwright suite under `apps/web/tests/e2e/`. Drives a real browser
against a running NexPress so we catch regressions that the
integration suite can't see — middleware-shaped routing, hydration
errors, cookie-driven flows that depend on the layered admin /
public render.

### One-time setup

```bash
pnpm install
pnpm --filter @nexpress/web exec playwright install chromium
```

The browser binary lives in `~/.cache/ms-playwright/`; subsequent
runs reuse it.

### Running locally

```bash
pnpm --filter @nexpress/web test:e2e          # headless
pnpm --filter @nexpress/web test:e2e:ui       # Playwright UI mode
```

The config (`apps/web/playwright.config.ts`) starts `next dev` on
port 3001 (separate from a developer's 3000) so e2e doesn't collide
with an active `pnpm dev`. `globalSetup` loads the repo `.env` and
seeds an idempotent admin (`e2e-admin@example.com`) — the spec files
sign in as that fixture user and never touch the operator's real
admin row.

CI sets `PLAYWRIGHT_USE_BUILD=1` so the run instead uses
`next start` against a pre-built app — production-shaped output, no
transpile cost. Browsers install via
`playwright install --with-deps chromium` in the CI job.

### Current coverage

| Spec                          | Covers                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.spec.ts`                | Sign in via form, /admin lands, logout entry visible, POST /api/auth/logout clears session, `/admin` redirects to login. Plus a negative-path "wrong password stays on login" check. |
| `admin-mobile-layout.spec.ts` | 320/360/390px admin shell, drawer open/closed overflow, narrow-phone tap targets, settings tabs, dialogs, and operational admin surfaces.                                            |
| `mobile-layout.spec.ts`       | 320/390/430px public bundled themes, mobile drawers, and no hidden horizontal scroll on representative public routes.                                                                |

Mobile E2E should keep the assertion strict: pages must not grow
`documentElement.scrollWidth` beyond the viewport, including when a
drawer is closed. If a failure is font- or platform-specific, fix the
layout and keep the diagnostic metrics rather than widening the
allowed overflow.

Publish flow + theme switch + plugin enumeration are tracked under
Phase 23.6.1; the infra is in place, only the spec files are
pending.

## CI

`.github/workflows/ci.yml` runs on every pull request, manual
`workflow_dispatch`, and selected `push: main` changes (docs-only and
changeset-only pushes are ignored on `main`). It defines four jobs on Ubuntu
(Node 22, pnpm 10.33):

1. `typecheck + build + test` — install → build → typecheck → `pnpm test`.
2. `integration tests (Postgres)` — boots a Postgres 16 service container, sets
   `TEST_DATABASE_URL=postgres://nexpress:nexpress@localhost:5432/nexpress_test`,
   and runs `pnpm test:integration` (#275). Covers the pipeline /
   write-path code that mock-based unit tests can't.
3. `E2E (Playwright)` — separate Postgres service container (DB
   `nexpress_e2e`), `playwright install --with-deps chromium`,
   `pnpm build`, then `pnpm --filter @nexpress/web test:e2e` with
   `PLAYWRIGHT_USE_BUILD=1`. Runs on pull requests and manual dispatch, not
   push-to-main. Uploads the Playwright report as a build artifact on failure.
4. `scaffold smoke (fresh scaffold journey)` — packs the workspace packages,
   scaffolds a temp project outside the monorepo, installs it, typechecks it,
   and runs the deploy-readiness journey smoke.
