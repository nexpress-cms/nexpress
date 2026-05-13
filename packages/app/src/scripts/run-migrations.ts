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
  let collisionSqlstate: string | null = null;
  if (err instanceof Error) {
    console.error(`  ${err.message}`);
    // drizzle-orm wraps the underlying pg error as `cause`. pg
    // errors carry SQL state code + the offending statement, both
    // critical for diagnosing a real-world failure.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      console.error(`  caused by: ${cause.message}`);
      const code = (cause as { code?: string }).code;
      if (code) {
        console.error(`  sqlstate: ${code}`);
        // 42710 = duplicate object (e.g. enum type), 42P07 =
        // duplicate table. Both mean this DB already holds tables
        // from another NexPress install — pre-flight should have
        // caught it, but didn't because `drizzle.__drizzle_migrations`
        // exists from that earlier project. Surface the recovery
        // path here instead of leaving the operator on raw pg
        // text.
        if (code === "42710" || code === "42P07") collisionSqlstate = code;
      }
    }
  } else {
    console.error(`  ${String(err)}`);
  }
  if (collisionSqlstate) {
    const dbName = (() => {
      try {
        return new URL(url).pathname.replace(/^\//, "") || "<db>";
      } catch {
        return "<db>";
      }
    })();
    console.error("");
    console.error(
      "  This database already contains tables/types from another NexPress",
    );
    console.error("  install. Pick one:");
    console.error(
      `    1. Point DATABASE_URL at a fresh database (recommended for multi-project hosts)`,
    );
    console.error(`    2. Drop and recreate this one:`);
    console.error(
      `       docker compose -f docker/docker-compose.yml exec db psql -U nexpress \\`,
    );
    console.error(
      `         -c 'DROP DATABASE "${dbName}"; CREATE DATABASE "${dbName}";'`,
    );
    console.error(`       (this DESTROYS all data in '${dbName}')`);
  }
  await client.end().catch(() => {});
  process.exit(1);
}

await client.end();
