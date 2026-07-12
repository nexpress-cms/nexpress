import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { npAnalyzeSettingValue, npAnalyzeSiteRecord } from "@nexpress/core/settings";

import { inferDeployTargetFromEnv, type DeployTarget } from "./deploy-targets.js";
import { buildDoctorJson, type DoctorJsonOutput } from "./doctor-output.js";
import {
  checkJobsEnabledProd,
  checkMigrationStatusReadiness,
  checkOAuthEnvPairs,
  checkSchedulerTokenProd,
  checkSecretLengthProd,
  checkSiteUrlProd,
  checkStorageProd,
  checkTargetDatabaseProd,
  checkTargetSiteUrlProd,
  checkTargetStorageProd,
  checkTargetWorkerProd,
  type CheckResult,
} from "./doctor-readiness.js";
import {
  buildMigrationStatus,
  readAppliedMigrations,
  readLocalMigrationEntries,
} from "./migration-status.js";
import { messageForConnectionError } from "./setup-server-errors.js";
import { findFreePort } from "./setup-server-ports.js";

type DoctorEnv = Record<string, string | undefined>;

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: {
      connectionString: string;
      connectionTimeoutMillis?: number;
    }) => PgClientLike;
  };
}

export interface CollectDoctorOptions {
  prodMode?: boolean;
  target?: DeployTarget | null;
  includeFixPlan?: boolean;
  env?: DoctorEnv;
  cwd?: string;
  nodeVersion?: string;
}

interface RequiredVarSpec {
  id: string;
  name: "DATABASE_URL" | "NP_SECRET" | "SITE_URL";
  minLength?: number;
  matches?: RegExp;
  hint: string;
}

const REQUIRED_VARS: RequiredVarSpec[] = [
  {
    id: "env.database_url",
    name: "DATABASE_URL",
    matches: /^postgres(?:ql)?:\/\//,
    hint: "Set DATABASE_URL to a postgres:// connection string. `pnpm run setup` writes one for you.",
  },
  {
    id: "env.np_secret",
    name: "NP_SECRET",
    minLength: 32,
    hint: "Set NP_SECRET to >=32 random characters. `pnpm run setup` generates one.",
  },
  {
    id: "env.site_url",
    name: "SITE_URL",
    matches: /^https?:\/\//,
    hint: "Set SITE_URL to your public origin (e.g. http://localhost:3000).",
  },
];

export async function collectDoctorChecks(
  options: CollectDoctorOptions = {},
): Promise<CheckResult[]> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const prodMode = options.prodMode ?? false;
  const target = options.target ?? (prodMode ? inferDeployTargetFromEnv(env) : null);
  const checks: CheckResult[] = [
    checkNodeVersion(options.nodeVersion ?? process.versions.node),
    checkPnpmVersion(env),
    await checkEnvFile(cwd),
  ];

  for (const spec of REQUIRED_VARS) checks.push(checkRequiredVar(spec, prodMode, env));
  checks.push(checkEnvExampleSync(env));
  const s3 = checkS3Vars(env);
  if (s3) checks.push(s3);
  checks.push(...checkOAuthEnvPairs(env));
  checks.push(await checkLocalStorage(env, cwd));
  checks.push(await checkDatabase(env));
  checks.push(await checkSettingsContracts(env));
  checks.push(await checkMigrationsApplied({ prodMode, env, cwd }));

  for (const result of [
    checkSecretLengthProd(prodMode, env),
    checkJobsEnabledProd(prodMode, env),
    checkStorageProd(prodMode, target, env),
    ...checkTargetDatabaseProd(prodMode, target, env),
    ...checkTargetStorageProd(prodMode, target, env),
    checkSiteUrlProd(prodMode, env),
    ...checkTargetSiteUrlProd(prodMode, target, env),
    checkSchedulerTokenProd(prodMode, env),
    ...checkTargetWorkerProd(prodMode, target, env),
  ]) {
    if (result) checks.push(result);
  }

  return checks;
}

export async function collectDoctorReport(
  options: CollectDoctorOptions = {},
): Promise<DoctorJsonOutput> {
  const prodMode = options.prodMode ?? false;
  const env = options.env ?? process.env;
  const target = options.target ?? (prodMode ? inferDeployTargetFromEnv(env) : null);
  return buildDoctorJson({
    prodMode,
    target,
    checks: await collectDoctorChecks({ ...options, prodMode, target, env }),
    includeFixPlan: options.includeFixPlan,
  });
}

function checkNodeVersion(version: string): CheckResult {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 20) {
    return {
      id: "node.version",
      state: "error",
      label: "Node.js >= 20",
      detail: `running ${version}`,
      hint: "NexPress requires Node 20+. Use nvm/asdf/fnm to upgrade.",
    };
  }
  return { id: "node.version", state: "ok", label: "Node.js >= 20", detail: version };
}

