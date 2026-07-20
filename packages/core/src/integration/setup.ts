import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { setDb } from "../db/runtime.js";
import { splitMigrationStatements } from "./migration-split.js";

/**
 * Integration tests reuse the same Postgres that `docker compose up -d db`
 * spins up for local dev, but against a dedicated `*_test` database so
 * fixture churn doesn't wipe dev data.
 *
 * Tests skip themselves when TEST_DATABASE_URL isn't set — CI without
 * Docker then simply reports zero integration tests rather than failing.
 *
 * Parallelism: the global-setup hook assigns a per-run namespace, prepares a
 * `${base}_${runId}_template` DB with migrations applied once, then each
 * vitest worker (identified by VITEST_POOL_ID) lazily clones it into
 * `${base}_${runId}_w${N}` on first DB access via `CREATE DATABASE … TEMPLATE …`,
 * which is a near-instant filesystem copy server-side. fileParallelism stays
 * safe, and two local integration runs pointed at the same TEST_DATABASE_URL no
 * longer delete each other's template / worker DBs.
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

const MAX_POSTGRES_IDENTIFIER_LENGTH = 63;

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("_", "\\_").replaceAll("%", "\\%");
}

function makeDatabaseName(base: string, suffix: string): string {
  const raw = `${base}${suffix}`;
  if (raw.length <= MAX_POSTGRES_IDENTIFIER_LENGTH) return raw;

  const hash = shortHash(raw);
  const reserved = suffix.length + hash.length + 1;
  const prefixLength = Math.max(1, MAX_POSTGRES_IDENTIFIER_LENGTH - reserved);
  return `${base.slice(0, prefixLength)}_${hash}${suffix}`;
}

function createTestDatabaseRunId(): string {
  return `r${process.pid.toString(36)}${Date.now().toString(36).slice(-6)}`;
}

function getRunId(): string | null {
  const id = process.env.NP_TEST_DB_RUN_ID;
  return id && id.length > 0 ? id : null;
}

function ensureRunId(): string {
  const existing = getRunId();
  if (existing) return existing;
  const id = createTestDatabaseRunId();
  process.env.NP_TEST_DB_RUN_ID = id;
  return id;
}

function getRunSuffix(): string {
  const id = getRunId();
  return id ? `_${id}` : "";
}

function getTemplateDatabaseName(): string | null {
  const base = getBaseDatabaseName();
  return base ? makeDatabaseName(base, `${getRunSuffix()}_template`) : null;
}

function getWorkerSuffix(): string | null {
  const id = process.env.VITEST_POOL_ID;
  if (id) return `_w${id}`;
  return getRunId() ? "_single" : null;
}

export function getTestDatabaseUrl(): string | null {
  const u = parseBaseUrl();
  if (!u) return null;
  const suffix = getWorkerSuffix();
  if (!suffix) return u.toString();
  const base = u.pathname.replace(/^\//, "");
  u.pathname = `/${makeDatabaseName(base, `${getRunSuffix()}${suffix}`)}`;
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
 * When global setup assigned a run id but Vitest did not expose a
 * VITEST_POOL_ID, clone into a `_single` DB so the template-ready flag
 * still points at a migrated database.
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
  const workerDb = makeDatabaseName(base, `${getRunSuffix()}${suffix}`);

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const { rows } = await adminPool.query<{ exists: number }>(
      "SELECT 1 AS exists FROM pg_database WHERE datname = $1",
      [workerDb],
    );
    if (rows.length === 0) {
      // CREATE DATABASE doesn't accept parameter binds for identifiers.
      // Quote defensively because the base DB name comes from operator
      // configuration.
      await adminPool.query(
        `CREATE DATABASE ${quoteIdentifier(workerDb)} TEMPLATE ${quoteIdentifier(template)}`,
      );
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
 * tables already exist. When NP_TEST_TEMPLATE_READY=1 (set by the
 * global-setup hook), this becomes a no-op since the template DB was
 * already migrated and our worker DB is a clone.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  if (process.env.NP_TEST_TEMPLATE_READY === "1") {
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
    // `splitMigrationStatements` ignores marker text that appears
    // inside `--` line comments (the 0033 backtick-orphan trap).
    const statements = splitMigrationStatements(sql);

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
    "np_sessions",
    "np_revisions",
    "np_plugin_storage",
    "np_plugins",
    "np_worker_heartbeats",
    "np_job_logs",
    "np_import_runs",
    "np_settings",
    "np_navigation",
    "np_media_refs",
    "np_media",
    "np_media_folders",
    "np_user_oauth_identities",
    "np_users",
    // Community tables (Phase 9.1a+). Order doesn't matter under CASCADE
    // — listing them keeps RESTART IDENTITY consistent and the test DB
    // wipes cleanly between cases.
    "np_audit_events",
    "np_reports",
    "np_notifications",
    "np_follows",
    "np_reactions",
    "np_content_views",
    "np_comments",
    "np_bans",
    "np_member_roles",
    "np_member_identities",
    "np_member_sessions",
    "np_members",
    // Phase 15.5+ — multi-site residue. Without this, multi-site tests
    // (e.g. `multi-site-*`, the #218 per-site digest case) leave extra
    // rows in `np_sites` between tests in the same worker; subsequent
    // suites that depend on a clean single-tenant world (digest sweep,
    // anything iterating sites) then see ghost tenants and mis-count.
    // `np_sites` itself is handled below so the default row survives.
    "np_site_memberships",
  ];
  const list = tables.map((t) => `"${t}"`).join(", ");
  // CASCADE handles any FK holdouts. RESTART IDENTITY resets any sequences
  // (unused by the schema today but future-proof). Keep the site cleanup in
  // the same round trip; truncateAll() runs before almost every integration
  // case, so even small query-count savings add up.
  await pool.query(`
    TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;
    DELETE FROM "np_sites" WHERE id <> 'default';
    UPDATE "np_sites"
       SET "name" = 'Default site',
           "hostname" = NULL,
           "description" = NULL,
           "settings" = '{"siteUrl":null,"defaultLocale":null,"timezone":null}'::jsonb,
           "is_default" = true,
           "updated_at" = now()
     WHERE "id" = 'default';
  `);
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
 * integration configs. Assigns a per-run namespace, drops any leftover
 * worker DBs for that namespace, then recreates the namespaced template
 * database from the migration SQL files.
 * Idempotent. CREATE DATABASE … TEMPLATE only needs the caller to be the
 * template owner — we don't flag IS_TEMPLATE so this stays compatible
 * with managed Postgres (RDS / Cloud SQL) where pg_database catalog
 * writes require superuser.
 *
 * The LIKE pattern keys on the generated run id, so two local integration
 * runs pointed at the same TEST_DATABASE_URL do not drop each other's
 * worker databases.
 */
