import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { setDb } from "../db/runtime.js";

/**
 * Integration tests reuse the same Postgres that `docker compose up -d db`
 * spins up for local dev, but against a dedicated `*_test` database so
 * fixture churn doesn't wipe dev data.
 *
 * Tests skip themselves when TEST_DATABASE_URL isn't set — CI without
 * Docker then simply reports zero integration tests rather than failing.
 *
 * Parallelism: the global-setup hook prepares a `${base}_template` DB with
 * migrations applied once. Each vitest worker (identified by VITEST_POOL_ID)
 * lazily clones it into `${base}_w${N}` on first DB access via
 * `CREATE DATABASE … TEMPLATE …`, which is a near-instant filesystem copy
 * server-side. fileParallelism therefore stays safe — no two workers ever
 * share a DB.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/web/drizzle",
);

function parseBaseUrl(): URL | null {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || raw.length === 0) return null;
  return new URL(raw);
}

function getBaseDatabaseName(): string | null {
  const u = parseBaseUrl();
  if (!u) return null;
  return u.pathname.replace(/^\//, "");
}

function getTemplateDatabaseName(): string | null {
  const base = getBaseDatabaseName();
  return base ? `${base}_template` : null;
}

function getWorkerSuffix(): string | null {
  const id = process.env.VITEST_POOL_ID;
  return id ? `_w${id}` : null;
}

export function getTestDatabaseUrl(): string | null {
  const u = parseBaseUrl();
  if (!u) return null;
  const suffix = getWorkerSuffix();
  if (!suffix) return u.toString();
  const base = u.pathname.replace(/^\//, "");
  u.pathname = `/${base}${suffix}`;
  return u.toString();
}

function getAdminDatabaseUrl(): string | null {
  const u = parseBaseUrl();
  if (!u) return null;
  u.pathname = "/postgres";
  return u.toString();
}

let pool: pg.Pool | null = null;
let db: NodePgDatabase<Record<string, unknown>> | null = null;
let migrated = false;
let workerDbReady = false;

/**
 * On a parallel run, clone the migrated template into a per-worker DB.
 * No-op when VITEST_POOL_ID isn't set (single-fork or CLI invocation) —
 * the worker just connects to the base test DB directly.
 */
async function ensureWorkerDatabase(): Promise<void> {
  if (workerDbReady) return;
  const suffix = getWorkerSuffix();
  if (!suffix) {
    workerDbReady = true;
    return;
  }
  const base = getBaseDatabaseName();
  const template = getTemplateDatabaseName();
  const adminUrl = getAdminDatabaseUrl();
  if (!base || !template || !adminUrl) {
    workerDbReady = true;
    return;
  }
  const workerDb = `${base}${suffix}`;

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const { rows } = await adminPool.query<{ exists: number }>(
      "SELECT 1 AS exists FROM pg_database WHERE datname = $1",
      [workerDb],
    );
    if (rows.length === 0) {
      // CREATE DATABASE doesn't accept parameter binds — names are
      // already constrained to [A-Za-z0-9_] via the deterministic
      // prefix/suffix construction above, so direct interpolation is
      // safe here.
      await adminPool.query(`CREATE DATABASE "${workerDb}" TEMPLATE "${template}"`);
    }
  } finally {
    await adminPool.end();
  }
  workerDbReady = true;
}

export async function getTestDb(): Promise<NodePgDatabase<Record<string, unknown>>> {
  if (db) return db;
  const url = getTestDatabaseUrl();
  if (!url) {
    throw new Error("TEST_DATABASE_URL not set — did you forget to call skipIfNoTestDb()?");
  }
  await ensureWorkerDatabase();
  // max=3 keeps the per-fork connection budget tight: with 8 forks ×
  // (3 harness + 4 bootstrap) + admin pools we stay comfortably below
  // Postgres' default max_connections=100 (CI containers often ship
  // with the default).
  pool = new pg.Pool({ connectionString: url, max: 3 });
  db = drizzle(pool);
  setDb(db);
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
 * tables already exist. When NX_TEST_TEMPLATE_READY=1 (set by the
 * global-setup hook), this becomes a no-op since the template DB was
 * already migrated and our worker DB is a clone.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  if (process.env.NX_TEST_TEMPLATE_READY === "1") {
    await getTestDb();
    migrated = true;
    return;
  }
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
    "nx_job_logs",
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
  return parseBaseUrl() === null;
}

/**
 * Used by the vitest globalSetup hook in both apps/web and packages/core
 * integration configs. Drops any leftover worker DBs from a prior run,
 * then recreates `${base}_template` from the migration SQL files.
 * Idempotent. CREATE DATABASE … TEMPLATE only needs the caller to be the
 * template owner — we don't flag IS_TEMPLATE so this stays compatible
 * with managed Postgres (RDS / Cloud SQL) where pg_database catalog
 * writes require superuser.
 *
 * The LIKE patterns use `\_` to escape the literal underscore from
 * Postgres' metacharacter so `nexpress_test_w%` doesn't accidentally
 * match unrelated DBs that happen to have similar prefixes. Patterns
 * are passed via $1 binds so they aren't subject to host-side string
 * escape processing.
 */
export async function prepareTemplateDatabase(): Promise<() => Promise<void>> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) {
    return async () => {
      /* no-op when integration tests are skipped wholesale */
    };
  }
  const base = getBaseDatabaseName()!;
  const template = getTemplateDatabaseName()!;
  const adminUrl = getAdminDatabaseUrl()!;
  const workerLikePattern = `${base}\\_w%`;

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    // Sweep leftover worker DBs from a prior run, terminating any
    // dangling connections first so DROP doesn't wedge.
    const leftover = await adminPool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [workerLikePattern],
    );
    for (const { datname } of leftover.rows) {
      await adminPool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [datname],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${datname}"`);
    }

    // Recreate template fresh on every run so schema drift never lingers.
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [template],
    );
    // Earlier iterations of this hook flagged the template DB with
    // `datistemplate=true`, which Postgres refuses to DROP. Clear the
    // flag if it lingers from a prior run. This is a catalog write
    // (superuser-only) — managed Postgres rejects it, but those envs
    // never set the flag in the first place so the subsequent DROP
    // still succeeds. Swallow the error either way.
    try {
      await adminPool.query("UPDATE pg_database SET datistemplate = false WHERE datname = $1", [
        template,
      ]);
    } catch {
      /* see comment above */
    }
    await adminPool.query(`DROP DATABASE IF EXISTS "${template}"`);
    await adminPool.query(`CREATE DATABASE "${template}"`);
  } finally {
    await adminPool.end();
  }

  // Apply migrations onto the template using a dedicated pool.
  const tplUrl = new URL(baseUrl);
  tplUrl.pathname = `/${template}`;
  const tplPool = new pg.Pool({ connectionString: tplUrl.toString(), max: 1 });
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        try {
          await tplPool.query(stmt);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/already exists/i.test(message)) throw error;
        }
      }
    }
  } finally {
    await tplPool.end();
  }

  process.env.NX_TEST_TEMPLATE_READY = "1";

  return async () => {
    // Teardown — drop worker DBs so the next run starts clean. Leave the
    // template in place; it'll be recreated by the next `prepareTemplateDatabase`.
    const cleanupPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
    try {
      const { rows } = await cleanupPool.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1",
        [workerLikePattern],
      );
      for (const { datname } of rows) {
        await cleanupPool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
          [datname],
        );
        await cleanupPool.query(`DROP DATABASE IF EXISTS "${datname}"`);
      }
    } finally {
      await cleanupPool.end();
    }
  };
}