function checkPnpmVersion(env: DoctorEnv): CheckResult {
  const ua = env.npm_config_user_agent ?? "";
  const match = /pnpm\/([\d.]+)/.exec(ua);
  if (!match) {
    return {
      id: "pnpm.version",
      state: "warn",
      label: "pnpm 10.33+",
      detail: "couldn't read pnpm version from env",
      hint: "Run via `pnpm run doctor` (not `node scripts/doctor.ts`) for a real check.",
    };
  }
  const version = match[1] ?? "";
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (major < 10 || (major === 10 && minor < 33)) {
    return {
      id: "pnpm.version",
      state: "error",
      label: "pnpm 10.33+",
      detail: `running ${match[1]}`,
      hint: "Run `npm i -g pnpm@10.33` (or follow https://pnpm.io/installation).",
    };
  }
  return { id: "pnpm.version", state: "ok", label: "pnpm 10.33+", detail: match[1] };
}

async function checkEnvFile(cwd: string): Promise<CheckResult> {
  const envPath = resolve(/* turbopackIgnore: true */ cwd, ".env");
  try {
    await access(/* turbopackIgnore: true */ envPath);
    return { id: "env.file", state: "ok", label: ".env file present" };
  } catch {
    return {
      id: "env.file",
      state: "error",
      label: ".env file present",
      hint: "Run `pnpm run setup` (browser env wizard) or copy .env.example to .env.",
    };
  }
}

function checkRequiredVar(spec: RequiredVarSpec, prodMode: boolean, env: DoctorEnv): CheckResult {
  const value = env[spec.name];
  if (!value) {
    return {
      id: spec.id,
      state: "error",
      label: spec.name,
      detail: "not set",
      hint: spec.hint,
    };
  }
  if (spec.matches && !spec.matches.test(value)) {
    return {
      id: spec.id,
      state: "error",
      label: spec.name,
      detail: "set but doesn't match expected shape",
      hint: spec.hint,
    };
  }
  if (spec.minLength && value.length < spec.minLength) {
    return {
      id: spec.id,
      state: prodMode ? "error" : "warn",
      label: spec.name,
      detail: `set but only ${value.length.toString()} chars (recommend >=${spec.minLength.toString()})`,
      hint: spec.hint,
    };
  }
  return { id: spec.id, state: "ok", label: spec.name };
}

async function loadPg(): Promise<unknown> {
  return import("pg");
}

async function checkDatabase(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: "DATABASE_URL not set",
      hint: "Set DATABASE_URL first; doctor can't probe a connection without one.",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "database.reachable",
      state: "warn",
      label: "Postgres reachable",
      detail: "`pg` not installed in this workspace yet",
      hint: "Run `pnpm install` first.",
    };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ version: string }>("select version()");
    await client.end();
    const version = result.rows[0]?.version?.split(" ").slice(0, 2).join(" ") ?? "Postgres";
    return { id: "database.reachable", state: "ok", label: "Postgres reachable", detail: version };
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    const code = (err as { code?: unknown } | null)?.code;
    let suggestedPort: number | null = null;
    if (code === "28P01" || code === "28000") {
      try {
        const parsed = new URL(url);
        const failingPort = parsed.port ? Number(parsed.port) : NaN;
        if (Number.isInteger(failingPort) && failingPort > 0 && failingPort < 65536) {
          suggestedPort = await findFreePort(failingPort + 1);
        }
      } catch {
        /* skip scan */
      }
    }
    return {
      id: "database.reachable",
      state: "error",
      label: "Postgres reachable",
      detail: messageForConnectionError(url, err, { suggestedPort }),
    };
  }
}

async function checkSettingsContracts(env: DoctorEnv): Promise<CheckResult> {
  const url = env.DATABASE_URL;
  if (!url) {
    return {
      id: "settings.contract",
      state: "warn",
      label: "Framework settings contracts",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "settings.contract",
      state: "warn",
      label: "Framework settings contracts",
      detail: "skipped (no `pg`)",
    };
  }
  const client = new pg.default.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const [sites, settings] = await Promise.all([
      client.query<Record<string, unknown>>(
        `select id, name, hostname, description, settings, is_default as "isDefault",
                created_at as "createdAt", updated_at as "updatedAt"
           from np_sites`,
      ),
      client.query<{ siteId: string; key: string; value: unknown }>(
        `select site_id as "siteId", key, value from np_settings`,
      ),
    ]);
    await client.end();
    const issues = [
      ...sites.rows.flatMap((site) => npAnalyzeSiteRecord(site)),
      ...settings.rows.flatMap((row) => npAnalyzeSettingValue(row.key, row.value)),
    ];
    return issues.length === 0
      ? {
          id: "settings.contract",
          state: "ok",
          label: "Framework settings contracts",
          detail: `${sites.rows.length.toString()} site(s), ${settings.rows.length.toString()} setting row(s)`,
        }
      : {
          id: "settings.contract",
          state: "error",
          label: "Framework settings contracts",
          detail: `${issues.length.toString()} contract issue(s); first: ${issues[0]?.path ?? "settings"} ${issues[0]?.message ?? "invalid"}`,
          hint: "Repair or remove malformed/unknown np_sites and np_settings values before starting the app.",
        };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "settings.contract",
      state: "warn",
      label: "Framework settings contracts",
      detail: `could not inspect settings: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkLocalStorage(env: DoctorEnv, cwd: string): Promise<CheckResult> {
  const adapter = (env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  if (adapter !== "local") {
    return {
      id: "storage.adapter",
      state: "ok",
      label: `Storage adapter: ${adapter}`,
      detail: "S3-side checks not run",
    };
  }
  const dir = env.NP_STORAGE_DIR ?? "./public/media";
  const path = resolve(/* turbopackIgnore: true */ cwd, dir);
  try {
    const stats = await stat(/* turbopackIgnore: true */ path);
    if (!stats.isDirectory()) {
      return {
        id: "storage.local_directory",
        state: "error",
        label: "Local storage directory",
        detail: `${dir} exists but is not a directory`,
        hint: "Move the file aside or pick a different NP_STORAGE_DIR.",
      };
    }
    return {
      id: "storage.local_directory",
      state: "ok",
      label: "Local storage directory",
      detail: dir,
    };
  } catch {
    return {
      id: "storage.local_directory",
      state: "warn",
      label: "Local storage directory",
      detail: `${dir} doesn't exist yet`,
      hint: "Will be created on first upload; create it manually if your env is read-only.",
    };
  }
}

