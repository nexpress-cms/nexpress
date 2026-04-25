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

Current count: **112 tests** across `@nexpress/core` and `@nexpress/next`.

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

### Writing a new integration test

```ts
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import {
  closeTestDb,
  ensureMigrated,
  getTestDb,
  skipIfNoTestDb,
  truncateAll,
} from "./setup.js";

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

**Core pipeline (30 tests, `packages/core/src/integration/`):**

| File | Covers |
|------|--------|
| `plugin-storage.integration.test.ts` (6) | ctx.storage set/get/delete/list/has + TTL expiry via `nx_plugin_storage` |
| `plugin-persistence.integration.test.ts` (5) | syncPluginRegistrations / updatePluginState upsert + idempotence |
| `reset-token.integration.test.ts` (5) | create→consume flow: password hash rotates, tokenVersion bumps, sessions delete |
| `pipeline.integration.test.ts` (4) | saveDocument create/update, revision versioning, findDocuments round-trip, deleteDocument |
| `scheduled.integration.test.ts` (4) | pipeline coerces published+future → scheduled; publishScheduledDocuments flips due rows, fires afterUpdate + afterPublish with full doc, idempotent |
| `ctx-settings.integration.test.ts` (6) | settings.getSite/getPlugin/setPlugin round-trip; theme.setTokens merges; ON CONFLICT prevents row duplication; capability gate |

**API routes (14 tests, `apps/web/tests/`):**

| File | Covers |
|------|--------|
| `health.integration.test.ts` (1) | `/api/health` smoke (no DB) |
| `auth.integration.test.ts` (3) | `/api/auth/me` with valid/missing/tampered session cookie |
| `collections.integration.test.ts` (3) | `/api/collections/[slug]` + `/[id]` — POST/GET round-trip, PATCH, DELETE, 401 without auth |
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

## CI

`.github/workflows/ci.yml` currently runs `pnpm test` on every push/PR. It
does **not** run integration tests yet — they require Postgres in the
runner, which is a separate workflow change.
