// Must be the first import — populates process.env before
// `nexpress.config.ts` evaluates. We deliberately don't import the
// nexpress runtime itself; doctor's job is to diagnose env problems
// that *prevent* boot, so it has to keep running when the boot path
// would crash.
import "./_load-env.js";

import { createRequire } from "node:module";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * `pnpm doctor` — best-effort diagnosis of the env / runtime
 * surface NexPress depends on. Designed to give a new operator a
 * single command to answer "why doesn't `pnpm dev` work?" without
 * grepping through stack traces.
 *
 * Each check returns one of three states:
 *   - ok       a green ✓ line; nothing for the operator to do
 *   - warn     a yellow ⚠ line; the install will probably work but
 *              something looks off (e.g. NP_SECRET shorter than the
 *              recommended floor)
 *   - error    a red ✗ line plus an actionable hint; the install
 *              won't boot until the operator fixes it
 *
 * Exit code: 0 if every check passed without an error, 1 otherwise.
 * Warnings don't fail the run — operators who know what they're
 * doing shouldn't have to silence them in CI.
 */

interface CheckResult {
  state: "ok" | "warn" | "error";
  label: string;
  detail?: string;
  hint?: string;
}

interface PgClientLike {
  connect(): Promise<void>;
  query<T = unknown>(text: string): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: { connectionString: string; connectionTimeoutMillis?: number }) => PgClientLike;
  };
}

async function checkNodeVersion(): Promise<CheckResult> {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 20) {
    return {
      state: "error",
      label: "Node.js >= 20",
      detail: `running ${process.versions.node}`,
      hint: "NexPress requires Node 20+. Use nvm/asdf/fnm to upgrade.",
    };
  }
  return { state: "ok", label: "Node.js >= 20", detail: process.versions.node };
}

async function checkPnpmVersion(): Promise<CheckResult> {
  // We check the version pnpm itself reports through `npm_config_user_agent`
  // when run via `pnpm doctor`. Falls back to "unknown" in other shells —
  // a soft warn is enough; the real boot path would crash if pnpm were
  // wrong.
  const ua = process.env.npm_config_user_agent ?? "";
  const match = /pnpm\/([\d.]+)/.exec(ua);
  if (!match) {
    return {
      state: "warn",
      label: "pnpm 10.33+",
      detail: "couldn't read pnpm version from env",
      hint: "Run via `pnpm doctor` (not `node scripts/doctor.ts`) for a real check.",
    };
  }
  const [major, minor] = match[1]!.split(".").map((n) => Number.parseInt(n, 10));
  if ((major ?? 0) < 10 || ((major === 10) && (minor ?? 0) < 33)) {
    return {
      state: "error",
      label: "pnpm 10.33+",
      detail: `running ${match[1]}`,
      hint: "Run `npm i -g pnpm@10.33` (or follow https://pnpm.io/installation).",
    };
  }
  return { state: "ok", label: "pnpm 10.33+", detail: match[1] };
}

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = resolve(process.cwd(), ".env");
  try {
    await access(envPath);
    return { state: "ok", label: ".env file present" };
  } catch {
    return {
      state: "error",
      label: ".env file present",
      hint: "Run `pnpm run setup` (browser env wizard) or copy .env.example to .env.",
    };
  }
}

interface RequiredVarSpec {
  name: string;
  minLength?: number;
  matches?: RegExp;
  hint: string;
}

const REQUIRED_VARS: RequiredVarSpec[] = [
  {
    name: "DATABASE_URL",
    matches: /^postgres(?:ql)?:\/\//,
    hint: "Set DATABASE_URL to a postgres:// connection string. `pnpm run setup` writes one for you.",
  },
  {
    name: "NP_SECRET",
    minLength: 32,
    hint: "Set NP_SECRET to ≥32 random characters. `pnpm run setup` generates one.",
  },
  {
    name: "SITE_URL",
    matches: /^https?:\/\//,
    hint: "Set SITE_URL to your public origin (e.g. http://localhost:3000).",
  },
];

function checkRequiredVar(spec: RequiredVarSpec): CheckResult {
  const value = process.env[spec.name];
  if (!value) {
    return {
      state: "error",
      label: spec.name,
      detail: "not set",
      hint: spec.hint,
    };
  }
  if (spec.matches && !spec.matches.test(value)) {
    return {
      state: "error",
      label: spec.name,
      detail: "set but doesn't match expected shape",
      hint: spec.hint,
    };
  }
  if (spec.minLength && value.length < spec.minLength) {
    return {
      state: "warn",
      label: spec.name,
      detail: `set but only ${value.length.toString()} chars (recommend ≥${spec.minLength.toString()})`,
      hint: spec.hint,
    };
  }
  return { state: "ok", label: spec.name };
}

async function loadPg(): Promise<unknown> {
  // `pg` ships transitively via `@nexpress/core`. tsx's dynamic
  // import doesn't resolve transitives at the apps/web layer, so
  // we widen the search via createRequire (which honors Node's
  // full module resolution including pnpm's hoisted store) and
  // hand the path back to the dynamic import.
  const require = createRequire(import.meta.url);
  let resolved: string;
  try {
    resolved = require.resolve("pg");
  } catch {
    throw new Error("`pg` not found");
  }
  return import(resolved);
}

async function checkDatabase(): Promise<CheckResult> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return {
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
    return { state: "ok", label: "Postgres reachable", detail: version };
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      state: "error",
      label: "Postgres reachable",
      detail: err instanceof Error ? err.message : String(err),
      hint: "Confirm `docker compose up -d db` is running and DATABASE_URL points at it.",
    };
  }
}

