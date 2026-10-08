# Testing

Choose the lowest test layer that can detect the regression: unit tests for
pure contracts, PostgreSQL integration for persistence and transaction behavior,
browser tests for rendering and interaction, and packed scaffolds for consumer
installation and generated-project behavior.

## Documentation-only PR checks

CI still starts for every pull request and preserves the required check names.
A classifier reads the complete merge-base-to-head Git diff, without the changed
files API's pagination limit. Only regular, non-executable Markdown under `docs/`
and root `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` or `AGENTS.md` use the
fast path. Renames are evaluated as deletion plus addition. Package/scaffold
Markdown, changesets, scripts, workflows, configuration, symlinks and executable
mode changes require full CI. Empty diffs, missing history, ambiguous merge bases
and invalid event data also select full CI. Manual dispatch and push runs retain
full verification; existing push-to-main path exclusions are unchanged.

The documentation path installs frozen dependencies with lifecycle scripts
disabled, checks retained changed Markdown with the locked Prettier version, and
runs `pnpm test:repo`. This preserves documentation-currentness and release
contract checks without building packages, starting databases or running browser
and scaffold suites. Deleted documents still undergo repository contract checks.

The four existing result names report success only after documentation validation
or their corresponding full job succeeds. Scope/validation failure or cancellation
cannot become a green required check. Full PostgreSQL runs still require both
partitions and exact coverage receipts; only a validated documentation-only PR
may intentionally skip them. Gate logs explicitly distinguish these paths.
Version PR dispatch and Dependabot's named-result checks retain their contracts.

Repository tests use real Git fixtures for scope classification and reject
ambiguous scope, missing work, failed statuses and invalid coverage receipts.
They also run after a frozen `--ignore-scripts` install without build output.

### Hosted route verification

After changing CI routing, verify both outcomes on a documentation-only PR:

- An intentional formatting error must fail documentation validation and every required result gate, while application jobs remain skipped.
- Correct the same change and require all named gates to succeed before merging the evidence update.

