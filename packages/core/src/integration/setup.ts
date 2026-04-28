import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { setDb } from "../collections/pipeline.js";
import { setMediaDb } from "../media/service.js";

/**
 * Integration tests reuse the same Postgres that `docker compose up -d db`
 * spins up for local dev, but against a dedicated `*_test` database so
 * fixture churn doesn't wipe dev data.
 *
 * Tests skip themselves when TEST_DATABASE_URL isn't set — CI without
 * Docker then simply reports zero integration tests rather than failing.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/web/drizzle",
);

export function getTestDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  return url && url.length > 0 ? url : null;
}

let pool: pg.Pool | null = null;
let db: NodePgDatabase<Record<string, unknown>> | null = null;
let migrated = false;

export async function getTestDb(): Promise<NodePgDatabase<Record<string, unknown>>> {
  if (db) return db;
  const url = getTestDatabaseUrl();
  if (!url) {
    throw new Error("TEST_DATABASE_URL not set — did you forget to call skipIfNoTestDb()?");
  }
  pool = new pg.Pool({ connectionString: url, max: 5 });
  db = drizzle(pool);
  setDb(db);
  setMediaDb(db);
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

/**
 * Replays every `.sql` file under apps/web/drizzle in lexical order. Each
 * file is split on `--> statement-breakpoint` (the delimiter drizzle-kit
 * emits) and each chunk is executed individually so a single
 * already-exists error short-circuits the rest of the file's statements
 * (we catch duplicates and move on).
 *
 * Idempotent — run it against a fresh DB once; subsequent runs no-op when
 * tables already exist.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await getTestDb();
  if (!pool) throw new Error("Pool not initialised.");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit writes `--> statement-breakpoint` between statements.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Re-runs against a populated DB will hit "already exists". Swallow
        // those, let everything else surface.
        if (!/already exists/i.test(message)) {
          throw error;
        }
      }
    }
  }
  migrated = true;
}

/**
 * Wipe every row from the tables that integration tests touch. Keeps the
 * schema around (much faster than drop-and-recreate). Order matters:
 * children before parents so FK constraints don't bite.
 */
export async function truncateAll(): Promise<void> {
  await getTestDb();
  if (!pool) throw new Error("Pool not initialised.");
  const tables = [
    "nx_sessions",
    "nx_revisions",
    "nx_plugin_storage",
    "nx_plugins",
    "nx_worker_heartbeats",
    "nx_settings",
    "nx_navigation",
    "nx_media_refs",
    "nx_media",
    "nx_media_folders",
    "nx_user_oauth_identities",
    "nx_users",
    // Community tables (Phase 9.1a+). Order doesn't matter under CASCADE
    // — listing them keeps RESTART IDENTITY consistent and the test DB
    // wipes cleanly between cases.
    "nx_audit_events",
    "nx_reports",
    "nx_notifications",
    "nx_follows",
    "nx_reactions",
    "nx_comments",
    "nx_bans",
    "nx_member_roles",
    "nx_member_identities",
    "nx_member_sessions",
    "nx_members",
  ];
  const list = tables.map((t) => `"${t}"`).join(", ");
  // CASCADE handles any FK holdouts. RESTART IDENTITY resets any sequences
  // (unused by the schema today but future-proof).
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Early-return helper for test files. Call as the first line of a describe
 * block when the suite requires a real DB; tests marked with skipIf() below
 * will read as "skipped" in vitest output rather than failing.
 */
export function skipIfNoTestDb(): boolean {
  return getTestDatabaseUrl() === null;
}
