// Must be the first import — populates process.env before
// `nexpress.config.ts` evaluates. We deliberately don't import the
// nexpress runtime itself; doctor's job is to diagnose env problems
// that *prevent* boot, so it has to keep running when the boot path
// would crash.
import "./_load-env.js";

import { createRequire } from "node:module";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { messageForConnectionError } from "./setup-server-errors.js";
import { findFreePort } from "./setup-server-ports.js";
import {
  DEPLOY_TARGETS,
  inferDeployTargetFromEnv,
  parseDeployTargetArg,
} from "./deploy-targets.js";
import {
  buildDoctorJson,
  dim,
  renderBriefDoctorReport,
  renderDoctorCheck,
  renderDoctorFixPlan,
  renderDoctorNextCommand,
  renderDoctorSummary,
} from "./doctor-output.js";
import {
  checkJobsEnabledProd,
  checkMigrationStatusReadiness,
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

/**
 * `pnpm run doctor` — best-effort diagnosis of the env / runtime
 * surface NexPress depends on. Designed to give a new operator a
 * single command to answer "why doesn't `pnpm dev` work?" without
 * grepping through stack traces.
 *
 * Two modes:
 *   - default      dev-environment readiness; warns on production-y
 *                  misconfigurations because they don't block dev.
 *   - --prod       deploy-readiness dry-run. Promotes the warnings
 *                  that `verifyStartupSafety` would emit at boot to
 *                  errors so a CI gate fails before the bad config
 *                  ships. Add the flag to your release pipeline:
 *                  `pnpm run doctor --prod` exits non-zero on any
 *                  unsafe-for-production setting.
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

const ARGV = process.argv.slice(2);
const PROD_MODE = ARGV.includes("--prod");
const JSON_MODE = ARGV.includes("--json");
const FIX_PLAN_MODE = ARGV.includes("--fix-plan");
const BRIEF_MODE = ARGV.includes("--brief");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress doctor

Usage:
  pnpm run doctor
  pnpm run doctor -- --prod --target vercel
  pnpm run doctor:prod -- --target vercel --brief --no-color
  pnpm run doctor:prod -- --target vercel --fix-plan
  pnpm --silent run doctor:prod -- --target vercel --json --fix-plan

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --prod          Run production deploy-readiness checks.
  --target <host> Apply host-specific production checks.
  --json          Print the stable machine-readable readiness report.
  --fix-plan      Include ordered fix suggestions.
  --brief         Print compact one-line-per-check human output.
  --no-color      Disable ANSI color in human-readable output.
  --help, -h      Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

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

function checkNodeVersion(): CheckResult {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major) || major < 20) {
    return {
      id: "node.version",
      state: "error",
      label: "Node.js >= 20",
      detail: `running ${process.versions.node}`,
      hint: "NexPress requires Node 20+. Use nvm/asdf/fnm to upgrade.",
    };
  }
  return { id: "node.version", state: "ok", label: "Node.js >= 20", detail: process.versions.node };
}

function checkPnpmVersion(): CheckResult {
  // We check the version pnpm itself reports through `npm_config_user_agent`
  // when run via `pnpm run doctor`. Falls back to "unknown" in other shells —
  // a soft warn is enough; the real boot path would crash if pnpm were
  // wrong.
  const ua = process.env.npm_config_user_agent ?? "";
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
  if ((major ?? 0) < 10 || (major === 10 && (minor ?? 0) < 33)) {
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

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = resolve(process.cwd(), ".env");
  try {
    await access(envPath);
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

interface RequiredVarSpec {
  id: string;
  name: string;
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
    hint: "Set NP_SECRET to ≥32 random characters. `pnpm run setup` generates one.",
  },
  {
    id: "env.site_url",
    name: "SITE_URL",
    matches: /^https?:\/\//,
    hint: "Set SITE_URL to your public origin (e.g. http://localhost:3000).",
  },
];

function checkRequiredVar(spec: RequiredVarSpec): CheckResult {
  const value = process.env[spec.name];
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
    // In --prod mode a sub-floor secret is forgeable; surface as
    // error so a release gate can catch it. In dev mode it's a hint.
    return {
      id: spec.id,
      state: PROD_MODE ? "error" : "warn",
      label: spec.name,
      detail: `set but only ${value.length.toString()} chars (recommend ≥${spec.minLength.toString()})`,
      hint: spec.hint,
    };
  }
  return { id: spec.id, state: "ok", label: spec.name };
}

async function loadPg(): Promise<unknown> {
  // `pg` ships transitively via `@nexpress/core`. tsx's dynamic
  // import doesn't resolve transitives at the consumer layer, so
  // we widen the search via createRequire (which honors Node's
  // full module resolution including pnpm's hoisted store) and
  // hand the path back to the dynamic import. We anchor on the
  // project root (cwd) so this works whether the file lives in
  // apps/web/scripts/ or node_modules/@nexpress/app/src/scripts/.
  const require = createRequire(resolve(process.cwd(), "package.json"));
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
    // Reuse the wizard's friendly error decoder so `pnpm run doctor` and
    // the browser wizard speak the same language on the common
    // first-boot failure shapes (3D000 / 28P01 / 28000 / ECONNREFUSED).
    // For port-collision codes also scan for a free port nearby so
    // the message includes a concrete `Detected free port: <N>`
    // recommendation. The base `detail` carries the rich, multi-line
    // message; the canned `hint` field stays empty here because the
    // message already names the fix.
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
        // Unparseable URL — skip the scan; the message handles the
        // fallback placeholders.
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

async function checkLocalStorage(): Promise<CheckResult> {
  const adapter = (process.env.NP_STORAGE_ADAPTER ?? "local").toLowerCase();
  if (adapter !== "local") {
    // S3 / R2 connectivity check would need the AWS SDK + credentials;
    // we leave that surface to runtime errors for now.
    return {
      id: "storage.adapter",
      state: "ok",
      label: `Storage adapter: ${adapter}`,
      detail: "S3-side checks not run",
    };
  }
  const dir = process.env.NP_STORAGE_DIR ?? "./public/media";
  const path = resolve(process.cwd(), dir);
  try {
    const stats = await stat(path);
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

function checkS3Vars(): CheckResult | null {
  if ((process.env.NP_STORAGE_ADAPTER ?? "").toLowerCase() !== "s3") return null;
  const missing: string[] = [];
  if (!process.env.NP_S3_BUCKET) missing.push("NP_S3_BUCKET");
  if (!process.env.NP_S3_REGION) missing.push("NP_S3_REGION");
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

async function checkMigrationsApplied(prodMode: boolean): Promise<CheckResult> {
  const url = process.env.DATABASE_URL;
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
      let statusCheck: CheckResult;
      try {
        const local = readLocalMigrationEntries("./drizzle");
        const applied = await readAppliedMigrations(client);
        statusCheck = checkMigrationStatusReadiness(prodMode, buildMigrationStatus(local, applied));
      } catch (err) {
        statusCheck = {
          id: "migrations.applied",
          state: prodMode ? "error" : "warn",
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

function checkEnvExampleSync(): CheckResult {
  // Soft check — flag obvious placeholders that survived a manual edit.
  const value = process.env.NP_SECRET ?? "";
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

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const deployTarget = PROD_MODE
    ? (parseDeployTargetArg(ARGV) ?? inferDeployTargetFromEnv())
    : null;
  if (PROD_MODE && !JSON_MODE && !BRIEF_MODE) {
    const targetDetail = deployTarget ? ` for ${deployTarget}` : "";
    console.log(dim(`Running in --prod mode${targetDetail}: deploy-readiness checks.`, COLOR_MODE));
    console.log("");
  }
  const checks: Array<CheckResult> = [];
  checks.push(checkNodeVersion());
  checks.push(checkPnpmVersion());
  checks.push(await checkEnvFile());
  for (const spec of REQUIRED_VARS) checks.push(checkRequiredVar(spec));
  checks.push(checkEnvExampleSync());
  const s3 = checkS3Vars();
  if (s3) checks.push(s3);
  checks.push(await checkLocalStorage());
  checks.push(await checkDatabase());
  checks.push(await checkMigrationsApplied(PROD_MODE));
  // Production-only checks. Each returns null in dev mode so the
  // dev-default doctor output is unchanged.
  for (const result of [
    checkSecretLengthProd(PROD_MODE, process.env),
    checkJobsEnabledProd(PROD_MODE, process.env),
    checkStorageProd(PROD_MODE, deployTarget, process.env),
    ...checkTargetDatabaseProd(PROD_MODE, deployTarget, process.env),
    ...checkTargetStorageProd(PROD_MODE, deployTarget, process.env),
    checkSiteUrlProd(PROD_MODE, process.env),
    ...checkTargetSiteUrlProd(PROD_MODE, deployTarget, process.env),
    checkSchedulerTokenProd(PROD_MODE, process.env),
    ...checkTargetWorkerProd(PROD_MODE, deployTarget, process.env),
  ]) {
    if (result) checks.push(result);
  }

  const report = buildDoctorJson({
    prodMode: PROD_MODE,
    target: deployTarget,
    checks,
    includeFixPlan: FIX_PLAN_MODE,
  });
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else if (BRIEF_MODE) {
    console.log(
      renderBriefDoctorReport(
        {
          prodMode: PROD_MODE,
          target: deployTarget,
          checks,
          nextCommand: FIX_PLAN_MODE ? null : report.nextCommand,
        },
        { color: COLOR_MODE },
      ),
    );
    if (FIX_PLAN_MODE) {
      console.log("");
      console.log(renderDoctorFixPlan(report.fixPlan ?? [], { color: COLOR_MODE }));
    }
  } else {
    for (const result of checks) console.log(renderDoctorCheck(result, { color: COLOR_MODE }));
    console.log("");
    console.log(renderDoctorSummary(checks, { color: COLOR_MODE }));
    if (FIX_PLAN_MODE) {
      console.log("");
      console.log(renderDoctorFixPlan(report.fixPlan ?? [], { color: COLOR_MODE }));
    } else {
      const nextLine = renderDoctorNextCommand(report.nextCommand, { color: COLOR_MODE });
      if (nextLine) console.log(nextLine);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

// Touch readFile so the linter doesn't complain about an unused import
// (we leave it imported in case future checks read a config file).
void readFile;

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