[Verification PR #1494](https://github.com/nexpress-cms/nexpress/pull/1494)
exercised both paths after the classifier shipped:

- [Intentional format failure](https://github.com/nexpress-cms/nexpress/actions/runs/36236749703): all required result gates failed while application jobs stayed skipped.
- [Corrected document](https://github.com/nexpress-cms/nexpress/actions/runs/36236831760): documentation validation and all required gates passed while application jobs stayed skipped.

The corrected run took 40 seconds versus
[17 minutes 3 seconds for the preceding full-pipeline docs PR](https://github.com/nexpress-cms/nexpress/actions/runs/36208290554).
This single hosted comparison includes scheduling/setup and is not a latency guarantee.

## Unit tests (`pnpm test`)

Live next to the source they test as `<name>.test.ts`. Run with `pnpm test`
(or `pnpm test:watch` inside a package). No external services required —
these mock the DB / filesystem / network where needed.

Use unit tests for:

- Pure functions (templates, guards, schema validation, helpers).
- Logic that can be verified against mocks (hook ordering, payload shape,
  capability checks).

Use runner output for current counts. A parameterized test count is not a count
of independent guarantees: one lifecycle case can retain several labeled checks
while paying for one fixture. Record registered cases, exercised inputs, and
fixture work separately when comparing changes.

## Keeping tests useful

- Assert observable results and effects. Source-text checks belong only to
  contracts that are themselves structural, such as browser-safe entrypoints,
  reference/scaffold wrapper parity, or package metadata. Do not pin incidental
  formatting, helper names, or documentation prose.
- Keep each boundary at its owning layer. A pure parser matrix needs no database
  or browser, but SQL constraints, transaction rollback, persisted authorization,
  site isolation, and packed module resolution need their real environment.
- Share an expensive fixture only when cases cannot contaminate each other.
  Label each input and verify rejected writes leave the fixture unchanged;
  restore deliberately tampered data before the next probe. Keep independent
  scenarios separate when their setup or state transition differs.
- Keep route/viewport checks where layout can differ. Exercise a shared shell
  interaction once per relevant shell and viewport instead of repeating it on
  every route. Preserve page-specific interaction and accessibility checks.
- Separate performance fixture construction from the measured operation. Keep
  cardinalities that exercise the intended scale or boundary; reducing a large
  fixture is not evidence that the production operation became faster.
- Compare targeted before/after runs under the same conditions and report
  fixture counts and wall time alongside runner time. Build caches, concurrent
  machine load, retries, and CI versus local hardware are separate effects.
  Run final gates once after the bundle settles; rerun only affected checks
  when a later change or failure requires it.

The [September 2026 cleanup evidence](agent-guidance/history/test-cleanup-2026-09.md)
records consolidation decisions, retained guarantees and measured results.

## Integration tests (`pnpm test:integration`)

Live under `packages/core/src/integration/` and `apps/web/tests/` as
`<name>.integration.test.ts` and run against a **real Postgres** so they
can exercise code paths that unit tests can't fake — drizzle SQL,
multi-statement transactions, pg-boss wiring, route-handler request /
response shape, etc.

The root `pnpm test:integration` runs packages **sequentially**
(`--concurrency=1`) so different packages do not wipe each other's
tables mid-test. Inside each package, Vitest can still run files in
parallel: global setup assigns a short run namespace, prepares a migrated
`${TEST_DATABASE_URL}_${runId}_template` database once, then each fork lazily
clones it into its own `${TEST_DATABASE_URL}_${runId}_wN` database and truncates
only that worker database in `beforeEach`. The namespace keeps two local
integration runs pointed at the same `TEST_DATABASE_URL` from deleting each
other's template or worker databases.

We deliberately keep the per-test cleanup as bounded `TRUNCATE` rather
than wrapping each test in one outer rollback transaction. Many integration
paths exercise route handlers, app bootstrap pools, pg-boss setup, and hooks
that can cross connection boundaries or schedule work after commit; a single
transaction would make those paths look cleaner than production. Per-worker
databases plus truncate cleanup are a little heavier, but they match the app
runtime more closely.

The `apps/web` integration global setup also creates a disposable local-media
root under the operating-system temp directory. Each Vitest worker receives a
separate subdirectory through `NP_STORAGE_DIR`, regardless of storage settings
in the developer's `.env`, and global teardown removes the entire run root even
when tests fail. Integration uploads must never write to `apps/web/public/media`.

The default `pnpm test` excludes `*.integration.test.ts` from the core
package so unit tests stay parallel and fast — run integration suites
with `pnpm test:integration` (or per-package `pnpm test:integration`).

### CI integration partitions

CI keeps the local `pnpm test:integration` command unchanged. Its PostgreSQL
coverage runs on two independent runners, each with its own PostgreSQL 16 and
Redis 7 containers. After the usual full build, `scripts/integration-partitions.mjs`
uses Vitest's configured file discovery and splits Web files by descending
historical duration, assigning each next file to the lighter group. The timing
seed in `scripts/integration-durations.json` comes from PR #1455; it is a weight,
not an allowlist or a wall-time prediction. New files use the median known weight,
and removed files are ignored. Core runs once in partition 1 and Redis once in
partition 2. Worker isolation, fixture cleanup, timeouts and native-preview gating
remain unchanged; the E2E job still explicitly enables native preview.

The runner requires database settings (and Redis for partition 2), rejects new
unassigned integration package owners, and verifies that Vitest's actual file
selection matches each planned group exactly. It emits a coverage receipt only
after all assigned commands pass. The existing required check
`integration tests (Postgres)` waits for both jobs, rejects any non-success result,
and verifies both receipts belong to the current commit and cover the same complete
Web inventory exactly once. Missing artifacts fail the gate. Stable artifact names
with replacement support partial job reruns. Version PR bridging and Dependabot
continue to consume the unchanged aggregate check name.

Inspect the plan without database connections:

```bash
node scripts/integration-partitions.mjs --plan
```

To reproduce a partition locally, build dependencies first and set `DATABASE_URL`,
`TEST_DATABASE_URL`, `NP_SECRET`, `SITE_URL`, `TEST_REDIS_URL` (partition 2), and
`GITHUB_SHA` to the tested commit. Use a disposable database for each partition:

```bash
node scripts/integration-partitions.mjs 1 --output /tmp/np-integration-results
node scripts/integration-partitions.mjs 2 --output /tmp/np-integration-results
node scripts/integration-partitions.mjs --check-results /tmp/np-integration-results
```

Partitioning repeats build/setup on two runners to shorten the critical path.
Historical durations balance work; they do not establish a hosted-CI speedup.
Initial local acceptance used separate disposable databases and verified complete,
non-overlapping coverage, with Redis and native-preview gating handled explicitly.
Regression tests protect receipt completeness, commit/package ownership, required
settings, child failures and rerun artifact replacement.

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

- Root-level integration tests run one package at a time. Within a
  package, files run in forked workers against isolated cloned databases.
- Each test truncates every framework table it touches in `beforeEach`, so
  order doesn't matter and state never leaks inside a worker database.
- Media uploads use per-worker directories under a disposable OS temp root;
  global teardown removes every file created by the run.
- Migrations (everything under `apps/web/drizzle/*.sql`) are applied once
  to the template database per test run. Worker databases are cloned from
  that migrated template.
- When `TEST_DATABASE_URL` is unset, every integration test is skipped
  (reads as "skipped" in vitest output, not "failed"). Safe to run in
  any environment.
- `@nexpress/rate-limiter-redis` has an optional live Redis integration
  test. Start it with
  `docker compose -f docker/docker-compose.yml --profile redis up -d redis`,
  export `TEST_REDIS_URL=redis://localhost:6379`, then run
  `pnpm --filter @nexpress/rate-limiter-redis test`. When
  `TEST_REDIS_URL` is unset, that package's Redis integration test is
  skipped. CI provisions Redis 7 in partition 2 and runs this package
  directly with `TEST_REDIS_URL`, so its three live cases always execute there.
- Built-in theme shell/header/footer rendering uses the async React stream
  boundary and real persisted navigation. The five restored theme-render cases
  run with the normal PostgreSQL integration suite; they no longer have an
  unconditional skip.

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

Use the source inventory instead of a manually maintained per-file count:

```bash
rg --files packages/core/src/integration apps/web/tests -g '*.integration.test.ts' -g '*.integration.test.tsx'
node scripts/integration-partitions.mjs --plan
```

- **Core persistence and pipeline:** real storage/expiry, transactional content
  writes, scheduling, search indexing and service lifecycle behavior.
- **Shared-app API and domain flows:** direct route calls over PostgreSQL, including
  authentication, ACLs, site isolation, revisions, import/export, media, community,
  commerce and Agent lifecycle contracts.
- **CLI templates and packed scaffolds:** template unit tests protect source roots,
  generated-code wiring and dependency contracts; the packed journey proves fresh
  consumer installation, migrations, module loading, extension lifecycle and build.

The unit suites in `@nexpress/core`, `@nexpress/next`, and `@nexpress/app`
also verify the exact bounded API error envelope, known code/status mapping,
Zod detail normalization, fail-closed malformed-error behavior, and reusable
OpenAPI error components without requiring Postgres.

Run the API suite with the same `TEST_DATABASE_URL` via
`pnpm --filter @nexpress/web test:integration` or the root
`pnpm test:integration` fan-out. The root `pnpm test` command runs unit
tests only.
The harness lives at `apps/web/tests/harness.ts` and reuses the same
core setup (`ensureMigrated`, `truncateAll`) plus app-side helpers
(`seedUser`, `buildRequest`, `readJson`). Route handlers are invoked
directly with synthetic `NextRequest` objects rather than through a
running server.

The pipeline/scheduled tests reuse `apps/web`'s `posts` collection via a
test-only fixture (`src/integration/fixtures.ts`). Core's main tsconfig
excludes `src/integration/` so the cross-directory import doesn't trip
`tsc --noEmit`; vitest handles the TS resolution at test run time.

### Follow-up coverage

- **SMTP adapter against a real relay** — covered by
  `packages/core/src/email/smtp.test.ts`, which starts an in-process
  SMTP-speaking relay and sends through `SmtpEmailAdapter`. The adjacent
  contract tests cover exact messages, adapter registration/results, SMTP env
  parsing, and credential-template expirations.
- **Search vector ranking** — covered by
  `apps/web/tests/search-quality.integration.test.ts`, including field
  weighting, cross-collection relevance ranking, and reindex behaviour.
- **pg-boss queue pickup** — covered by
  `packages/core/src/integration/pg-boss-worker.integration.test.ts`,
  which starts the real worker, enqueues a job, and asserts that the
  registered handler ran with the expected job context.

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

High-request specs must give each test context a distinct reserved TEST-NET
`x-forwarded-for` identity with the shared rate-limit fixture. Keep retry and
repeat buckets distinct: the Playwright worker may restart while the built app
and its fixed-window in-memory limiter remain alive. This isolates test traffic
without weakening production limits or adding sleeps.

### Current coverage

| Spec                            | Covers                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`                  | Sign in via form, /admin lands, logout entry visible, POST /api/auth/logout clears session, `/admin` redirects to login. Plus a negative-path "wrong password stays on login" check.                                                           |
| `admin-mobile-layout.spec.ts`   | 320/360/390px admin shell, drawer open/closed overflow, narrow-phone tap targets, settings tabs, dialogs, and operational admin surfaces.                                                                                                      |
| `authoring-reliability.spec.ts` | Admin unsaved-navigation guards for links and browser history, failed-save dirty-state preservation, revision diff visibility, rich-text revision restore, latest-autosave recovery, recovery dismissal, and post-recovery rich-text autosave. |
| `mobile-layout.spec.ts`         | 320/390/430px public bundled themes, mobile drawers, and no hidden horizontal scroll on representative public routes.                                                                                                                          |
| `preview.spec.ts`               | Admin Preview links and save-then-preview authoring flows for draft, scheduled, and published pages/posts, including public-route 404 before draft mode and draft-mode render at the collection's real public URL.                             |
| `publish.spec.ts`               | Admin-created page publish flow, public route availability, and the published document appearing back in the admin collection list.                                                                                                            |
| `theme.spec.ts`                 | Settings → Theme activation for an inactive bundled theme, followed by cleanup back to the canonical default theme.                                                                                                                            |
| `plugins.spec.ts`               | Installed plugin enumeration, config-schema admin detail rendering, dedicated plugin config save, runtime plugin-route config usage, and legacy config PATCH rejection.                                                                        |

Mobile E2E should keep the assertion strict: pages must not grow
`documentElement.scrollWidth` beyond the viewport, including when a
drawer is closed. If a failure is font- or platform-specific, fix the
layout and keep the diagnostic metrics rather than widening the
allowed overflow.

Publish flow, theme switching, and plugin config regression coverage
are now part of the Playwright suite.

## CI

`.github/workflows/ci.yml` runs on every pull request, manual
`workflow_dispatch`, and selected `push: main` changes (docs-only and
changeset-only pushes are ignored on `main`). It preserves four required result
names; documentation-only validation or the corresponding full jobs satisfy them.
Full jobs use Ubuntu, Node 22 and pnpm 10.33:

1. `typecheck + build + test` — install → build → typecheck → `pnpm test`.
2. `integration tests (Postgres)` — validates both PostgreSQL partition results
   and their exact coverage receipts. Each runner uses isolated service containers
   and the [partition runner](#ci-integration-partitions); persisted writes and
   transaction behavior run against real PostgreSQL.
3. `E2E (Playwright)` — separate Postgres service container (DB
   `nexpress_e2e`), `playwright install --with-deps chromium`,
   `pnpm build`, then `pnpm --filter @nexpress/web test:e2e` with
   `PLAYWRIGHT_USE_BUILD=1`. Runs on pull requests and manual dispatch, not
   push-to-main. On failure it uploads `apps/web/test-results/` as the
   `playwright-test-results` artifact, including retained traces and error
   context, without enabling a second report or rerunning the suite.
4. `scaffold smoke (fresh scaffold journey)` — packs the workspace packages,
   scaffolds a temp project outside the monorepo, installs it, typechecks it,
   builds generated `nexpress create *-plugin` packages, verifies their
   add / doctor / remove lifecycle, and runs the deploy-readiness journey
   smoke.