function checkS3Vars(env: DoctorEnv): CheckResult | null {
  if ((env.NP_STORAGE_ADAPTER ?? "").toLowerCase() !== "s3") return null;
  const missing: string[] = [];
  if (!env.NP_S3_BUCKET) missing.push("NP_S3_BUCKET");
  if (!env.NP_S3_REGION) missing.push("NP_S3_REGION");
  if (missing.length > 0) {
    return {
      id: "storage.s3_settings",
      state: "error",
      label: "S3 settings",
      detail: `missing ${missing.join(", ")}`,
      hint: "Re-run `pnpm run setup` and pick S3 to fill these in.",
    };
  }
  return { id: "storage.s3_settings", state: "ok", label: "S3 settings" };
}

async function checkMigrationsApplied(args: {
  prodMode: boolean;
  env: DoctorEnv;
  cwd: string;
}): Promise<CheckResult> {
  const url = args.env.DATABASE_URL;
  if (!url) {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no DATABASE_URL)",
    };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "skipped (no `pg`)",
    };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('np_users', 'np_settings', 'np_navigation', 'np_sites')`,
    );
    const expected = ["np_users", "np_settings", "np_navigation", "np_sites"];
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = expected.filter((t) => !present.has(t));
    if (missing.length === 0) {
      let statusCheck: CheckResult;
      try {
        const local = readLocalMigrationEntries(
          resolve(/* turbopackIgnore: true */ args.cwd, "drizzle"),
        );
        const applied = await readAppliedMigrations(client);
        statusCheck = checkMigrationStatusReadiness(
          args.prodMode,
          buildMigrationStatus(local, applied),
        );
      } catch (err) {
        statusCheck = {
          id: "migrations.applied",
          state: args.prodMode ? "error" : "warn",
          label: "Migrations applied",
          detail: `framework tables found; status unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`,
          hint: "Run `pnpm db:migrate -- --status` for a dedicated migration status report.",
        };
      }
      await client.end();
      return statusCheck;
    }
    const trackingTable = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from information_schema.tables
         where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
       ) as exists`,
    );
    let trackedCount = 0;
    if (trackingTable.rows[0]?.exists) {
      const tracked = await client.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      );
      trackedCount = Number.parseInt(tracked.rows[0]?.count ?? "0", 10) || 0;
    }
    await client.end();
    if (trackedCount > 0) {
      return {
        id: "migrations.applied",
        state: "error",
        label: "Migrations applied",
        detail: `drizzle tracks ${trackedCount.toString()} applied, but framework tables are missing`,
        hint:
          "Stale tracking from a partial drop. Reset both schemas, then re-migrate:\n" +
          "      docker compose exec db psql -U nexpress -d nexpress -c \\\n" +
          '        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"\n' +
          "      pnpm db:migrate",
      };
    }
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: `missing ${missing.join(", ")}`,
      hint: "Run `pnpm db:generate && pnpm db:migrate` (or finish `pnpm run setup` with the auto-migrate option).",
    };
  } catch {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      id: "migrations.applied",
      state: "warn",
      label: "Migrations applied",
      detail: "could not query schema",
    };
  }
}

function checkEnvExampleSync(env: DoctorEnv): CheckResult {
  const value = env.NP_SECRET ?? "";
  if (value === "change-me-in-production" || value === "change-me-to-a-random-string") {
    return {
      id: "env.np_secret_placeholder",
      state: "error",
      label: "NP_SECRET not the placeholder",
      detail: "still the .env.example placeholder",
      hint: "Replace with a real secret. `pnpm run setup` generates one.",
    };
  }
  return { id: "env.np_secret_placeholder", state: "ok", label: "NP_SECRET not the placeholder" };
}
