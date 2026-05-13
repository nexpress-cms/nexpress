// Direct drizzle-orm migrate runner. Bypasses the drizzle-kit CLI
// because the CLI's non-TTY mode swallows CREATE TABLE failures
// (and other SQL errors) as a silent `exit 1` with no message —
// burning setup-wizard users with "migration failed" + nothing to
// act on. The library function used here, `migrate()` from
// `drizzle-orm/node-postgres/migrator`, throws a real Error object
// whose `message` is the SQL failure and whose `cause` carries the
// underlying pg error code (e.g. `42P07` for duplicate table). We
// surface both so the operator sees what actually went wrong.
//
// Wire-equivalent to `drizzle-kit migrate`: reads the same
// `./drizzle/` folder, advances the same `drizzle.__drizzle_migrations`
// tracking table. Replacing the CLI invocation in setup-server
// doesn't change the schema state, only the error fidelity.

import "./_load-env.js";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — copy .env.example to .env first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`could not connect to database: ${msg}`);
  process.exit(1);
}

const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ migrations applied");
} catch (err) {
  console.error("✗ migration failed:");
  if (err instanceof Error) {
    console.error(`  ${err.message}`);
    // drizzle-orm wraps the underlying pg error as `cause`. pg
    // errors carry SQL state code + the offending statement, both
    // critical for diagnosing a real-world failure.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      console.error(`  caused by: ${cause.message}`);
      const code = (cause as { code?: string }).code;
      if (code) console.error(`  sqlstate: ${code}`);
    }
  } else {
    console.error(`  ${String(err)}`);
  }
  await client.end().catch(() => {});
  process.exit(1);
}

await client.end();
