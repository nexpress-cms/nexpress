/**
 * `pnpm run setup` — first-run env wizard.
 *
 * The Next.js app can't host a true env wizard: nexpress.config.ts
 * validates `auth.secret` / `DATABASE_URL` on module load, so the
 * page that would collect those values is exactly the page Next
 * refuses to render without them. This script sidesteps the
 * chicken-and-egg by booting a tiny `node:http` server that
 * doesn't import any NexPress runtime: it serves one HTML form,
 * accepts the form's POST, writes `.env`, optionally runs
 * `db:generate` + `db:migrate`, optionally creates the first
 * admin / activates a theme / seeds demo content, then exits.
 *
 * Hard guards (the server is otherwise the keys to the kingdom):
 *   - binds 127.0.0.1 only
 *   - URL-bound random token; every request validates it
 *   - existing `.env` is renamed to `.env.bak` before the new one
 *     lands so a botched submit never destroys an operator's prior
 *     config
 *   - `Test connection` runs `pg` server-side using whatever URL
 *     the form currently has, so the operator gets a green check
 *     before they save
 */

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type { QueryResultRow } from "pg";
import {
  buildMigrationStatus,
  migrationStatusHasBlockingRisk,
  readAppliedMigrations,
  readLocalMigrationEntries,
  renderMigrationStatus,
  type MigrationStatus,
} from "./migration-status.js";

/**
 * `PROJECT_DIR` is the project root — where `package.json` lives.
 * We anchor on `process.cwd()` (not `import.meta.url`) so this
 * script works identically when invoked from `apps/web/` in the
 * monorepo or from a scaffolded project that loads it through
 * `@nexpress/app/scripts/setup-server`. `pnpm` always runs
 * package scripts with cwd set to the package root.
 *
 * `NP_SETUP_ENV_PATH` overrides the `.env` destination — apps/web
 * sets it to `../../.env` so the wizard writes to the monorepo
 * root (matching the shared dev convention) instead of the
 * package-local `.env` that doesn't exist there.
 */
const PROJECT_DIR = process.cwd();
const ENV_PATH = resolve(PROJECT_DIR, process.env.NP_SETUP_ENV_PATH ?? ".env");
const MIGRATIONS_FOLDER = "./drizzle";

// Default Postgres database name = project directory name,
// sanitized to lowercase + underscores. Each scaffolded project
// gets its own DB so two projects on the same machine (or the
// scaffold + the monorepo dev DB) don't clobber each other's
// migration tracking.
//
// `NP_SETUP_DB_NAME` is the wrapper escape hatch: the monorepo's
// `apps/web` setup script sets it to `nexpress` so the wizard
// default matches the repo's checked-in `docker/docker-compose.yml`
// (POSTGRES_DB=nexpress) and `.env.example` (DATABASE_URL=…/nexpress).
// Without the override the wizard would default to `web` (the dir
// name), creating a DB the compose stack never provisions.
// Scaffolded projects don't set this — basename derivation gives
// each scaffold its own DB matching its own `docker-compose.yml`
// (the CLI templates the same project name into both).
const DEFAULT_DB_NAME =
  process.env.NP_SETUP_DB_NAME ||
  basename(PROJECT_DIR)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") ||
  "nexpress";
const DEFAULT_DATABASE_URL = `postgres://nexpress:nexpress@localhost:5433/${DEFAULT_DB_NAME}`;
const DEFAULT_TEST_DATABASE_URL = `postgres://nexpress:nexpress@localhost:5433/${DEFAULT_DB_NAME}_test`;

interface FormDefaults {
  databaseUrl: string;
  testDatabaseUrl: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
}

type SetupTaskId =
  | "env"
  | "database"
  | "generate"
  | "status"
  | "migrate"
  | "admin"
  | "theme"
  | "seed";

interface SetupStepResult {
  ok: boolean;
  output: string;
  failedTask?: SetupTaskId;
  skipped?: boolean;
  skippedTasks?: SetupTaskId[];
}

const FALLBACK_FORM_DEFAULTS: FormDefaults = {
  databaseUrl: DEFAULT_DATABASE_URL,
  testDatabaseUrl: DEFAULT_TEST_DATABASE_URL,
  dbHost: "localhost",
  dbPort: "5433",
  dbName: DEFAULT_DB_NAME,
};

/**
 * Reads the existing `.env` (if present) and projects the values
 * the setup form cares about onto `FormDefaults`. Falls back to
 * the hardcoded `FALLBACK_FORM_DEFAULTS` whenever a field is
 * missing or unparseable.
 *
 * Why this exists: `create-nexpress` writes a project-derived
 * `NEXPRESS_DB_PORT` (and a matching DATABASE_URL port) at
 * scaffold time so two scaffolds on the same machine don't
 * collide on host port 5433. The wizard form used to hardcode
 * 5433; submitting it would overwrite the scaffold's port with
 * the default and break the operator's already-running
 * `docker compose up`. Reading the existing env at form-render
 * time keeps the wizard consistent with what the scaffolder
 * picked.
 */
async function getFormDefaults(): Promise<FormDefaults> {
  let raw: string;
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    return FALLBACK_FORM_DEFAULTS;
  }
  const lines = raw.split(/\r?\n/);
  const find = (key: string): string | null => {
    const prefix = `${key}=`;
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };
  const databaseUrl = find("DATABASE_URL") ?? FALLBACK_FORM_DEFAULTS.databaseUrl;
  const envPort = find("NEXPRESS_DB_PORT");
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    // Malformed DATABASE_URL — keep the textbox value (operator
    // can fix it inline) but fall back on the discrete fields.
  }
  const dbHost = parsedUrl?.hostname || FALLBACK_FORM_DEFAULTS.dbHost;
  const dbPortFromUrl = parsedUrl?.port || "";
  const dbPort = envPort || dbPortFromUrl || FALLBACK_FORM_DEFAULTS.dbPort;
  const dbName = parsedUrl?.pathname?.replace(/^\//, "") || FALLBACK_FORM_DEFAULTS.dbName;
  // Derive the test URL default from the parsed main URL so
  // operators who picked a non-default port don't see TEST land
  // on 5433 / different DB name. `find` still wins if the
  // operator already set an explicit TEST_DATABASE_URL.
  const derivedTestUrl = parsedUrl
    ? `postgres://nexpress:nexpress@${dbHost}:${dbPort}/${dbName}_test`
    : FALLBACK_FORM_DEFAULTS.testDatabaseUrl;
  const testDatabaseUrl = find("TEST_DATABASE_URL") ?? derivedTestUrl;
  return {
    databaseUrl,
    testDatabaseUrl,
    dbHost,
    dbPort,
    dbName,
  };
}

