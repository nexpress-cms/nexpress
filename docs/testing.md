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

Live under `packages/core/src/integration/` as `<name>.integration.test.ts`
and run against a **real Postgres** so they can exercise code paths that
unit tests can't fake — drizzle SQL, multi-statement transactions, pg-boss
wiring, etc.

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

| File | Covers |
|------|--------|
| `plugin-storage.integration.test.ts` | ctx.storage set/get/delete/list/has + TTL expiry via `nx_plugin_storage` |
| `plugin-persistence.integration.test.ts` | syncPluginRegistrations / updatePluginState upsert + idempotence |
| `reset-token.integration.test.ts` | create→consume flow: password hash rotates, tokenVersion bumps, sessions delete |

### Not yet covered (follow-ups)

- `publishScheduledDocuments` — needs a test collection with a `publishedAt`
  date field. Requires either a fixture collection with generated drizzle
  schema or a harness that runs `pnpm db:generate` against the test DB.
- Full `saveDocument` pipeline including revisions + media refs.
- SMTP adapter against a real relay (use a mail-capturing service for this
  class of test).

## CI

`.github/workflows/ci.yml` currently runs `pnpm test` on every push/PR. It
does **not** run integration tests yet — they require Postgres in the
runner, which is a separate workflow change.