export async function prepareTemplateDatabase(): Promise<() => Promise<void>> {
  const baseUrl = process.env.TEST_DATABASE_URL;
  if (!baseUrl) {
    return async () => {
      /* no-op when integration tests are skipped wholesale */
    };
  }
  const runId = ensureRunId();
  const template = getTemplateDatabaseName()!;
  const adminUrl = getAdminDatabaseUrl()!;
  const workerLikePattern = `%${escapeLikePattern(`_${runId}_`)}%`;

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    // Sweep leftover worker DBs from a prior run, terminating any
    // dangling connections first so DROP doesn't wedge.
    const leftover = await adminPool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2",
      [workerLikePattern, template],
    );
    for (const { datname } of leftover.rows) {
      await adminPool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
        [datname],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(datname)}`);
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
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(template)}`);
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(template)}`);
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
      const statements = splitMigrationStatements(sql);
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

  process.env.NP_TEST_TEMPLATE_READY = "1";

  return async () => {
    // Teardown — drop worker DBs so the next run starts clean. Leave the
    // template in place for legacy non-namespaced runs; namespaced runs drop
    // their template too so normal local runs don't leave one database per run.
    const cleanupPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
    try {
      const { rows } = await cleanupPool.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2",
        [workerLikePattern, template],
      );
      for (const { datname } of rows) {
        await cleanupPool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
          [datname],
        );
        await cleanupPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(datname)}`);
      }
      if (runId) {
        await cleanupPool.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
          [template],
        );
        await cleanupPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(template)}`);
      }
    } finally {
      await cleanupPool.end();
    }
  };
}