async function readExistingEnvValues(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(ENV_PATH, "utf8");
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    const quote = value[0];
    if ((quote === `"` || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const args = process.argv.slice(2);
const PORT = Number(getArg("--port") ?? "3001");
const TOKEN = randomUUID();

// Pure validator lives in its own module so unit tests can import
// `validateBody` without triggering this script's top-level
// `createServer` side-effect.
import { type SetupBody, validateBody } from "./setup-server-validate.js";
import { messageForConnectionError } from "./setup-server-errors.js";
import { findFreePort } from "./setup-server-ports.js";
import { buildNonInteractiveSetupBody } from "./setup-non-interactive.js";

/**
 * `pnpm run setup` supports three modes:
 *
 *   - **http** (default) — opens a localhost HTTP server with a
 *     wizard UI. Best for first-time operators on a desktop.
 *   - **cli** — terminal prompts via `readline/promises`. Picks up
 *     automatically when run on a headless / SSH session, or
 *     forced via `--cli`.
 *   - **non-interactive** — reads an existing `.env` first, then
 *     process env overrides, with no prompts. Forced via
 *     `--non-interactive` or env var `NP_SETUP_NONINTERACTIVE=1`.
 *     Required from either source: `DATABASE_URL`. Optional:
 *     `NP_SECRET` (auto-generated if absent), `SITE_URL` (defaults
 *     to http://localhost:3000), `NP_STORAGE_ADAPTER` (`local` |
 *     `s3`, default `local`), `NP_S3_*` (when storage is `s3`),
 *     `NP_SETUP_RUN_MIGRATIONS` (`true` | `false`, default `true`).
 */
type Mode = "http" | "cli" | "non-interactive";

function detectMode(): Mode {
  if (args.includes("--non-interactive") || process.env.NP_SETUP_NONINTERACTIVE) {
    return "non-interactive";
  }
  if (args.includes("--cli") || args.includes("--no-browser")) return "cli";
  // Headless / SSH fallback. The HTTP wizard relies on the operator
  // opening a browser tab on the same machine — if there's no DISPLAY
  // (Linux/X11), no WAYLAND_DISPLAY, and an SSH session, that's
  // almost certainly impossible.
  const isSsh = Boolean(process.env.SSH_TTY || process.env.SSH_CONNECTION);
  const isLinuxHeadless =
    process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  if (isSsh || isLinuxHeadless) return "cli";
  return "http";
}

const mode = detectMode();

if (mode === "non-interactive") {
  void runNonInteractive().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else if (mode === "cli") {
  void runCli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    });
  });

  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://localhost:${PORT}/setup?token=${TOKEN}`;
    console.log("");
    console.log("  NexPress setup");
    console.log("  --------------");
    console.log(`  Open ${url}`);
    console.log(`  Writes .env → ${ENV_PATH}`);
    console.log("  (IDE may hide gitignored files)");
    console.log("  (server binds 127.0.0.1 only; press Ctrl+C to abort)");
    console.log(
      "  (no browser? use `pnpm run setup -- --cli` or `pnpm run setup -- --non-interactive`)",
    );
    console.log("");
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Token gate. Every endpoint requires `?token=…` matching the
  // one printed at startup. Saves the operator from a stray
  // process on the same machine racing the setup form.
  if (url.searchParams.get("token") !== TOKEN) {
    res.statusCode = 403;
    res.setHeader("content-type", "text/plain");
    res.end(
      "Forbidden — wrong or missing setup token. Re-open the URL printed by `pnpm run setup`.",
    );
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/setup")) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(renderHtml(await getFormDefaults()));
    return;
  }

  if (req.method === "GET" && url.pathname === "/system-check") {
    sendJson(res, 200, { ok: true, checks: await getSystemChecks() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/test-db") {
    const body = await readJsonBody<{ url?: unknown }>(req);
    const target = typeof body.url === "string" ? body.url : "";
    if (!target) {
      sendJson(res, 400, { ok: false, message: "Provide a URL" });
      return;
    }
    const result = await testDbConnection(target);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/save") {
    const raw = await readJsonBody<Partial<SetupBody>>(req);
    const validated = validateBody(raw);
    if ("error" in validated) {
      sendJson(res, 400, { ok: false, message: validated.error });
      return;
    }
    await saveEnv(validated.body);
    console.log(`[setup] wrote ${ENV_PATH}`);
    let migrate: SetupStepResult | null = null;
    if (validated.body.runMigrate) {
      migrate = await runMigrations(validated.body);
    }
    let firstBoot: SetupStepResult | null = null;
    if (!migrate || migrate.ok) {
      firstBoot = await completeFirstBoot(validated.body);
    }
    sendJson(res, 200, { ok: true, migrate, firstBoot });
    // Quit only on full success — if any step failed, keep the
    // server alive so the operator can fix the form and re-submit
    // (instead of having to restart `pnpm run setup`).
    const allOk = (!migrate || migrate.ok) && (!firstBoot || firstBoot.ok);
    if (allOk) {
      setTimeout(() => {
        console.log("");
        console.log("✓ Setup complete. Run `pnpm dev` to start NexPress.");
        process.exit(0);
      }, 750);
    }
    return;
  }

  res.statusCode = 404;
  res.end();
}

function extractDbPort(databaseUrl: string): number | null {
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.port) return null;
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

async function saveEnv(body: SetupBody): Promise<void> {
  // Backup any prior .env so a slip on the form never destroys
  // an operator's existing values.
  if (await fileExists(ENV_PATH)) {
    await copyFile(ENV_PATH, `${ENV_PATH}.bak`);
  }
  const lines: string[] = [
    `# Generated by \`pnpm run setup\` on ${new Date().toISOString()}`,
    "",
    `DATABASE_URL=${body.databaseUrl}`,
  ];
  if (body.testDatabaseUrl) lines.push(`TEST_DATABASE_URL=${body.testDatabaseUrl}`);
  // Mirror DATABASE_URL's port to NEXPRESS_DB_PORT so the
  // docker-compose template's `${NEXPRESS_DB_PORT:-5433}`
  // interpolation binds the host on the same port the app
  // expects to connect to. Without this, an operator who picked
  // a non-default port in the wizard would see the app try to
  // hit that port while compose stayed bound to 5433.
  const parsedDbPort = extractDbPort(body.databaseUrl);
  if (parsedDbPort !== null && parsedDbPort !== 5433) {
    lines.push(`NEXPRESS_DB_PORT=${parsedDbPort}`);
  }
  lines.push(`NP_SECRET=${body.npSecret}`, `SITE_URL=${body.siteUrl}`, "");
  if (body.siteName) lines.push(`NP_SITE_NAME=${body.siteName}`);
  if (body.defaultLocale) lines.push(`NP_DEFAULT_LOCALE=${body.defaultLocale}`);
  if (body.timezone) lines.push(`NP_DEFAULT_TZ=${body.timezone}`);
  if (body.siteName || body.defaultLocale || body.timezone) lines.push("");

  if (body.storage === "s3") {
    lines.push(
      "NP_STORAGE_ADAPTER=s3",
      `NP_S3_BUCKET=${body.s3Bucket ?? ""}`,
      `NP_S3_REGION=${body.s3Region ?? ""}`,
    );
    if (body.s3Endpoint) lines.push(`NP_S3_ENDPOINT=${body.s3Endpoint}`);
  } else {
    lines.push("# NP_STORAGE_ADAPTER=local (default)");
  }

  if (body.adminEmail || body.adminName || body.adminThemeId) {
    lines.push("", "# First-boot admin wizard prefill");
    if (body.adminEmail) lines.push(`NP_ADMIN_EMAIL=${body.adminEmail}`);
    if (body.adminName) lines.push(`NP_ADMIN_NAME=${body.adminName}`);
    if (body.adminThemeId) lines.push(`NP_ADMIN_THEME=${body.adminThemeId}`);
  }

  // Email — defaults to the Mailpit container in
  // `docker/docker-compose.yml`. Operators swap the four
  // `NP_SMTP_*` values when they wire a real provider for
  // staging / production. Same code path runs either way; the
  // `SmtpEmailAdapter` doesn't care whether it's pointed at
  // Mailpit or Resend.
  let fromHost = "nexpress.local";
  try {
    if (body.siteUrl) fromHost = new URL(body.siteUrl).hostname;
  } catch {
    // Malformed siteUrl from the wizard — fall through to the
    // safe default. The wizard validates URLs client-side, so
    // this only fires on genuinely broken input that snuck
    // past (e.g., an environment-variable override).
  }
  lines.push(
    "",
    "# Email (Mailpit dev — `docker compose up -d` boots it; inbox http://localhost:8025)",
    "NP_EMAIL_ADAPTER=smtp",
    "NP_SMTP_HOST=localhost",
    "NP_SMTP_PORT=1025",
    "NP_SMTP_USER=dev",
    "NP_SMTP_PASS=dev",
    `NP_SMTP_FROM="${fromHost} <noreply@nexpress.local>"`,
    "NP_SMTP_SECURE=false",
  );

  await writeFile(ENV_PATH, `${lines.join("\n")}\n`, "utf8");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface PgClientLike {
  connect(): Promise<void>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
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

async function loadProjectPg(): Promise<PgModuleLike | null> {
  try {
    // Resolve `pg` from the project root (not this module's
    // location in node_modules/@nexpress/app/...) so pnpm's strict
    // hoisting finds the consumer-installed copy reliably.
    const require = createRequire(resolve(PROJECT_DIR, "package.json"));
    const resolved = require.resolve("pg");
    return await import(resolved);
  } catch {
    return null;
  }
}

/**
 * Pre-flight check before applying migrations.
 *
 * Returns `{ existing: N }` only when the target DB already has
 * NexPress framework tables (`np_*`) AND those tables were NOT
 * created by drizzle-kit (i.e. `drizzle.__drizzle_migrations`
 * has no rows). That's the "another NexPress project owns this
 * DB" case — drizzle-kit would silently exit 1 with no message
 * when applying CREATE TABLE on top of the foreign schema, so
 * we want to short-circuit with a clear error.
 *
 * Returns `{ existing: 0 }` when:
 *   - DB is empty (fresh — normal path)
 *   - DB is unreachable (let drizzle-kit's own connection error
 *     fire; pre-flight only signals on reachable+populated)
 *   - DB has drizzle-managed rows (= same project re-running
 *     setup; drizzle-kit migrate is idempotent so safe to
 *     proceed without a false-positive collision flag)
 */
async function probeExistingFrameworkTables(url: string): Promise<{ existing: number }> {
  const pg = await loadProjectPg();
  if (!pg) return { existing: 0 };
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();

    // If drizzle has already migrated this DB (regardless of
    // hash match), assume it belongs to this project and let
    // drizzle-kit handle idempotency. Catches the "operator
    // re-runs `pnpm run setup`" case that previously false-
    // positived. The table only exists once drizzle-kit migrate
    // has succeeded at least once.
    let trackedCount = 0;
    try {
      const tracked = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      );
      trackedCount = tracked.rows[0]?.n ?? 0;
    } catch {
      // table doesn't exist → drizzle hasn't touched this DB
      trackedCount = 0;
    }
    if (trackedCount > 0) {
      await client.end();
      return { existing: 0 };
    }

    const result = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'np\\_%' ESCAPE '\\'",
    );
    await client.end();
    return { existing: result.rows[0]?.n ?? 0 };
  } catch {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    // Connection failed (DB doesn't exist, wrong creds, port
    // not open). Let drizzle-kit surface that as its own error;
    // pre-flight only signals on the "DB reachable + already
    // populated" case.
    return { existing: 0 };
  }
}

async function testDbConnection(
  url: string,
): Promise<{ ok: boolean; message: string; suggestedPort?: number }> {
  // `pg` ships transitively via `@nexpress/core`. We dynamic-import
  // to avoid loading it on every setup invocation, and structurally
  // type the surface we touch so this file doesn't depend on
  // `@types/pg` being declared at the apps/web layer.
  // `pg` ships transitively via `@nexpress/core`. tsx's dynamic
  // import doesn't resolve transitives at the apps/web layer, so
  // we widen the search via createRequire (which honors Node's
  // full module resolution including pnpm's hoisted store) and
  // hand the resolved path back to the dynamic import.
  const pg = await loadProjectPg();
  if (!pg) {
    return {
      ok: false,
      message: "`pg` not installed in this workspace — run `pnpm install` first",
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
    const version = result.rows[0]?.version ?? "unknown";
    return { ok: true, message: `Connected — ${version.split(" ").slice(0, 2).join(" ")}` };
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    // For port-collision shaped errors (28P01 / 28000), try to find a
    // free TCP port nearby so the failure message can suggest a
    // concrete alternative ("set NEXPRESS_DB_PORT=<X>"). Skipped on
    // other error codes — 3D000 / ECONNREFUSED already have their own
    // actionable advice and scanning would just slow the response.
    const code = (err as { code?: unknown } | null)?.code;
    let suggestedPort: number | null = null;
    if (code === "28P01" || code === "28000") {
      const failingPort = (() => {
        try {
          const parsed = new URL(url);
          const n = parsed.port ? Number(parsed.port) : NaN;
          return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
        } catch {
          return null;
        }
      })();
      if (failingPort !== null) {
        try {
          // Search starts one above the failing port — almost always
          // hits within a few slots. Bounded scan keeps the wizard
          // responsive on machines with many bound ports.
          suggestedPort = await findFreePort(failingPort + 1);
        } catch {
          suggestedPort = null;
        }
      }
    }
    return {
      ok: false,
      message: messageForConnectionError(url, err, { suggestedPort }),
      // Expose the suggestion to the HTTP form's `testBtn` JS so it
      // can auto-fill the dbPort input (or splice the URL) without
      // the operator having to read the message + retype.
      ...(suggestedPort !== null ? { suggestedPort } : {}),
    };
  }
}

interface SetupSystemCheck {
  name: string;
  required: string;
  version: string;
  tone: "ok" | "warn" | "err";
}

async function getSystemChecks(): Promise<SetupSystemCheck[]> {
  const [pnpm, git, pg] = await Promise.all([
    probeCommand("pnpm", ["--version"]),
    probeCommand("git", ["--version"]),
    resolveInstalledPackageVersion("pg"),
  ]);
  const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
  return [
    {
      name: "Node.js",
      required: ">=20.0",
      version: `v${process.versions.node}`,
      tone: nodeMajor >= 20 ? "ok" : "err",
    },
    {
      name: "pnpm",
      required: ">=10.0",
      version: pnpm.ok ? pnpm.output : "not found",
      tone: pnpm.ok && Number(pnpm.output.split(".")[0] ?? "0") >= 10 ? "ok" : "err",
    },
    {
      name: "Postgres driver",
      required: "pg >=8.13",
      version: pg ?? "not found",
      tone: pg ? "ok" : "warn",
    },
    {
      name: "Git",
      required: ">=2.30",
      version: git.ok ? git.output.replace(/^git version\s+/, "") : "not found",
      tone: git.ok ? "ok" : "warn",
    },
  ];
}

function probeCommand(command: string, argv: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolveProbe) => {
    const child = spawn(command, argv, {
      cwd: PROJECT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err) => {
      resolveProbe({ ok: false, output: err.message });
    });
    child.on("close", (code) => {
      resolveProbe({
        ok: code === 0,
        output: Buffer.concat(chunks).toString("utf8").trim(),
      });
    });
  });
}