async function checkLocalStorage(): Promise<CheckResult> {
  const adapter = (process.env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  if (adapter !== "local") {
    // S3 / R2 connectivity check would need the AWS SDK + credentials;
    // we leave that surface to runtime errors for now.
    return { state: "ok", label: `Storage adapter: ${adapter}`, detail: "S3-side checks not run" };
  }
  const dir = process.env.NP_STORAGE_DIR ?? "./public/media";
  const path = resolve(process.cwd(), dir);
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return {
        state: "error",
        label: "Local storage directory",
        detail: `${dir} exists but is not a directory`,
        hint: "Move the file aside or pick a different NP_STORAGE_DIR.",
      };
    }
    return { state: "ok", label: "Local storage directory", detail: dir };
  } catch {
    return {
      state: "warn",
      label: "Local storage directory",
      detail: `${dir} doesn't exist yet`,
      hint: "Will be created on first upload; create it manually if your env is read-only.",
    };
  }
}

async function checkS3Vars(): Promise<CheckResult | null> {
  if ((process.env.NP_STORAGE_ADAPTER ?? "").toLowerCase() !== "s3") return null;
  const missing: string[] = [];
  if (!process.env.NP_S3_BUCKET) missing.push("NP_S3_BUCKET");
  if (!process.env.NP_S3_REGION) missing.push("NP_S3_REGION");
  if (missing.length > 0) {
    return {
      state: "error",
      label: "S3 settings",
      detail: `missing ${missing.join(", ")}`,
      hint: "Re-run `pnpm run setup` and pick S3 to fill these in.",
    };
  }
  return { state: "ok", label: "S3 settings" };
}

async function checkMigrationsApplied(): Promise<CheckResult> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return { state: "warn", label: "Migrations applied", detail: "skipped (no DATABASE_URL)" };
  }
  let pg: PgModuleLike;
  try {
    pg = (await loadPg()) as PgModuleLike;
  } catch {
    return { state: "warn", label: "Migrations applied", detail: "skipped (no `pg`)" };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    // drizzle-kit's migration-tracking schema is configurable, so we
    // can't probe it directly. Instead, check for the four framework
    // tables the very first migration ships. Mirrors
    // apps/web/src/lib/system-health.ts so CLI doctor and
    // /admin/health agree on what "migrations applied" means.
    const result = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('np_users', 'np_settings', 'np_navigation', 'np_sites')`,
    );
    const expected = ["np_users", "np_settings", "np_navigation", "np_sites"];
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = expected.filter((t) => !present.has(t));
    if (missing.length === 0) {
      await client.end();
      return {
        state: "ok",
        label: "Migrations applied",
        detail: `${expected.length.toString()} framework tables found`,
      };
    }
    // Stale-tracking footgun (the case that bit us live): a partial
    // \`DROP TABLE\` / \`DROP SCHEMA public\` clears the framework
    // tables but leaves \`drizzle.__drizzle_migrations\` rows behind,
    // so the next \`pnpm db:migrate\` thinks nothing's pending and
    // exits "successfully" without actually creating anything. Probe
    // for that specific shape so we can hand back an actionable hint
    // instead of the generic "Run db:migrate".
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
    return { state: "warn", label: "Migrations applied", detail: "could not query schema" };
  }
}

async function checkEnvExampleSync(): Promise<CheckResult> {
  // Soft check — flag obvious placeholders that survived a manual edit.
  const value = process.env.NP_SECRET ?? "";
  if (value === "change-me-in-production" || value === "change-me-to-a-random-string") {
    return {
      state: "error",
      label: "NP_SECRET not the placeholder",
      detail: "still the .env.example placeholder",
      hint: "Replace with a real secret. `pnpm run setup` generates one.",
    };
  }
  return { state: "ok", label: "NP_SECRET not the placeholder" };
}

const COLOR = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function render(result: CheckResult): string {
  const icon =
    result.state === "ok"
      ? `${COLOR.green}✓${COLOR.reset}`
      : result.state === "warn"
        ? `${COLOR.yellow}⚠${COLOR.reset}`
        : `${COLOR.red}✗${COLOR.reset}`;
  let line = `${icon} ${result.label}`;
  if (result.detail) line += `  ${COLOR.dim}${result.detail}${COLOR.reset}`;
  if (result.hint && result.state !== "ok") line += `\n    ${result.hint}`;
  return line;
}

async function main(): Promise<void> {
  const checks: Array<CheckResult> = [];
  checks.push(await checkNodeVersion());
  checks.push(await checkPnpmVersion());
  checks.push(await checkEnvFile());
  for (const spec of REQUIRED_VARS) checks.push(checkRequiredVar(spec));
  checks.push(await checkEnvExampleSync());
  const s3 = await checkS3Vars();
  if (s3) checks.push(s3);
  checks.push(await checkLocalStorage());
  checks.push(await checkDatabase());
  checks.push(await checkMigrationsApplied());

  for (const r of checks) console.log(render(r));

  const failed = checks.filter((r) => r.state === "error").length;
  const warned = checks.filter((r) => r.state === "warn").length;
  console.log("");
  if (failed === 0 && warned === 0) {
    console.log(`${COLOR.green}All ${checks.length.toString()} checks passed.${COLOR.reset}`);
  } else {
    console.log(
      `${failed.toString()} error${failed === 1 ? "" : "s"}, ${warned.toString()} warning${warned === 1 ? "" : "s"}.`,
    );
  }
  process.exit(failed > 0 ? 1 : 0);
}

// Touch readFile so the linter doesn't complain about an unused import
// (we leave it imported in case future checks read a config file).
void readFile;

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