async function resolveInstalledPackageVersion(name: string): Promise<string | null> {
  try {
    const require = createRequire(resolve(PROJECT_DIR, "package.json"));
    const pkgPath = require.resolve(`${name}/package.json`);
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function migrationSetupBlocker(status: MigrationStatus): string | null {
  if (status.local.length === 0) {
    return (
      "No local migrations found after `pnpm db:generate`.\n" +
      "Review ./drizzle generation output before applying migrations."
    );
  }

  if (!migrationStatusHasBlockingRisk(status)) return null;

  const problems = [
    status.drifted.length > 0
      ? `${status.drifted.length.toString()} drifted migration${
          status.drifted.length === 1 ? "" : "s"
        }`
      : null,
    status.unknownApplied.length > 0
      ? `${status.unknownApplied.length.toString()} unknown applied migration${
          status.unknownApplied.length === 1 ? "" : "s"
        }`
      : null,
  ].filter((problem): problem is string => problem !== null);

  return (
    `Migration status has ${problems.join(" and ")}. Refusing to apply migrations.\n` +
    "Check DATABASE_URL, restore the expected migration files, or reset the database before continuing."
  );
}

async function inspectMigrationStatus(
  databaseUrl: string,
): Promise<{ ok: boolean; output: string }> {
  const pg = await loadProjectPg();
  if (!pg) {
    return {
      ok: false,
      output: "`pg` not installed in this workspace — run `pnpm install` first",
    };
  }

  const client = new pg.default.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await client.connect();
    const local = readLocalMigrationEntries(MIGRATIONS_FOLDER);
    const applied = await readAppliedMigrations(client);
    const status = buildMigrationStatus(local, applied);
    const report = renderMigrationStatus(status);
    const blocker = migrationSetupBlocker(status);
    return {
      ok: blocker === null,
      output: blocker ? `${report}\n\n${blocker}` : report,
    };
  } catch (err) {
    return {
      ok: false,
      output:
        "Migration status check failed before applying migrations.\n" +
        (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function runMigrations(body: SetupBody): Promise<SetupStepResult> {
  // `pnpm` resolves through PATH; the script is meant to run inside
  // `apps/web` where the package's own `db:generate` / `db:migrate`
  // scripts already wire drizzle-kit.
  const env = { ...process.env, ...envForChild(body) };

  // Pre-flight: refuse to apply migrations onto a DB that already
  // has another NexPress project's tables. drizzle-kit's CREATE
  // TABLE collision under non-TTY spawn produces a silent exit 1
  // with no message, which has burned multiple first-time
  // operators who pointed their fresh scaffold at the monorepo's
  // shared dev DB (same URL by default before #694 + this PR).
  console.log("");
  console.log("[setup] checking database …");
  const probe = await probeExistingFrameworkTables(body.databaseUrl);
  if (probe.existing > 0) {
    const dbName = (() => {
      try {
        return new URL(body.databaseUrl).pathname.replace(/^\//, "") || "(unknown)";
      } catch {
        return "(unknown)";
      }
    })();
    const message =
      `Database '${dbName}' already contains ${probe.existing} NexPress tables (np_*).\n` +
      `Another project is using this DB. Pick a different DB name in DATABASE_URL,\n` +
      `or drop + recreate the DB:\n` +
      `  psql -c "DROP DATABASE ${dbName}; CREATE DATABASE ${dbName};"\n` +
      `Then re-run setup.`;
    console.log("[setup] db pre-flight FAILED — DB already populated");
    return { ok: false, output: message, failedTask: "database" };
  }

  // Verify the DB actually exists before kicking off drizzle-kit.
  // `probeExistingFrameworkTables` above silently treats connection
  // failure as "no existing tables", which lets us proceed to
  // drizzle-kit. But sqlstate 3D000 (database does not exist) at
  // the drizzle-kit layer surfaces as a raw error string the
  // operator has to decode. Calling `testDbConnection` here pulls
  // the friendly create-database hint into the migrate output too.
  const connTest = await testDbConnection(body.databaseUrl);
  if (!connTest.ok) {
    console.log("[setup] db connection failed before migration");
    return { ok: false, output: connTest.message, failedTask: "database" };
  }

  console.log("[setup] running pnpm db:generate …");
  const gen = await runChild(["pnpm", "run", "db:generate"], env);
  if (!gen.ok) {
    console.log("[setup] db:generate FAILED");
    return { ...gen, failedTask: "generate" };
  }
  console.log("[setup] checking migration status …");
  const statusCheck = await inspectMigrationStatus(body.databaseUrl);
  if (statusCheck.output) console.log(statusCheck.output);
  if (!statusCheck.ok) {
    console.log("[setup] migration status FAILED");
    return { ok: false, output: gen.output + statusCheck.output, failedTask: "status" };
  }
  console.log("[setup] running migrations …");
  // Use the local drizzle-orm migrate runner (scripts/run-migrations.ts)
  // instead of the `drizzle-kit migrate` CLI. The CLI swallows SQL
  // errors as a silent `exit 1` under non-TTY (the wizard's spawn);
  // the library function throws a real Error with the pg sqlstate
  // attached, which our runner prints to stderr. The schema state
  // produced is identical — same migrations folder, same
  // `drizzle.__drizzle_migrations` tracking — only error fidelity
  // changes.
  const mig = await runChild(["pnpm", "exec", "tsx", "./scripts/run-migrations.ts"], env);
  if (!mig.ok) {
    console.log("[setup] db:migrate FAILED");
    return {
      ok: false,
      output: gen.output + statusCheck.output + mig.output,
      failedTask: "migrate",
    };
  }
  console.log("[setup] migrations applied");
  return { ok: true, output: gen.output + statusCheck.output + mig.output };
}

async function completeFirstBoot(body: SetupBody): Promise<SetupStepResult> {
  if (!body.adminEmail || !body.adminPassword) {
    return {
      ok: true,
      skipped: true,
      skippedTasks: ["admin", "theme", "seed"],
      output: "First admin skipped",
    };
  }

  const env = { ...process.env, ...envForChild(body) };
  if (body.adminEmail) env.NP_ADMIN_EMAIL = body.adminEmail;
  if (body.adminName) env.NP_ADMIN_NAME = body.adminName;
  if (body.adminThemeId) env.NP_ADMIN_THEME = body.adminThemeId;
  if (body.siteName) env.NP_SITE_NAME = body.siteName;
  if (body.defaultLocale) env.NP_DEFAULT_LOCALE = body.defaultLocale;
  if (body.timezone) env.NP_DEFAULT_TZ = body.timezone;

  console.log("");
  console.log("[setup] creating first admin …");
  let currentTask: SetupTaskId = "admin";

  try {
    const core = await import("@nexpress/core");
    const drizzle = await import("drizzle-orm");
    const db = core.createDbConnection({ connectionString: body.databaseUrl });
    const rows = await db
      .select({
        id: core.npUsers.id,
        email: core.npUsers.email,
      })
      .from(core.npUsers)
      .where(drizzle.eq(core.npUsers.role, "admin"))
      .limit(1);
    const existingAdmin = rows[0];

    if (body.adminThemeId) {
      const knownThemeIds = await readRegisteredThemeIds(env);
      if (knownThemeIds.length > 0 && !knownThemeIds.includes(body.adminThemeId)) {
        return {
          ok: false,
          output:
            `Unknown theme '${body.adminThemeId}'. Registered themes: ` + knownThemeIds.join(", "),
          failedTask: "admin",
        };
      }
    }

    currentTask = "admin";
    const admin = existingAdmin
      ? existingAdmin
      : (
          await db
            .insert(core.npUsers)
            .values({
              email: body.adminEmail,
              password: await core.hashPassword(body.adminPassword),
              name: body.adminName ?? "Admin",
              role: "admin",
            })
            .returning({ id: core.npUsers.id, email: core.npUsers.email })
        )[0];

    if (!admin) {
      return { ok: false, output: "Failed to create first admin.", failedTask: "admin" };
    }

    const now = new Date();
    const siteSettings = {
      ...(body.defaultLocale ? { defaultLocale: body.defaultLocale } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      siteUrl: body.siteUrl,
    };
    await db
      .insert(core.npSites)
      .values({
        id: core.NP_DEFAULT_SITE_ID,
        name: body.siteName ?? "Default site",
        hostname: null,
        isDefault: true,
        settings: siteSettings,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: core.npSites.id,
        set: {
          ...(body.siteName ? { name: body.siteName } : {}),
          settings: siteSettings,
          updatedAt: now,
        },
      });

    await db
      .insert(core.npSettings)
      .values({
        siteId: core.NP_DEFAULT_SITE_ID,
        key: "site",
        value: {
          name: body.siteName ?? "Default site",
          url: body.siteUrl,
          ...(body.defaultLocale ? { defaultLocale: body.defaultLocale } : {}),
          ...(body.timezone ? { timezone: body.timezone } : {}),
        },
        updatedAt: now,
        updatedBy: admin.id,
      })
      .onConflictDoUpdate({
        target: [core.npSettings.siteId, core.npSettings.key],
        set: {
          value: {
            name: body.siteName ?? "Default site",
            url: body.siteUrl,
            ...(body.defaultLocale ? { defaultLocale: body.defaultLocale } : {}),
            ...(body.timezone ? { timezone: body.timezone } : {}),
          },
          updatedAt: now,
          updatedBy: admin.id,
        },
      });

    if (body.adminThemeId) {
      currentTask = "theme";
      await db
        .insert(core.npSettings)
        .values({
          siteId: core.NP_DEFAULT_SITE_ID,
          key: "activeTheme",
          value: body.adminThemeId,
          updatedAt: now,
          updatedBy: admin.id,
        })
        .onConflictDoUpdate({
          target: [core.npSettings.siteId, core.npSettings.key],
          set: { value: body.adminThemeId, updatedAt: now, updatedBy: admin.id },
        });
    }

    console.log(
      existingAdmin
        ? `[setup] admin already exists: ${admin.email}`
        : `[setup] first admin created: ${admin.email}`,
    );

    if (body.sampleContent) {
      currentTask = "seed";
      console.log("[setup] seeding sample content …");
      const seed = await runChild(["pnpm", "run", "seed:content"], env);
      if (!seed.ok) return { ...seed, failedTask: "seed" };
    }

    const skippedTasks: SetupTaskId[] = [];
    if (!body.adminThemeId) skippedTasks.push("theme");
    if (!body.sampleContent) skippedTasks.push("seed");

    return {
      ok: true,
      output: existingAdmin ? "First admin already exists" : "First admin ready",
      ...(skippedTasks.length > 0 ? { skippedTasks } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
      failedTask: currentTask,
    };
  }
}

async function readRegisteredThemeIds(env: NodeJS.ProcessEnv): Promise<string[]> {
  const configPath = resolve(PROJECT_DIR, "src/nexpress.config.ts");
  if (!(await fileExists(configPath))) return [];

  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NP_SECRET: process.env.NP_SECRET,
    SITE_URL: process.env.SITE_URL,
    NP_STORAGE_ADAPTER: process.env.NP_STORAGE_ADAPTER,
    NP_S3_BUCKET: process.env.NP_S3_BUCKET,
    NP_S3_REGION: process.env.NP_S3_REGION,
    NP_S3_ENDPOINT: process.env.NP_S3_ENDPOINT,
  };
  Object.assign(process.env, env);
  try {
    const configUrl = pathToFileURL(configPath);
    configUrl.searchParams.set("setup", String(Date.now()));
    const mod = (await import(configUrl.href)) as {
      default?: { themes?: Array<{ manifest?: { id?: string } }> };
    };
    return (
      mod.default?.themes
        ?.map((theme) => theme.manifest?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0) ?? []
    );
  } catch {
    return [];
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function runChild(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const [cmd, ...args] = argv;
    const cmdLine = argv.join(" ");
    // `stdio: "inherit"` in all modes (including the HTTP wizard).
    // drizzle-kit emits its real error / progress output only when
    // it has a real TTY — when our spawn used `pipe`, the captured
    // buffer ended up with just two spinner frames + nothing else,
    // and the actual migration error (or success message) was
    // silently dropped. Inheriting hands the child whatever stdio
    // the wizard parent has, which is the operator's actual
    // terminal. The browser UI loses captured output, but the
    // terminal now shows exactly what running `pnpm exec
    // drizzle-kit migrate` directly would show — same source, same
    // formatting, same error fidelity.
    //
    // `shell: true` so PATH resolution + shell constructs flow
    // through unchanged.
    const child = spawn(`${cmd} ${args.join(" ")}`, {
      cwd: PROJECT_DIR,
      env,
      stdio: "inherit",
      shell: true,
    });

    child.on("error", (err) => {
      process.stderr.write(`\n[setup] failed to spawn '${cmdLine}': ${err.message}\n`);
      resolvePromise({ ok: false, output: err.message });
    });

    child.on("close", (code) => {
      // Footer always prints to the terminal so the operator can
      // tell which step finished and how — drizzle-kit's own
      // success line ("X migrations applied") sometimes flushes
      // late or not at all when run as a piped child.
      const footer =
        `\n[setup] '${cmdLine}' exited with code ${code ?? "unknown"}` +
        (code !== 0
          ? `\n[setup] To re-run directly:\n[setup]   cd '${PROJECT_DIR}' && ${cmdLine}\n`
          : "\n");
      process.stderr.write(footer);
      resolvePromise({ ok: code === 0, output: footer });
    });
  });
}

function envForChild(body: SetupBody): Record<string, string> {
  // Hand the freshly-saved env to the migrate child process. `pnpm
  // run setup` itself doesn't load .env, so without this drizzle-kit
  // sees no DATABASE_URL and fails before the wizard even reaches
  // the operator's terminal.
  const env: Record<string, string> = {
    DATABASE_URL: body.databaseUrl,
    NP_SECRET: body.npSecret,
    SITE_URL: body.siteUrl,
  };
  if (body.siteName) env.NP_SITE_NAME = body.siteName;
  if (body.defaultLocale) env.NP_DEFAULT_LOCALE = body.defaultLocale;
  if (body.timezone) env.NP_DEFAULT_TZ = body.timezone;
  if (body.testDatabaseUrl) env.TEST_DATABASE_URL = body.testDatabaseUrl;
  if (body.storage === "s3") {
    env.NP_STORAGE_ADAPTER = "s3";
    if (body.s3Bucket) env.NP_S3_BUCKET = body.s3Bucket;
    if (body.s3Region) env.NP_S3_REGION = body.s3Region;
    if (body.s3Endpoint) env.NP_S3_ENDPOINT = body.s3Endpoint;
  }
  return env;
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise<T>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveBody(text ? (JSON.parse(text) as T) : ({} as T));
      } catch (err) {
        rejectBody(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function getArg(name: string): string | undefined {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx < 0) return undefined;
  const arg = args[idx];
  if (!arg) return undefined;
  if (arg.includes("=")) return arg.slice(name.length + 1);
  return args[idx + 1];
}

function generatedSecret(): string {
  // hex (not base64url) to match what `create-nexpress --yes`
  // writes — same 32-byte entropy either way, but unified encoding
  // means operators don't see two different-looking secrets in the
  // same project depending on which path created the .env.
  return randomBytes(32).toString("hex");
}

async function runCli(): Promise<void> {
  console.log("");
  console.log("  NexPress setup (CLI mode)");
  console.log("  -------------------------");
  console.log(`  Will write .env → ${ENV_PATH}`);
  console.log("  (press Ctrl+C at any prompt to abort — nothing is written until the end)");
  console.log("");

  // Read existing `.env` values so the prompt defaults match what
  // `docker compose up -d` will actually bind to. Without this,
  // a scaffold with NEXPRESS_DB_PORT=5500 in its `.env` would still
  // see the CLI prompt suggest the hardcoded :5433 default — operator
  // hits Enter to accept, compose binds 5500, app tries 5433, mismatch.
  // HTTP mode already reads `.env` via the same call at render-time.
  const defaults = await getFormDefaults();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (prompt: string, fallback?: string): Promise<string> => {
    const hint = fallback ? ` [${fallback}]` : "";
    const ans = (await rl.question(`  ${prompt}${hint}: `)).trim();
    return ans || fallback || "";
  };
  const askBool = async (prompt: string, defaultYes: boolean): Promise<boolean> => {
    const hint = defaultYes ? "Y/n" : "y/N";
    const ans = (await rl.question(`  ${prompt} [${hint}]: `)).trim().toLowerCase();
    if (!ans) return defaultYes;
    return ans === "y" || ans === "yes";
  };

  try {
    const databaseUrl = await ask(
      "PostgreSQL connection string (DATABASE_URL)",
      process.env.DATABASE_URL ?? defaults.databaseUrl,
    );
    const npSecretInput = await ask("NP_SECRET (Enter to auto-generate 64-char hex)", "");
    const npSecret = npSecretInput || generatedSecret();
    const siteUrl = await ask(
      "Public site URL (SITE_URL)",
      process.env.SITE_URL ?? "http://localhost:3000",
    );

    const storageAns = await ask("Storage adapter (local/s3)", "local");
    const storage: "local" | "s3" = storageAns === "s3" ? "s3" : "local";
    const body: SetupBody = {
      databaseUrl,
      npSecret,
      siteUrl,
      storage,
      runMigrate: false,
    };
    // Preserve TEST_DATABASE_URL from `.env` if present — CLI mode
    // doesn't prompt for it, but losing the line on rewrite breaks
    // `pnpm test:integration` for operators who set it up once.
    // `process.env` wins so a one-off shell override still applies.
    const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? defaults.testDatabaseUrl;
    if (testDatabaseUrl) body.testDatabaseUrl = testDatabaseUrl;
    if (storage === "s3") {
      body.s3Bucket = await ask("S3 bucket (NP_S3_BUCKET)", process.env.NP_S3_BUCKET);
      body.s3Region = await ask("S3 region (NP_S3_REGION)", process.env.NP_S3_REGION ?? "auto");
      const ep = await ask(
        "S3 endpoint URL (NP_S3_ENDPOINT — leave blank for AWS)",
        process.env.NP_S3_ENDPOINT ?? "",
      );
      if (ep) body.s3Endpoint = ep;
    }

    body.runMigrate = await askBool("Run pnpm db:generate + db:migrate now?", true);

    const createAdmin = await askBool(
      "Create the first admin now? (No = continue at /admin/setup after pnpm dev)",
      false,
    );
    if (createAdmin) {
      body.adminEmail = await ask("Admin email", process.env.NP_ADMIN_EMAIL);
      body.adminName = await ask("Admin name", process.env.NP_ADMIN_NAME ?? "Admin");
      body.adminPassword = await ask("Admin password (min 12 chars)");
      body.siteName = await ask("Site name", process.env.NP_SITE_NAME ?? "My Site");
      const theme = await ask(
        "Theme id (default/magazine/portfolio/docs; blank = app default)",
        process.env.NP_ADMIN_THEME ?? "",
      );
      if (theme) body.adminThemeId = theme;
      body.sampleContent = await askBool("Add sample content?", true);
    }

    const validated = validateBody(body);
    if ("error" in validated) {
      rl.close();
      console.error("");
      console.error(`✗ Invalid input: ${validated.error}`);
      process.exit(1);
    }

    rl.close();
    console.log("");
    await saveEnv(validated.body);
    console.log(`[setup] wrote ${ENV_PATH}`);

    if (body.runMigrate) {
      const result = await runMigrations(validated.body);
      if (!result.ok) {
        console.error("");
        console.error("✗ migrations FAILED — full output above");
        process.exit(1);
      }
    }

    const firstBoot = await completeFirstBoot(validated.body);
    if (!firstBoot.ok) {
      console.error("");
      console.error("✗ first-admin setup FAILED");
      console.error(firstBoot.output);
      process.exit(1);
    }

    console.log("");
    console.log("✓ Setup complete. Run `pnpm dev` to start NexPress.");
    process.exit(0);
  } catch (err) {
    rl.close();
    throw err;
  }
}

async function runNonInteractive(): Promise<void> {
  // Reads the existing `.env` first so a freshly scaffolded project
  // can run headlessly without re-exporting every generated default.
  // Real `process.env` wins, so CI / dotfile / fly secrets flows can
  // still dictate everything without a TTY. Reuses the operator-facing
  // env-var names (`DATABASE_URL`, `NP_SECRET`, `SITE_URL`,
  // `NP_STORAGE_ADAPTER`, `NP_S3_*`) plus setup-specific knobs such as
  // `NP_SETUP_RUN_MIGRATIONS`.
  console.log("");
  console.log("  NexPress setup (non-interactive mode)");
  console.log("  -------------------------------------");
  console.log(`  Will write .env → ${ENV_PATH}`);
  console.log("");

  const existingEnv = await readExistingEnvValues();
  const body = buildNonInteractiveSetupBody({ ...existingEnv, ...process.env }, generatedSecret);

  const validated = validateBody(body);
  if ("error" in validated) {
    console.error(`✗ Invalid setup input: ${validated.error}`);
    console.error("");
    console.error("Non-interactive mode reads existing .env first, then process env overrides.");
    console.error("Required when neither source provides it:");
    console.error("  DATABASE_URL              postgres://...");
    console.error("Optional:");
    console.error("  NP_SECRET                 (auto-generated if absent; ≥32 chars)");
    console.error("  SITE_URL                  (defaults to http://localhost:3000)");
    console.error("  NP_STORAGE_ADAPTER        local | s3 (default local)");
    console.error("  NP_S3_BUCKET / NP_S3_REGION / NP_S3_ENDPOINT");
    console.error("  TEST_DATABASE_URL         (integration tests; copied as-is)");
    console.error("  NP_SETUP_RUN_MIGRATIONS   true | false (default true)");
    console.error("  NP_ADMIN_EMAIL / NP_ADMIN_PASSWORD / NP_ADMIN_THEME");
    console.error("  NP_SETUP_CREATE_ADMIN     true to require first-admin creation");
    process.exit(1);
  }

  await saveEnv(validated.body);
  console.log(`[setup] wrote ${ENV_PATH}`);

  if (validated.body.runMigrate) {
    const result = await runMigrations(validated.body);
    if (!result.ok) {
      console.error("");
      console.error("✗ migrations FAILED — full output above");
      process.exit(1);
    }
  }

  const firstBoot = await completeFirstBoot(validated.body);
  if (!firstBoot.ok) {
    console.error("");
    console.error("✗ first-admin setup FAILED");
    console.error(firstBoot.output);
    process.exit(1);
  }

  console.log("");
  console.log("✓ Setup complete.");
  process.exit(0);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(defaults: FormDefaults): string {
  const defaultSecret = generatedSecret();
  const nexpressMark = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M28 0H64V36L52 24V12H40L28 0Z" fill="#0066FF"></path>
    <path d="M0 24L24 48V64H0V24Z" fill="#0A0A0A"></path>
    <path d="M0 0H18L64 46V64H46L0 18V0Z" fill="#0A0A0A"></path>
  </svg>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>NexPress · Setup</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    color-scheme: light dark;
    --nx-neutral-50:#fafafa; --nx-neutral-100:#f5f5f5; --nx-neutral-200:#e5e5e5;
    --nx-neutral-300:#d4d4d4; --nx-neutral-400:#a3a3a3; --nx-neutral-500:#737373;
    --nx-neutral-600:#525252; --nx-neutral-700:#404040; --nx-neutral-800:#262626;
    --nx-neutral-900:#171717; --nx-neutral-950:#0a0a0a;
    --nx-brand:#0066ff; --nx-brand-soft:rgb(0 102 255 / .08);
    --nx-success:#22a764; --nx-warning:#c98710; --nx-danger:#dc2626;
    --nx-body:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    --nx-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0; font-family: var(--nx-body); color: var(--nx-neutral-950);
    background:
      radial-gradient(80% 50% at 50% -10%, rgba(0,102,255,.05), transparent 60%),
      radial-gradient(60% 40% at 100% 100%, rgba(0,102,255,.025), transparent 60%),
      #f8f8f7;
    -webkit-font-smoothing: antialiased;
  }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .48; }
  :focus-visible { outline: 3px solid rgb(0 102 255 / .28); outline-offset: 2px; }
  .sw-page { min-height: 100vh; display: flex; flex-direction: column; }
  .sw-top {
    height: 56px; padding: 0 28px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(0,0,0,.045); background: rgba(248,248,247,.72);
    backdrop-filter: saturate(140%) blur(10px); position: sticky; top: 0; z-index: 10;
  }
  .sw-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; }
  .sw-mark {
    width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  }
  .sw-mark svg { width: 22px; height: 22px; display: block; }
  .sw-divider { width: 1px; height: 18px; background: rgba(0,0,0,.08); }
  .sw-crumb { color: var(--nx-neutral-500); font-size: 12px; font-weight: 500; }
  .sw-crumb strong { color: var(--nx-neutral-950); }
  .sw-top-right { display: inline-flex; align-items: center; gap: 12px; color: var(--nx-neutral-500); font-size: 12px; }
  .sw-pill {
    display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px;
    border: 1px solid #e6e6e5; background: #fff; border-radius: 9999px;
    font-family: var(--nx-mono); font-size: 11px; color: var(--nx-neutral-700);
  }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--nx-success); display: inline-block; }
  .sw-stage {
    flex: 1; display: flex; align-items: flex-start; justify-content: center;
    padding: 36px 24px 60px;
  }
  .sw-card {
    width: 100%; max-width: 940px; max-height: calc(100vh - 116px);
    background: #fff; border: 1px solid #ececeb;
    border-radius: 16px; box-shadow:
      0 1px 0 rgba(0,0,0,.02),
      0 30px 60px -30px rgba(0,0,0,.08),
      0 8px 18px -10px rgba(0,0,0,.05);
    overflow: hidden; display: grid; grid-template-columns: 248px 1fr;
  }
  .sw-rail { background: #fbfbfa; border-right: 1px solid #ececeb; padding: 22px 18px 22px 22px; display: flex; flex-direction: column; gap:4px; }
  .sw-rail-title { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .18em; color: var(--nx-neutral-400); padding: 4px 4px 12px; }
  .sw-steps { position: relative; display: flex; flex-direction: column; }
  .sw-steps:before { content:""; position:absolute; left:13px; top:14px; bottom:14px; width:1px; background:#ececeb; }
  .sw-step {
    position: relative; display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: center;
    padding: 7px 4px; border: 0; border-radius: 6px; background: transparent; text-align: left; color: inherit;
  }
  .sw-step:hover { background: rgba(0,0,0,.025); }
  .sw-step-dot {
    position: relative; width:22px; height:22px; border-radius:50%; background:#fff; border:1px solid #e0e0df;
    color: var(--nx-neutral-400); display:inline-flex; align-items:center; justify-content:center;
    font-family: var(--nx-mono); font-size:10.5px; font-weight:600;
  }
  .sw-step[data-state="done"] .sw-step-dot { background: var(--nx-brand); border-color: var(--nx-brand); color:#fff; }
  .sw-step[data-state="active"] .sw-step-dot { background: var(--nx-neutral-950); border-color: var(--nx-neutral-950); color:#fff; box-shadow:0 0 0 4px rgba(10,10,10,.06); }
  .sw-step-label { font-size:13px; font-weight:500; color:var(--nx-neutral-600); }
  .sw-step-sub { margin-top:1px; font-size:11px; color:var(--nx-neutral-400); }
  .sw-step[data-state="active"] .sw-step-label { color:var(--nx-neutral-950); font-weight:600; }
  .sw-step[data-state="done"] .sw-step-label { color:var(--nx-neutral-700); }
  .sw-rail-note { margin-top:auto; padding:10px 8px; font:11px/1.5 var(--nx-mono); color:var(--nx-neutral-400); }
  .sw-main { min-width: 0; min-height:580px; max-height:inherit; display:flex; flex-direction:column; }
  .sw-head { padding: 28px 32px 8px; display:flex; flex-direction:column; gap:8px; }
  .sw-eyebrow { font:600 10.5px/1 var(--nx-mono); text-transform:uppercase; letter-spacing:.22em; color:var(--nx-neutral-400); }
  .sw-h1 { margin:0; font-size:24px; line-height:1.15; font-weight:600; letter-spacing:-.022em; color:var(--nx-neutral-950); }
  .sw-sub { margin:0; font-size:14px; line-height:1.55; color:var(--nx-neutral-500); max-width:60ch; }
  .sw-body {
    flex:1; min-height:0; overflow:auto; padding:18px 32px 24px;
    display:flex; flex-direction:column; gap:16px;
  }
  .step-panel { display:flex; flex-direction:column; gap:16px; }
  .sw-foot {
    display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 18px 14px 28px;
    border-top:1px solid #ececeb; background:#fafafa;
  }
  .sw-foot-meta { display:inline-flex; gap:8px; align-items:center; font:11.5px var(--nx-mono); color:var(--nx-neutral-500); }
  .sw-actions { display:inline-flex; gap:8px; align-items:center; }
  .btn {
    height:32px; padding:0 12px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; gap:6px;
    border:1px solid transparent; background:var(--nx-neutral-950); color:#fff; font-size:13px; font-weight:500;
  }
  .btn-ghost { background:transparent; color:var(--nx-neutral-700); }
  .btn-outline { background:#fff; color:var(--nx-neutral-800); border-color:#e6e6e5; }
  .btn-brand { background:var(--nx-brand); color:#fff; }
  .btn-sm { height:28px; padding:0 10px; font-size:12px; }
  .svg-icon { width:14px; height:14px; display:inline-block; vertical-align:-2px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
  .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .grid-2, .field-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .field-stack { display:flex; flex-direction:column; gap:12px; }
  .welcome-tile, .panel {
    border:1px solid #ececeb; background:#fafafa; border-radius:10px; padding:12px 14px;
  }
  .panel { display:flex; flex-direction:column; gap:12px; }
  .welcome-tile { display:flex; flex-direction:column; gap:6px; }
  .welcome-tile b { display:block; font-size:12.5px; font-weight:600; color:var(--nx-neutral-950); }
  .welcome-tile p { margin:0; font-size:11.5px; color:var(--nx-neutral-500); line-height:1.45; }
  .icon-tile { width:22px; height:22px; border-radius:6px; background:var(--nx-brand-soft); color:var(--nx-brand); display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
  .icon-tile .svg-icon { width:12px; height:12px; }
  .env-list, .task-list { border:1px solid #ececeb; border-radius:10px; overflow:hidden; background:#fff; }
  .env-head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #ececeb; background:#fafafa; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.18em; color:var(--nx-neutral-500); }
  .env-row, .task-row { display:grid; grid-template-columns:22px 1fr auto auto; gap:14px; align-items:center; padding:11px 14px; border-top:1px solid #f4f4f3; }
  .env-row:first-of-type, .task-row:first-child { border-top:0; }
  .row-name { font-size:13px; font-weight:500; color:var(--nx-neutral-900); }
  .row-sub { margin-top:1px; font:11.5px var(--nx-mono); color:var(--nx-neutral-400); }
  .row-ver, .row-state, .task-time { font:11.5px var(--nx-mono); color:var(--nx-neutral-500); white-space:nowrap; }
  .tone-ok { color:var(--nx-success); } .tone-warn { color:var(--nx-warning); } .tone-err { color:var(--nx-danger); }
  .segment { display:inline-flex; border:1px solid #e6e6e5; border-radius:8px; background:#f4f4f3; padding:3px; gap:2px; }
  .segment button { border:0; background:transparent; padding:5px 12px; border-radius:6px; font-size:12.5px; color:var(--nx-neutral-600); }
  .segment button[aria-selected="true"] { background:#fff; color:var(--nx-neutral-950); box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .field { display:flex; flex-direction:column; gap:6px; }
  .label { font-size:12.5px; font-weight:500; color:var(--nx-neutral-800); }
  .helper { margin:0; font-size:11.5px; line-height:1.45; color:var(--nx-neutral-500); }
  .input, .select, .textarea {
    width:100%; min-width:0; height:32px; border:1px solid #e6e6e5; border-radius:8px; background:#fff;
    padding:0 10px; color:var(--nx-neutral-950); font-size:13px; line-height:32px;
  }
  .textarea { height:auto; min-height:80px; padding:8px 10px; line-height:1.5; resize:vertical; }
  .input:focus, .select:focus, .textarea:focus { outline:0; border-color:var(--nx-brand); box-shadow:0 0 0 3px rgb(0 102 255 / .18); }
  .mono { font-family:var(--nx-mono); letter-spacing:0; }
  .prefixed { display:flex; height:32px; border:1px solid #e6e6e5; border-radius:8px; overflow:hidden; background:#fff; }
  .prefixed:focus-within { border-color:var(--nx-brand); box-shadow:0 0 0 3px rgb(0 102 255 / .18); }
  .prefixed span { display:inline-flex; align-items:center; padding:0 10px; border-right:1px solid #ececeb; background:#fafafa; color:var(--nx-neutral-500); font:12px var(--nx-mono); }
  .prefixed input { border:0; outline:0; flex:1; min-width:0; padding:0 10px; background:transparent; }
  .input-aff { position:relative; }
  .input-aff .input { padding-right:40px; }
  .reveal { position:absolute; right:4px; top:4px; bottom:4px; width:28px; border:0; border-radius:6px; background:transparent; color:var(--nx-neutral-500); }
  .checklist { display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; padding:0; margin:4px 0 0; }
  .checklist li { list-style:none; font:11.5px var(--nx-mono); color:var(--nx-neutral-500); }
  .checklist li[data-ok="true"] { color:var(--nx-success); }
  .banner { display:grid; grid-template-columns:18px minmax(0,1fr) auto; gap:10px; align-items:start; padding:12px 14px; border:1px solid #dbeafe; background:#eff6ff; color:#1e3a8a; border-radius:10px; font-size:13px; }
  .banner-error { border-color:#fecaca; background:#fef2f2; color:#991b1b; }
  .banner-title { font-weight:600; }
  .banner-body { margin-top:2px; font:12.5px var(--nx-mono); opacity:.86; }
  .banner-error .banner-body { margin-top:8px; max-height:168px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; padding:8px 10px; border:1px solid #fecaca; border-radius:8px; background:rgba(255,255,255,.68); color:#7f1d1d; opacity:1; }
  .codepanel { background:#0f0f0e; border:1px solid #1d1d1c; border-radius:10px; overflow:hidden; }
  .code-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; background:#161615; border-bottom:1px solid #1d1d1c; color:#c8c8c6; font:11px var(--nx-mono); }
  .code-actions { display:inline-flex; gap:4px; }
  .code-btn { border:1px solid transparent; background:transparent; color:#9e9e9c; padding:4px 8px; border-radius:6px; font:11px var(--nx-mono); }
  .code-btn:hover { background:rgba(255,255,255,.05); color:#fff; }
  .code-body { padding:14px 16px; overflow:auto; white-space:pre; color:#e6e6e5; font:12px/1.65 var(--nx-mono); }
  .code-body .k { color:#9e9e9c; } .code-body .s { color:#ffd479; } .code-body .c { color:#6e6e6c; font-style:italic; } .code-body .v { color:#b3e1a4; } .code-body .h { color:#6f8df0; } .code-body .eq { color:#555; }
  .progress { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:center; padding:12px 16px; border:1px solid #ececeb; border-radius:10px; background:#fafafa; }
  .progress-label { font:12px var(--nx-mono); color:var(--nx-neutral-600); }
  .bar { height:4px; background:#ececeb; border-radius:999px; overflow:hidden; margin-top:8px; }
  .fill { height:100%; width:0; background:var(--nx-brand); border-radius:999px; transition:width 300ms ease; }
  .task-icon { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; border:1px dashed #d8d8d6; font-size:11px; }
  .task-row[data-state="done"] .task-icon { background:var(--nx-success); color:#fff; border-color:var(--nx-success); }
  .task-row[data-state="error"] .task-icon { background:var(--nx-danger); color:#fff; border-color:var(--nx-danger); }
  .task-row[data-state="skipped"] .task-icon { background:#f5f5f4; color:var(--nx-neutral-500); border-color:#d8d8d6; border-style:solid; }
  .task-row[data-state="skipped"] .row-name, .task-row[data-state="skipped"] .row-sub { color:var(--nx-neutral-500); }
  .task-row[data-state="running"] .task-icon { border:2px solid #d8d8d6; border-top-color:var(--nx-brand); animation:spin 700ms linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .log { height:200px; overflow:auto; background:#0f0f0e; border:1px solid #1d1d1c; border-radius:10px; padding:12px 14px; font:11.5px/1.65 var(--nx-mono); color:#d6d6d4; }
  .log-row { display:grid; grid-template-columns:56px 24px 1fr; gap:8px; }
  .log-row span:last-child { min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; }
  .log-time, .log-lvl { color:#6e6e6c; } .log-info .log-lvl { color:#6f8df0; } .log-ok .log-lvl { color:#79c87f; } .log-warn .log-lvl { color:#e5b35e; } .log-err .log-lvl { color:#e57b7b; }
  .done { display:flex; flex-direction:column; gap:22px; align-items:center; padding:18px 8px 8px; }
  .seal { width:64px; height:64px; border-radius:50%; background:var(--nx-brand-soft); color:var(--nx-brand); display:inline-flex; align-items:center; justify-content:center; font-size:28px; font-weight:700; }
  .seal .svg-icon { width:28px; height:28px; }
  .done-copy { display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; }
  .done h2 { margin:0; font-size:26px; letter-spacing:-.022em; text-align:center; }
  .done p { margin:0; max-width:50ch; text-align:center; font-size:14px; line-height:1.55; color:var(--nx-neutral-500); }
  .nextcards { width:100%; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
  .nextcard { display:flex; flex-direction:column; gap:6px; padding:14px; border:1px solid #ececeb; border-radius:10px; background:#fff; text-align:left; }
  .nextcard-top { display:flex; align-items:center; justify-content:space-between; }
  .nextcard-ico { width:28px; height:28px; border-radius:8px; background:var(--nx-brand-soft); color:var(--nx-brand); display:inline-flex; align-items:center; justify-content:center; }
  .nextcard b { font-size:13px; } .nextcard span { font-size:11.5px; color:var(--nx-neutral-500); line-height:1.45; }
  .nextcard .mono { overflow-wrap:anywhere; }
  .hidden { display:none !important; }
  @media (max-width: 820px) {
    .sw-top { padding:0 16px; } .sw-top-right > span:last-child { display:none; }
    .sw-stage { padding:18px 12px 36px; }
    .sw-card { grid-template-columns:1fr; height:auto; max-height:none; }
    .sw-rail { border-right:0; border-bottom:1px solid #ececeb; }
    .sw-steps { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; }
    .sw-steps:before, .sw-step-sub, .sw-rail-note { display:none; }
    .sw-step { grid-template-columns:22px; justify-content:center; }
    .sw-step-label { display:none; }
    .sw-head, .sw-body { padding-left:18px; padding-right:18px; }
    .grid-3, .grid-2, .field-row, .nextcards { grid-template-columns:1fr; }
    .sw-foot { align-items:flex-start; flex-direction:column; }
    .sw-actions { width:100%; justify-content:flex-end; }
  }
</style>
</head>
<body>
<div class="sw-page">
  <header class="sw-top">
    <div class="sw-brand">
      <span class="sw-mark">${nexpressMark}</span><span>NexPress</span><span class="sw-divider"></span>
      <span class="sw-crumb"><strong>Setup</strong> · first run</span>
    </div>
    <div class="sw-top-right">
      <span class="sw-pill"><span class="dot"></span> localhost:${PORT}/setup</span>
      <span class="mono">v0.1.0 · pnpm run setup</span>
    </div>
  </header>
  <main class="sw-stage">
    <div class="sw-card">
      <aside class="sw-rail">
        <div class="sw-rail-title">Setup</div>
        <div class="sw-steps" id="stepRail"></div>
        <div class="sw-rail-note">You can rerun setup safely.<br />Leave admin blank to continue later in /admin/setup.</div>
      </aside>
      <section class="sw-main">
        <div class="sw-head">
          <span class="sw-eyebrow" id="eyebrow"></span>
          <h1 class="sw-h1" id="title"></h1>
          <p class="sw-sub" id="subtitle"></p>
        </div>
        <div class="sw-body">
          <section class="step-panel" data-step="welcome">
            <div class="grid-3">
              <div class="welcome-tile"><span class="icon-tile" data-icon="shield"></span><b>Server-first</b><p>Next.js RSC by default. Public bundles stay slim, admin stays separate.</p></div>
              <div class="welcome-tile"><span class="icon-tile" data-icon="layers"></span><b>Codegen-driven</b><p>Collections become typed Drizzle tables and admin screens.</p></div>
              <div class="welcome-tile"><span class="icon-tile" data-icon="key"></span><b>Local stays local</b><p>Secrets and database checks stay on this machine.</p></div>
            </div>
            <div class="env-list">
              <div class="env-head"><span>Detected environment</span><span class="mono" id="scanTime"></span></div>
              <div id="systemRows"></div>
            </div>
          </section>

          <section class="step-panel hidden" data-step="database">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div class="segment">
                <button type="button" id="dbModeUrl" aria-selected="true">Connection URL</button>
                <button type="button" id="dbModeFields" aria-selected="false">Discrete fields</button>
              </div>
              <span class="sw-pill">Postgres 14+ required</span>
            </div>
            <div id="dbUrlPane">
              <div class="field">
                <label class="label" for="databaseUrl">Connection string</label>
                <input class="input mono" id="databaseUrl" value="${escapeHtml(defaults.databaseUrl)}" spellcheck="false" />
                <p class="helper">Default uses your project name as the DB. Create it first if Postgres is already running.</p>
              </div>
            </div>
            <div id="dbFieldsPane" class="field-stack hidden">
              <div class="field-row">
                <div class="field"><label class="label" for="dbHost">Host</label><input class="input" id="dbHost" value="${escapeHtml(defaults.dbHost)}" /></div>
                <div class="field"><label class="label" for="dbPort">Port</label><input class="input" id="dbPort" value="${escapeHtml(defaults.dbPort)}" /></div>
              </div>
              <div class="field-row">
                <div class="field"><label class="label" for="dbName">Database</label><input class="input" id="dbName" value="${escapeHtml(defaults.dbName)}" /></div>
                <div class="field"><label class="label" for="dbUser">User</label><input class="input" id="dbUser" value="nexpress" /></div>
              </div>
              <div class="field"><label class="label" for="dbPass">Password</label><input class="input" id="dbPass" type="password" value="nexpress" /></div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button type="button" class="btn btn-outline" id="testBtn">Test connection</button>
              <span id="testStatus" class="helper"></span>
            </div>
            <details>
              <summary style="cursor:pointer;font-size:12.5px;color:var(--nx-neutral-600)">No Postgres yet? Start a local container.</summary>
              <div class="codepanel" style="margin-top:8px"><div class="code-head"><span>docker compose up postgres</span><span>shell</span></div><div class="code-body"><span class="c"># from the nexpress project root</span>
<span class="h">$</span> docker compose -f docker/docker-compose.yml up <span class="v">-d</span></div></div>
            </details>
          </section>

          <section class="step-panel hidden" data-step="admin">
            <div class="banner"><span data-icon="key"></span><div><div class="banner-title">Optional first-admin shortcut</div><div class="banner-body">Skip this step and NexPress will continue at /admin/setup after pnpm dev.</div></div></div>
            <div class="field-row">
              <div class="field"><label class="label" for="adminEmail">Email</label><input class="input" id="adminEmail" type="email" autocomplete="username" placeholder="admin@example.com" /></div>
              <div class="field"><label class="label" for="adminName">Display name</label><input class="input" id="adminName" autocomplete="name" placeholder="Admin" /></div>
            </div>
            <div class="field">
              <label class="label" for="adminPassword">Password</label>
              <div class="input-aff"><input class="input" id="adminPassword" type="password" autocomplete="new-password" /><button type="button" class="reveal" id="revealPassword">view</button></div>
              <p class="helper">Minimum 12 characters. Never written to .env.</p>
            </div>
            <ul class="checklist" id="passwordChecks"></ul>
          </section>

          <section class="step-panel hidden" data-step="site">
            <div class="field"><label class="label" for="siteName">Site name</label><input class="input" id="siteName" value="My Site" /></div>
            <div class="field"><label class="label" for="siteUrlHost">Public URL</label><div class="prefixed"><span>http://</span><input id="siteUrlHost" value="localhost:3000" /></div><p class="helper">Used for password-reset links, canonical URLs, and OpenAPI server entries.</p></div>
            <div class="field-row">
              <div class="field"><label class="label" for="locale">Default locale</label><select class="select" id="locale"><option>en-US</option><option>ko-KR</option><option>ja-JP</option><option>de-DE</option><option>fr-FR</option></select></div>
              <div class="field"><label class="label" for="timezone">Time zone</label><select class="select" id="timezone"><option>UTC</option><option>Asia/Seoul</option><option>America/Los_Angeles</option><option>America/New_York</option><option>Europe/London</option></select></div>
            </div>
            <div class="field-row">
              <div class="field"><label class="label" for="adminThemeId">Starter theme</label><select class="select" id="adminThemeId"><option value="">App default</option><option value="default">Default</option><option value="magazine">Magazine</option><option value="portfolio">Portfolio</option><option value="docs">Docs</option></select></div>
              <div class="field"><label class="label" for="sampleContent">Demo content</label><label class="panel" style="display:flex;gap:10px;align-items:flex-start"><input id="sampleContent" type="checkbox" checked style="margin-top:2px" /><span><b style="display:block;font-size:13px">Add sample content</b><span class="helper">Runs only when admin email and password are present.</span></span></label></div>
            </div>
          </section>

          <section class="step-panel hidden" data-step="env">
            <div class="codepanel">
              <div class="code-head"><span>.env · writes to ${escapeHtml(ENV_PATH)}</span><span class="code-actions"><button type="button" class="code-btn" id="regenSecret">Regenerate secret</button></span></div>
              <pre class="code-body" id="envPreview"></pre>
            </div>
            <div class="panel">
              <div class="field-row">
                <div class="field"><label class="label" for="testDatabaseUrl">TEST_DATABASE_URL</label><input class="input mono" id="testDatabaseUrl" value="${escapeHtml(defaults.testDatabaseUrl)}" /></div>
                <div class="field"><label class="label" for="storage">Storage</label><select class="select" id="storage"><option value="local">Local filesystem</option><option value="s3">S3 / R2 / MinIO</option></select></div>
              </div>
              <div id="s3Fields" class="field-row hidden" style="margin-top:12px">
                <div class="field"><label class="label" for="s3Bucket">Bucket</label><input class="input" id="s3Bucket" /></div>
                <div class="field"><label class="label" for="s3Region">Region</label><input class="input" id="s3Region" value="us-east-1" /></div>
                <div class="field"><label class="label" for="s3Endpoint">Endpoint</label><input class="input" id="s3Endpoint" placeholder="https://..." /></div>
              </div>
            </div>
          </section>

          <section class="step-panel hidden" data-step="migrate">
            <div id="runError" class="banner banner-error hidden"><span>!</span><div><div class="banner-title">Setup failed</div><div class="banner-body" id="runErrorText"></div></div><button type="button" class="btn btn-outline btn-sm" id="retryBtn">Retry</button></div>
            <div class="progress"><div><div class="progress-label" id="progressLabel">Ready to run · tasks queued</div><div class="bar"><div class="fill" id="progressFill"></div></div></div><div class="mono" id="progressPct"><strong>0</strong>%</div></div>
            <div class="task-list" id="taskList"></div>
            <div><div class="sw-eyebrow" style="margin-bottom:8px">Log</div><div class="log" id="runLog"></div></div>
          </section>

          <section class="step-panel hidden" data-step="done">
            <div class="done">
              <div class="seal" data-icon="check"></div>
              <div class="done-copy"><h2>You're set.</h2><p id="doneText">NexPress is ready on this machine.</p></div>
              <div class="nextcards">
                <div class="nextcard"><div class="nextcard-top"><span class="nextcard-ico" data-icon="terminal"></span><span class="mono">next</span></div><b>Run the dev server</b><span class="mono">pnpm dev</span></div>
                <div class="nextcard"><div class="nextcard-top"><span class="nextcard-ico" data-icon="logo"></span><span class="mono">then</span></div><b>Open the admin</b><span class="mono">http://localhost:3000/admin</span></div>
                <div class="nextcard"><div class="nextcard-top"><span class="nextcard-ico" data-icon="layers"></span><span class="mono">edit</span></div><b>Edit collections</b><span class="mono">src/nexpress.config.ts</span></div>
                <div class="nextcard"><div class="nextcard-top"><span class="nextcard-ico" data-icon="shield"></span><span class="mono">deploy</span></div><b>Preflight deploy</b><span class="mono">pnpm run deploy:plan -- --target vercel</span></div>
              </div>
              <div class="codepanel" style="width:100%"><div class="code-head"><span>terminal · pnpm run setup</span><span style="color:#79c87f">exited 0</span></div><div class="code-body" id="doneLog"></div></div>
            </div>
          </section>
        </div>
        <div class="sw-foot">
          <div class="sw-foot-meta"><span>step <strong id="stepNum" style="color:var(--nx-neutral-950)">01</strong>/07</span><span>·</span><span id="stepSlug">welcome</span></div>
          <div class="sw-actions"><button type="button" class="btn btn-ghost hidden" id="skipBtn">Skip</button><button type="button" class="btn btn-ghost" id="backBtn">Back</button><button type="button" class="btn" id="primaryBtn">Continue</button></div>
        </div>
      </section>
    </div>
  </main>
</div>

<script>
  const TOKEN = ${JSON.stringify(TOKEN)};
  const SETUP_ENV_PATH = ${JSON.stringify(ENV_PATH)};
  const SETUP_PROJECT_DIR = ${JSON.stringify(PROJECT_DIR)};
  const DEFAULT_SECRET = ${JSON.stringify(defaultSecret)};
  const STEPS = [
    ["welcome","Welcome","System check"],
    ["database","Database","Postgres connection"],
    ["admin","Admin","First user"],
    ["site","Site","Name and meta"],
    ["env","Environment",".env preview"],
    ["migrate","Initialize","Migrate and seed"],
    ["done","Done","Next steps"],
  ];
  const TITLES = {
    welcome:["STEP 01 / 07 · WELCOME","Set up NexPress","Three minutes from clone to /admin. We'll check your environment, connect to Postgres, and prepare first-boot defaults."],
    database:["STEP 02 / 07 · DATABASE","Connect to Postgres","Use the local default, paste a connection string, or fill the fields by hand."],
    admin:["STEP 03 / 07 · ADMIN","Create the first admin","Optional here. If you skip it, /admin/setup will continue the account and theme flow after pnpm dev."],
    site:["STEP 04 / 07 · SITE","Name your site","Choose site metadata, the initial theme, and whether to seed demo content."],
    env:["STEP 05 / 07 · ENVIRONMENT","Review .env","NexPress will write this file to your project root. NP_SECRET is regenerated on demand and never committed."],
    migrate:["STEP 06 / 07 · INITIALIZE","Initialize the database","Write .env, inspect migration status, apply migrations, optionally bootstrap the admin user, and seed starter content."],
    done:["STEP 07 / 07 · DONE","You're set.",""],
  };
  const TASKS = [
    ["env","Write .env", SETUP_ENV_PATH],
    ["database","Check database", "DATABASE_URL pre-flight"],
    ["generate","Generate schema", "pnpm db:generate"],
    ["status","Inspect migrations", "pnpm db:migrate -- --status"],
    ["migrate","Apply migrations", "scripts/run-migrations.ts"],
    ["admin","Bootstrap admin user", "optional"],
    ["theme","Activate starter theme", "optional"],
    ["seed","Seed demo content", "optional"],
  ];
  const TASK_INDEX = Object.fromEntries(TASKS.map((task, index) => [task[0], index]));
  const $ = (id) => document.getElementById(id);
  let step = 0;
  let secret = DEFAULT_SECRET;
  let dbMode = "url";
  let dbOk = false;
  let setupComplete = false;
  let runState = "idle";
  let taskTimer = null;
  let taskCursor = 0;
  let lastResult = null;
  let skippedTaskIds = new Set();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
  }
  const ICONS = {
    check: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
    shield: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
    layers: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>',
    key: '<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m12 11 8-8"/><path d="m17 6 3 3"/><path d="m15 8 3 3"/></svg>',
    terminal: '<svg class="svg-icon" viewBox="0 0 24 24"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
    logo: '<svg class="svg-icon" viewBox="0 0 64 64"><path d="M28 0H64V36L52 24V12H40L28 0Z" fill="#0066FF"></path><path d="M0 24L24 48V64H0V24Z"></path><path d="M0 0H18L64 46V64H46L0 18V0Z"></path></svg>',
  };
  function hydrateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      el.innerHTML = ICONS[el.dataset.icon] || "";
    });
  }
  function maxAllowedStep() {
    if (!dbOk) return 1;
    if (!setupComplete) return 5;
    return STEPS.length - 1;
  }
  function iconForTone(tone) {
    if (tone === "ok") return ICONS.check;
    if (tone === "err") return "!";
    return "i";
  }
  function makeSecret() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let out = "";
    for (let i = 0; i < 64; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function siteUrl() {
    const raw = $("siteUrlHost").value.trim() || "localhost:3000";
    return /^https?:\\/\\//.test(raw) ? raw : "http://" + raw;
  }
  function databaseUrl() {
    if (dbMode === "url") return $("databaseUrl").value.trim();
    const user = encodeURIComponent($("dbUser").value.trim() || "nexpress");
    const pass = encodeURIComponent($("dbPass").value || "nexpress");
    const host = $("dbHost").value.trim() || "localhost";
    const port = $("dbPort").value.trim() || "5433";
    const name = $("dbName").value.trim() || ${JSON.stringify(DEFAULT_DB_NAME)};
    return "postgres://" + user + ":" + pass + "@" + host + ":" + port + "/" + name;
  }
  function payload() {
    const storage = $("storage").value;
    return {
      databaseUrl: databaseUrl(),
      testDatabaseUrl: $("testDatabaseUrl").value.trim(),
      npSecret: secret,
      siteUrl: siteUrl(),
      storage,
      s3Bucket: storage === "s3" ? $("s3Bucket").value.trim() : undefined,
      s3Region: storage === "s3" ? $("s3Region").value.trim() : undefined,
      s3Endpoint: storage === "s3" ? $("s3Endpoint").value.trim() : undefined,
      runMigrate: true,
      adminEmail: $("adminEmail").value.trim(),
      adminPassword: $("adminPassword").value,
      adminName: $("adminName").value.trim(),
      adminThemeId: $("adminThemeId").value,
      siteName: $("siteName").value.trim(),
      defaultLocale: $("locale").value,
      timezone: $("timezone").value,
      sampleContent: $("sampleContent").checked,
    };
  }
  function renderRail() {
    $("stepRail").innerHTML = STEPS.map((s, i) => {
      const state = i < step ? "done" : i === step ? "active" : "todo";
      const dot = state === "done" ? ICONS.check : String(i + 1).padStart(2, "0");
      return '<button type="button" class="sw-step" data-index="' + i + '" data-state="' + state + '"><span class="sw-step-dot">' + dot + '</span><span><div class="sw-step-label">' + s[1] + '</div><div class="sw-step-sub">' + s[2] + '</div></span></button>';
    }).join("");
    document.querySelectorAll(".sw-step").forEach((btn) => btn.addEventListener("click", () => goto(Number(btn.dataset.index))));
  }
  function goto(next) {
    step = Math.max(0, Math.min(maxAllowedStep(), next));
    const id = STEPS[step][0];
    document.querySelectorAll(".step-panel").forEach((el) => el.classList.toggle("hidden", el.dataset.step !== id));
    renderRail();
    $("eyebrow").textContent = TITLES[id][0];
    $("title").textContent = TITLES[id][1];
    $("subtitle").textContent = TITLES[id][2];
    $("stepNum").textContent = String(step + 1).padStart(2, "0");
    $("stepSlug").textContent = STEPS[step][1].toLowerCase();
    $("backBtn").disabled = step === 0 || runState === "running";
    $("skipBtn").classList.toggle("hidden", !(id === "admin" || id === "site"));
    $("skipBtn").disabled = runState === "running";
    $("primaryBtn").disabled = runState === "running";
    $("primaryBtn").className = "btn" + (id === "migrate" ? " btn-brand" : "");
    $("primaryBtn").textContent = id === "database" && !dbOk ? "Test connection" : id === "migrate" ? (runState === "error" ? "Retry" : "Run setup") : id === "done" ? "Finish" : "Continue";
    if (id === "env") renderEnv();
    if (id === "migrate") renderTasks();
    hydrateIcons();
  }
  function setDbMode(mode) {
    dbMode = mode;
    $("dbModeUrl").setAttribute("aria-selected", String(mode === "url"));
    $("dbModeFields").setAttribute("aria-selected", String(mode === "fields"));
    $("dbUrlPane").classList.toggle("hidden", mode !== "url");
    $("dbFieldsPane").classList.toggle("hidden", mode !== "fields");
    renderEnv();
  }
  function renderEnv() {
    const p = payload();
    const rows = [
      ["comment", "Generated by pnpm run setup"],
      ["blank", ""],
      ["kv", "DATABASE_URL", p.databaseUrl],
      ...(p.testDatabaseUrl ? [["kv", "TEST_DATABASE_URL", p.testDatabaseUrl]] : []),
      ["kv", "NP_SECRET", p.npSecret],
      ["kv", "SITE_URL", p.siteUrl],
      ["kv", "NP_SITE_NAME", p.siteName || "My Site"],
      ["kv", "NP_DEFAULT_LOCALE", $("locale").value],
      ["kv", "NP_DEFAULT_TZ", $("timezone").value],
      ...(p.storage === "s3"
        ? [["kv", "NP_STORAGE_ADAPTER", "s3"], ["kv", "NP_S3_BUCKET", p.s3Bucket || ""], ["kv", "NP_S3_REGION", p.s3Region || ""], ...(p.s3Endpoint ? [["kv", "NP_S3_ENDPOINT", p.s3Endpoint]] : [])]
        : [["comment", "NP_STORAGE_ADAPTER=local (default)"]]),
      ...(p.adminEmail ? [["blank", ""], ["comment", "first-boot admin prefill"], ["kv", "NP_ADMIN_EMAIL", p.adminEmail], ...(p.adminName ? [["kv", "NP_ADMIN_NAME", p.adminName]] : []), ...(p.adminThemeId ? [["kv", "NP_ADMIN_THEME", p.adminThemeId]] : [])] : []),
      ["blank", ""],
      ["comment", "Email defaults to Mailpit on localhost:1025"],
    ];
    $("envPreview").innerHTML = rows.map((row) => {
      if (row[0] === "blank") return "";
      if (row[0] === "comment") return '<span class="c"># ' + esc(row[1]) + '</span>';
      return '<span class="k">' + esc(row[1]) + '</span><span class="eq">=</span><span class="s">' + esc(row[2]) + '</span>';
    }).join("\\n");
  }
  async function loadSystemChecks() {
    $("scanTime").textContent = "scanning...";
    try {
      const res = await fetch("/system-check?token=" + TOKEN);
      const body = await res.json();
      $("scanTime").textContent = "scanned · " + new Date().toISOString().replace("T", " ").slice(0, 19);
      $("systemRows").innerHTML = body.checks.map((row) => '<div class="env-row"><span class="row-state tone-' + row.tone + '">' + iconForTone(row.tone) + '</span><div><div class="row-name">' + esc(row.name) + '</div><div class="row-sub">requires ' + esc(row.required) + '</div></div><span class="row-ver">' + esc(row.version) + '</span><span class="row-state tone-' + row.tone + '">' + row.tone.toUpperCase() + '</span></div>').join("");
    } catch (err) {
      $("scanTime").textContent = "scan failed";
      $("systemRows").innerHTML = '<div class="env-row"><span class="row-state tone-err">!</span><div><div class="row-name">System check unavailable</div><div class="row-sub">' + esc(err) + '</div></div><span></span><span class="row-state tone-err">ERR</span></div>';
    }
  }
  function updatePasswordChecks() {
    const pass = $("adminPassword").value;
    const checks = [
      ["at least 12 characters", pass.length >= 12],
      ["upper and lowercase", /[A-Z]/.test(pass) && /[a-z]/.test(pass)],
      ["includes a number", /[0-9]/.test(pass)],
      ["includes a symbol", /[^A-Za-z0-9]/.test(pass)],
    ];
    $("passwordChecks").innerHTML = checks.map((c) => '<li data-ok="' + c[1] + '">✓ ' + c[0] + '</li>').join("");
  }
  function logRow(level, msg) {
    const now = (performance.now() / 1000).toFixed(3) + "s";
    $("runLog").innerHTML += '<div class="log-row log-' + level + '"><span class="log-time">' + now + '</span><span class="log-lvl">' + level + '</span><span>' + esc(msg) + '</span></div>';
    $("runLog").scrollTop = $("runLog").scrollHeight;
  }
  function taskState(i) {
    const taskId = TASKS[i][0];
    if (runState === "success") return skippedTaskIds.has(taskId) ? "skipped" : "done";
    if (runState === "error") return i < taskCursor ? "done" : i === taskCursor ? "error" : "pending";
    if (runState === "running") return i < taskCursor ? "done" : i === taskCursor ? "running" : "pending";
    return "pending";
  }
  function taskTimeLabel(state) {
    if (state === "pending") return "-";
    if (state === "running") return "...";
    if (state === "skipped") return "skip";
    if (state === "error") return "fail";
    return "ok";
  }
  function renderTasks() {
    const skipped = runState === "success" ? skippedTaskIds.size : 0;
    const complete = TASKS.length - skipped;
    const done = runState === "success" ? TASKS.length : taskCursor;
    const pct = runState === "idle" ? 0 : Math.round((done / TASKS.length) * 100);
    $("progressLabel").innerHTML = runState === "idle" ? "Ready to run · " + TASKS.length + " tasks queued" : runState === "running" ? "Running · task <strong>" + Math.min(done + 1, TASKS.length) + "</strong> of " + TASKS.length : runState === "error" ? "Stopped · " + done + " of " + TASKS.length + " complete" : skipped > 0 ? "Complete · " + complete + " complete, " + skipped + " skipped" : "Complete · " + TASKS.length + " of " + TASKS.length + " tasks";
    $("progressFill").style.width = pct + "%";
    $("progressFill").style.background = runState === "error" ? "var(--nx-danger)" : "var(--nx-brand)";
    $("progressPct").innerHTML = "<strong>" + pct + "</strong>%";
    $("taskList").innerHTML = TASKS.map((t, i) => {
      const st = taskState(i);
      const mark = st === "done" ? "✓" : st === "error" ? "!" : st === "skipped" ? "-" : "";
      return '<div class="task-row" data-state="' + st + '"><span class="task-icon">' + mark + '</span><div><div class="row-name">' + t[1] + '</div><div class="row-sub">' + esc(t[2]) + '</div></div><span class="task-time">' + taskTimeLabel(st) + '</span><span class="row-state">' + (st === "running" ? "running..." : st === "pending" ? "queued" : st) + '</span></div>';
    }).join("");
  }
  function taskIndex(id) {
    return typeof id === "string" && Number.isInteger(TASK_INDEX[id]) ? TASK_INDEX[id] : taskCursor;
  }
  function failRun(message, taskId) {
    runState = "error";
    clearInterval(taskTimer);
    taskCursor = taskIndex(taskId);
    $("runErrorText").textContent = message || "Setup failed.";
    $("runError").classList.remove("hidden");
    logRow("err", message || "setup failed");
    renderTasks();
    goto(5);
  }
  function succeedRun(body) {
    runState = "success";
    setupComplete = true;
    skippedTaskIds = new Set((body.firstBoot && body.firstBoot.skippedTasks) || []);
    taskCursor = TASKS.length;
    clearInterval(taskTimer);
    $("runError").classList.add("hidden");
    logRow("ok", "setup complete");
    lastResult = body;
    renderTasks();
    const firstBootReady = body.firstBoot && !body.firstBoot.skipped;
    const themeSkipped = skippedTaskIds.has("theme");
    const seedSkipped = skippedTaskIds.has("seed");
    $("doneText").textContent = firstBootReady ? "Admin and environment are ready." : "Environment is ready. Continue first admin and theme setup at /admin/setup after pnpm dev.";
    $("doneLog").innerHTML = '<span class="h">$</span> pnpm run setup\\n' +
      '<span class="c">  -> wrote .env</span>\\n' +
      '<span class="c">  -> migration status checked</span>\\n' +
      '<span class="c">  -> migrations ' + (body.migrate ? "applied" : "skipped") + '</span>\\n' +
      '<span class="c">  -> ' + (body.firstBoot && !body.firstBoot.skipped ? "first admin ready" : "first admin skipped") + '</span>\\n' +
      '<span class="c">  -> theme ' + (firstBootReady && !themeSkipped ? "activated" : "skipped") + '</span>\\n' +
      '<span class="c">  -> demo content ' + (firstBootReady && !seedSkipped ? "seeded" : "skipped") + '</span>\\n' +
      '<span class="c">  -> next deploy plan: pnpm run deploy:plan -- --target vercel</span>\\n' +
      '<span class="c">  -> next production doctor: pnpm run doctor:prod -- --target vercel</span>\\n' +
      '<span class="c">  -> if blocked: pnpm run doctor:prod -- --target vercel --fix-plan</span>\\n' +
      '<span class="v">  ✓ done — run pnpm dev, then open /admin</span>';
    goto(6);
  }
  async function runSetup() {
    runState = "running"; taskCursor = 0; skippedTaskIds = new Set(); $("runLog").innerHTML = ""; $("runError").classList.add("hidden"); renderTasks(); goto(5);
    logRow("info", "starting nexpress setup");
    taskTimer = setInterval(() => { if (taskCursor < TASKS.length - 1) { taskCursor += 1; renderTasks(); logRow("info", "running " + TASKS[taskCursor][1]); } }, 900);
    try {
      const res = await fetch("/save?token=" + TOKEN, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(payload()) });
      const body = await res.json();
      if (!body.ok) { failRun(body.message || "Save failed", "env"); return; }
      const failed = (body.migrate && !body.migrate.ok && { label:"migrations", output:body.migrate.output, taskId:body.migrate.failedTask || "migrate" }) || (body.firstBoot && !body.firstBoot.ok && { label:"first-admin setup", output:body.firstBoot.output, taskId:body.firstBoot.failedTask || "admin" });
      if (failed) { failRun(failed.label + " failed: " + (failed.output || ""), failed.taskId); return; }
      succeedRun(body);
    } catch (err) {
      failRun(String(err), "env");
    }
  }
  $("backBtn").addEventListener("click", () => goto(step - 1));
  $("primaryBtn").addEventListener("click", () => {
    const id = STEPS[step][0];
    if (id === "database" && !dbOk) $("testBtn").click();
    else if (id === "migrate") runSetup();
    else if (id === "done") window.close();
    else goto(step + 1);
  });
  $("skipBtn").addEventListener("click", () => {
    const id = STEPS[step][0];
    if (id === "admin") {
      $("adminEmail").value = "";
      $("adminName").value = "";
      $("adminPassword").value = "";
      updatePasswordChecks();
    }
    goto(step + 1);
  });
  $("retryBtn").addEventListener("click", runSetup);
  $("dbModeUrl").addEventListener("click", () => setDbMode("url"));
  $("dbModeFields").addEventListener("click", () => setDbMode("fields"));
  $("testBtn").addEventListener("click", async () => {
    $("testStatus").textContent = "Testing...";
    try {
      const res = await fetch("/test-db?token=" + TOKEN, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ url: databaseUrl() }) });
      const body = await res.json();
      dbOk = body.ok === true;
      $("testStatus").innerHTML = '<span class="tone-' + (body.ok ? "ok" : "err") + '">' + esc(body.message || (body.ok ? "Connected" : "Failed")) + '</span>';
      // On port-collision failures the server includes a scanned
      // free port. Auto-fill the dbPort input (fields mode) or
      // splice the URL's port (url mode) so the operator can hit
      // "Test connection" again without retyping the recommendation
      // out of the message body. Skips when no suggestion came back
      // (any non-collision failure) or when the suggestion isn't a
      // positive integer.
      if (!body.ok && typeof body.suggestedPort === "number" && body.suggestedPort > 0) {
        applyPortSuggestion(body.suggestedPort);
      }
      if (dbOk) goto(step);
    } catch (err) {
      dbOk = false;
      $("testStatus").innerHTML = '<span class="tone-err">' + esc(err) + '</span>';
    }
  });
  function applyPortSuggestion(port) {
    if (dbMode === "fields") {
      $("dbPort").value = String(port);
    } else {
      // URL mode — best-effort: parse the current connection
      // string, swap the port, write it back. Leave the URL
      // untouched if the operator typed something we can't parse;
      // the message body still names the suggested port and they
      // can edit manually.
      try {
        const u = new URL($("databaseUrl").value.trim());
        u.port = String(port);
        $("databaseUrl").value = u.toString();
      } catch (e) {
        return;
      }
    }
    renderEnv();
  }
  $("revealPassword").addEventListener("click", () => {
    const input = $("adminPassword");
    input.type = input.type === "password" ? "text" : "password";
    $("revealPassword").textContent = input.type === "password" ? "view" : "hide";
  });
  $("adminPassword").addEventListener("input", updatePasswordChecks);
  $("regenSecret").addEventListener("click", () => { secret = makeSecret(); renderEnv(); });
  $("storage").addEventListener("change", () => { $("s3Fields").classList.toggle("hidden", $("storage").value !== "s3"); renderEnv(); });
  document.querySelectorAll("input,select,textarea").forEach((el) => el.addEventListener("input", () => {
    if (["databaseUrl","dbHost","dbPort","dbName","dbUser","dbPass"].includes(el.id)) {
      dbOk = false;
      $("testStatus").textContent = "";
      goto(step);
    }
    renderEnv();
  }));
  updatePasswordChecks();
  loadSystemChecks();
  hydrateIcons();
  renderRail();
  goto(0);
</script>
</body>
</html>`;
}
