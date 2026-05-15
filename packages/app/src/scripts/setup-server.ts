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
 * `db:generate` + `db:migrate`, then exits.
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
import { access, copyFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

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

const args = process.argv.slice(2);
const PORT = Number(getArg("--port") ?? "3001");
const TOKEN = randomUUID();

// Pure validator lives in its own module so unit tests can import
// `validateBody` without triggering this script's top-level
// `createServer` side-effect.
import { type SetupBody, validateBody } from "./setup-server-validate.js";

/**
 * `pnpm run setup` supports three modes:
 *
 *   - **http** (default) — opens a localhost HTTP server with a
 *     wizard UI. Best for first-time operators on a desktop.
 *   - **cli** — terminal prompts via `readline/promises`. Picks up
 *     automatically when run on a headless / SSH session, or
 *     forced via `--cli`.
 *   - **non-interactive** — reads everything from env vars, no
 *     prompts. Forced via `--non-interactive` or env var
 *     `NP_SETUP_NONINTERACTIVE=1`. Required env: `DATABASE_URL`.
 *     Optional: `NP_SECRET` (auto-generated if absent), `SITE_URL`
 *     (defaults to http://localhost:3000), `NP_STORAGE_ADAPTER`
 *     (`local` | `s3`, default `local`), `NP_S3_*` (when storage
 *     is `s3`), `NP_SETUP_RUN_MIGRATIONS` (`true` | `false`,
 *     default `true`).
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
    process.platform === "linux" &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY;
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
    const url = `http://localhost:${PORT}/?token=${TOKEN}`;
    console.log("");
    console.log("  NexPress setup");
    console.log("  --------------");
    console.log(`  Open ${url}`);
    console.log(`  Writes .env → ${ENV_PATH}`);
    console.log("  (IDE may hide gitignored files)");
    console.log("  (server binds 127.0.0.1 only; press Ctrl+C to abort)");
    console.log("  (no browser? use `pnpm setup --cli` or `pnpm setup --non-interactive`)");
    console.log("");
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Token gate. Every endpoint requires `?token=…` matching the
  // one printed at startup. Saves the operator from a stray
  // process on the same machine racing the setup form.
  if (url.searchParams.get("token") !== TOKEN) {
    res.statusCode = 403;
    res.setHeader("content-type", "text/plain");
    res.end("Forbidden — wrong or missing setup token. Re-open the URL printed by `pnpm run setup`.");
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(renderHtml());
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
    let migrate: { ok: boolean; output: string } | null = null;
    if (validated.body.runMigrate) {
      migrate = await runMigrations(validated.body);
    }
    sendJson(res, 200, { ok: true, migrate });
    // Quit only on full success — if any step failed, keep the
    // server alive so the operator can fix the form and re-submit
    // (instead of having to restart `pnpm run setup`).
    const allOk = !migrate || migrate.ok;
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
  lines.push(`NP_SECRET=${body.npSecret}`, `SITE_URL=${body.siteUrl}`, "");

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
  query(text: string): Promise<{ rows: Array<{ version: string }> }>;
  end(): Promise<void>;
}

interface PgModuleLike {
  default: {
    Client: new (config: { connectionString: string; connectionTimeoutMillis?: number }) => PgClientLike;
  };
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
async function probeExistingFrameworkTables(
  url: string,
): Promise<{ existing: number }> {
  let pg: PgModuleLike;
  try {
    // Resolve `pg` from the project root (not this module's
    // location in node_modules/@nexpress/app/...) so pnpm's strict
    // hoisting finds the consumer-installed copy reliably.
    const require = createRequire(resolve(PROJECT_DIR, "package.json"));
    const resolved = require.resolve("pg");
    pg = (await import(resolved)) as unknown as PgModuleLike;
  } catch {
    return { existing: 0 };
  }
  const client = new pg.default.Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();

    // If drizzle has already migrated this DB (regardless of
    // hash match), assume it belongs to this project and let
    // drizzle-kit handle idempotency. Catches the "operator
    // re-runs `pnpm setup`" case that previously false-
    // positived. The table only exists once drizzle-kit migrate
    // has succeeded at least once.
    type CountRow = { rows: Array<{ n: number }> };
    let trackedCount = 0;
    try {
      const tracked = (await client.query(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      )) as unknown as CountRow;
      trackedCount = tracked.rows[0]?.n ?? 0;
    } catch {
      // table doesn't exist → drizzle hasn't touched this DB
      trackedCount = 0;
    }
    if (trackedCount > 0) {
      await client.end();
      return { existing: 0 };
    }

    const result = (await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'np\\_%' ESCAPE '\\'",
    )) as unknown as CountRow;
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
): Promise<{ ok: boolean; message: string }> {
  // `pg` ships transitively via `@nexpress/core`. We dynamic-import
  // to avoid loading it on every setup invocation, and structurally
  // type the surface we touch so this file doesn't depend on
  // `@types/pg` being declared at the apps/web layer.
  // `pg` ships transitively via `@nexpress/core`. tsx's dynamic
  // import doesn't resolve transitives at the apps/web layer, so
  // we widen the search via createRequire (which honors Node's
  // full module resolution including pnpm's hoisted store) and
  // hand the resolved path back to the dynamic import.
  let pg: PgModuleLike;
  try {
    // Resolve `pg` from the project root (not this module's
    // location in node_modules/@nexpress/app/...) so pnpm's strict
    // hoisting finds the consumer-installed copy reliably.
    const require = createRequire(resolve(PROJECT_DIR, "package.json"));
    const resolved = require.resolve("pg");
    pg = (await import(resolved)) as unknown as PgModuleLike;
  } catch {
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
    const result = await client.query("select version()");
    await client.end();
    const version = result.rows[0]?.version ?? "unknown";
    return { ok: true, message: `Connected — ${version.split(" ").slice(0, 2).join(" ")}` };
  } catch (err) {
    try {
      await client.end();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runMigrations(body: SetupBody): Promise<{ ok: boolean; output: string }> {
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
    return { ok: false, output: message };
  }

  console.log("[setup] running pnpm db:generate …");
  const gen = await runChild(["pnpm", "run", "db:generate"], env);
  if (!gen.ok) {
    console.log("[setup] db:generate FAILED");
    return gen;
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
    return { ok: false, output: gen.output + mig.output };
  }
  console.log("[setup] migrations applied");
  return { ok: true, output: gen.output + mig.output };
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
        rejectBody(err);
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
  const arg = args[idx]!;
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
  console.log(
    "  (press Ctrl+C at any prompt to abort — nothing is written until the end)",
  );
  console.log("");

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
      process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    );
    const npSecretInput = await ask(
      "NP_SECRET (Enter to auto-generate 64-char hex)",
      "",
    );
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
    if (storage === "s3") {
      body.s3Bucket = await ask("S3 bucket (NP_S3_BUCKET)", process.env.NP_S3_BUCKET);
      body.s3Region = await ask(
        "S3 region (NP_S3_REGION)",
        process.env.NP_S3_REGION ?? "auto",
      );
      const ep = await ask(
        "S3 endpoint URL (NP_S3_ENDPOINT — leave blank for AWS)",
        process.env.NP_S3_ENDPOINT ?? "",
      );
      if (ep) body.s3Endpoint = ep;
    }

    body.runMigrate = await askBool("Run pnpm db:generate + db:migrate now?", true);

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

    console.log("");
    console.log("✓ Setup complete. Run `pnpm dev` to start NexPress.");
    process.exit(0);
  } catch (err) {
    rl.close();
    throw err;
  }
}

async function runNonInteractive(): Promise<void> {
  // Reads from real `process.env` so a CI / dotfile / fly secrets
  // flow can dictate everything without a TTY. Reuses the
  // operator-facing env-var names (`DATABASE_URL`, `NP_SECRET`,
  // `SITE_URL`, `NP_STORAGE_ADAPTER`, `NP_S3_*`) plus one wizard-
  // specific knob (`NP_SETUP_RUN_MIGRATIONS`).
  console.log("");
  console.log("  NexPress setup (non-interactive mode)");
  console.log("  -------------------------------------");
  console.log(`  Will write .env → ${ENV_PATH}`);
  console.log("");

  const storage = (process.env.NP_STORAGE_ADAPTER === "s3" ? "s3" : "local") as
    | "local"
    | "s3";
  const runMigrate =
    (process.env.NP_SETUP_RUN_MIGRATIONS ?? "true").toLowerCase() !== "false";
  const body: SetupBody = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    npSecret: process.env.NP_SECRET ?? generatedSecret(),
    siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
    storage,
    runMigrate,
  };
  if (storage === "s3") {
    if (process.env.NP_S3_BUCKET) body.s3Bucket = process.env.NP_S3_BUCKET;
    if (process.env.NP_S3_REGION) body.s3Region = process.env.NP_S3_REGION;
    if (process.env.NP_S3_ENDPOINT) body.s3Endpoint = process.env.NP_S3_ENDPOINT;
  }
  if (process.env.TEST_DATABASE_URL) body.testDatabaseUrl = process.env.TEST_DATABASE_URL;

  const validated = validateBody(body);
  if ("error" in validated) {
    console.error(`✗ Invalid setup input: ${validated.error}`);
    console.error("");
    console.error("Required env vars for non-interactive mode:");
    console.error("  DATABASE_URL              postgres://...");
    console.error("Optional:");
    console.error("  NP_SECRET                 (auto-generated if absent; ≥32 chars)");
    console.error("  SITE_URL                  (defaults to http://localhost:3000)");
    console.error("  NP_STORAGE_ADAPTER        local | s3 (default local)");
    console.error("  NP_S3_BUCKET / NP_S3_REGION / NP_S3_ENDPOINT");
    console.error("  TEST_DATABASE_URL         (integration tests; copied as-is)");
    console.error("  NP_SETUP_RUN_MIGRATIONS   true | false (default true)");
    process.exit(1);
  }

  await saveEnv(validated.body);
  console.log(`[setup] wrote ${ENV_PATH}`);

  if (runMigrate) {
    const result = await runMigrations(validated.body);
    if (!result.ok) {
      console.error("");
      console.error("✗ migrations FAILED — full output above");
      process.exit(1);
    }
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

function renderHtml(): string {
  const defaultSecret = generatedSecret();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>NexPress · Setup</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  p.lead { color: #666; margin-top: 0; }
  fieldset { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
  legend { font-weight: 600; padding: 0 0.5rem; }
  label { display: block; font-size: 0.9rem; margin-top: 0.6rem; }
  label .hint { display: block; font-weight: 400; color: #888; font-size: 0.8rem; margin-top: 0.1rem; }
  input[type=text], input[type=url], input[type=password] {
    width: 100%; box-sizing: border-box; padding: 0.5rem 0.7rem; margin-top: 0.25rem;
    font: inherit; border: 1px solid #bbb; border-radius: 6px; background: white;
  }
  .row { display: flex; gap: 0.75rem; }
  .row > * { flex: 1; }
  .radios { display: flex; gap: 1rem; margin-top: 0.5rem; }
  .radios label { display: inline-flex; gap: 0.4rem; align-items: center; margin: 0; }
  button {
    font: inherit; padding: 0.5rem 0.9rem; border-radius: 6px;
    border: 1px solid #aaa; background: #f5f5f5; cursor: pointer;
  }
  button.primary { background: #1f6feb; color: white; border-color: #1f6feb; }
  button:disabled { opacity: 0.5; cursor: progress; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  #status { padding: 0.5rem 0.75rem; border-radius: 6px; margin-top: 0.5rem; font-size: 0.9rem; }
  #status.ok { background: #ddf4dd; color: #1a6d1a; }
  #status.err { background: #fde0e0; color: #8b1a1a; }
  #status.info { background: #eef3fb; color: #345; }
  .s3-fields[hidden] { display: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #ddd; }
    fieldset { border-color: #333; }
    p.lead, .hint { color: #999; }
    input { background: #1a1a1a; color: #ddd; border-color: #444; }
    button { background: #222; color: #ddd; border-color: #444; }
  }
</style>
</head>
<body>
<h1>NexPress setup</h1>
<p class="lead">One-shot wizard to write <code>.env</code>. The page closes itself when you finish.</p>
<p class="hint" style="margin-top: 0.35rem;">
  Saves to <code>${escapeHtml(ENV_PATH)}</code>. Hidden in some editors when <code>.env</code> is gitignored.
</p>

<form id="form">
  <fieldset>
    <legend>Database</legend>
    <label>
      <span>DATABASE_URL</span>
      <span class="hint">Postgres connection string. Default uses your project name as the DB: <code>${DEFAULT_DATABASE_URL}</code>. Create the DB first with <code>psql -c "CREATE DATABASE ${DEFAULT_DB_NAME};"</code> on your Postgres.</span>
      <input id="databaseUrl" name="databaseUrl" type="text" required spellcheck="false"
             value="${DEFAULT_DATABASE_URL}" />
    </label>
    <label>
      <span>TEST_DATABASE_URL <em>(optional)</em></span>
      <span class="hint">Used by <code>pnpm test:integration</code>. Leave blank if you don't run integration tests.</span>
      <input id="testDatabaseUrl" name="testDatabaseUrl" type="text" spellcheck="false"
             value="${DEFAULT_TEST_DATABASE_URL}" />
    </label>
    <div class="row" style="margin-top: 0.7rem; align-items: center;">
      <button type="button" id="testBtn">Test connection</button>
      <span id="testStatus"></span>
    </div>
  </fieldset>

  <fieldset>
    <legend>Secrets &amp; URLs</legend>
    <label>
      <span>NP_SECRET</span>
      <span class="hint">JWT signing key. We generated 32 random bytes; rotate freely. Anything ≥32 chars works.</span>
      <input id="npSecret" name="npSecret" type="text" required spellcheck="false" value="${defaultSecret}" />
    </label>
    <label>
      <span>SITE_URL</span>
      <span class="hint">Public origin. Used for og:url, password-reset links, OpenAPI server entry.</span>
      <input id="siteUrl" name="siteUrl" type="url" required value="http://localhost:3000" />
    </label>
  </fieldset>

  <fieldset>
    <legend>Storage</legend>
    <div class="radios">
      <label><input type="radio" name="storage" value="local" checked /> Local filesystem</label>
      <label><input type="radio" name="storage" value="s3" /> S3 / R2 / MinIO</label>
    </div>
    <div class="s3-fields" hidden>
      <label>
        <span>Bucket</span>
        <input id="s3Bucket" name="s3Bucket" type="text" />
      </label>
      <label>
        <span>Region</span>
        <input id="s3Region" name="s3Region" type="text" value="us-east-1" />
      </label>
      <label>
        <span>Endpoint <em>(R2 / MinIO)</em></span>
        <span class="hint">Leave blank for AWS S3.</span>
        <input id="s3Endpoint" name="s3Endpoint" type="text" />
      </label>
    </div>
  </fieldset>

  <fieldset>
    <legend>After save</legend>
    <label style="display: flex; gap: 0.5rem; align-items: flex-start;">
      <input id="runMigrate" type="checkbox" checked style="margin-top: 0.3rem;" />
      <span>
        <span>Run <code>pnpm db:generate</code> + <code>pnpm db:migrate</code> automatically</span>
        <span class="hint">Skip if you'd rather run them yourself afterward.</span>
      </span>
    </label>
  </fieldset>

  <div id="status"></div>
  <div class="actions">
    <button type="submit" class="primary" id="saveBtn">Save and finish</button>
  </div>
  <p class="hint" style="margin-top: 0.4rem;">
    "Save and finish" writes <code>.env</code> and, if checked, runs migrations, then exits.
  </p>
</form>

<script>
  const TOKEN = ${JSON.stringify(TOKEN)};
  const SETUP_ENV_PATH = ${JSON.stringify(ENV_PATH)};
  const SETUP_PROJECT_DIR = ${JSON.stringify(PROJECT_DIR)};
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  const testStatus = $("testStatus");

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = kind || "";
  }

  document.querySelectorAll("input[name=storage]").forEach((el) => {
    el.addEventListener("change", () => {
      const isS3 = document.querySelector("input[name=storage]:checked").value === "s3";
      document.querySelector(".s3-fields").hidden = !isS3;
    });
  });

  $("testBtn").addEventListener("click", async () => {
    testStatus.textContent = "Testing…";
    testStatus.className = "info";
    try {
      const res = await fetch("/test-db?token=" + TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: $("databaseUrl").value }),
      });
      const body = await res.json();
      testStatus.textContent = body.message || (body.ok ? "OK" : "Failed");
      testStatus.className = body.ok ? "ok" : "err";
      testStatus.style.padding = "0.25rem 0.6rem";
      testStatus.style.borderRadius = "6px";
      testStatus.style.background = body.ok ? "#ddf4dd" : "#fde0e0";
      testStatus.style.color = body.ok ? "#1a6d1a" : "#8b1a1a";
    } catch (err) {
      testStatus.textContent = String(err);
      testStatus.className = "err";
    }
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("saveBtn").disabled = true;
    setStatus("Saving .env…", "info");
    const storage = document.querySelector("input[name=storage]:checked").value;
    const payload = {
      databaseUrl: $("databaseUrl").value.trim(),
      testDatabaseUrl: $("testDatabaseUrl").value.trim(),
      npSecret: $("npSecret").value.trim(),
      siteUrl: $("siteUrl").value.trim(),
      storage,
      s3Bucket: storage === "s3" ? $("s3Bucket").value.trim() : undefined,
      s3Region: storage === "s3" ? $("s3Region").value.trim() : undefined,
      s3Endpoint: storage === "s3" ? $("s3Endpoint").value.trim() : undefined,
      runMigrate: $("runMigrate").checked,
    };
    try {
      const res = await fetch("/save?token=" + TOKEN, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.ok) {
        setStatus(body.message || "Save failed", "err");
        $("saveBtn").disabled = false;
        return;
      }
      const failed =
        body.migrate && !body.migrate.ok && { label: "migrations", output: body.migrate.output };
      if (failed) {
        // Pre-flight check (DB already populated) returns a
        // multi-line actionable message in 'output'. Other
        // failures (drizzle-kit silent exit etc.) have only a
        // short footer line — for those we point the operator
        // at their terminal where drizzle-kit's real output is.
        const raw = (failed.output || "").trim();
        const isPreflight = raw.includes("already contains") && raw.includes("NexPress tables");
        const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const preflightBox = isPreflight
          ? "<pre style=\\"white-space:pre-wrap;background:#111;color:#eee;padding:.7rem;border-radius:6px;font-size:.8rem;margin-top:.5rem;\\">" + escape(raw) + "</pre>"
          : "<br>The migration output is in the terminal that's running \\\`pnpm run setup\\\` — switch back to that window to see what drizzle-kit reported." +
            "<br><br>To re-run the migration directly:" +
            "<pre style=\\"white-space:pre-wrap;background:#111;color:#eee;padding:.7rem;border-radius:6px;font-size:.8rem;margin-top:.3rem;\\">cd " +
            escape(SETUP_PROJECT_DIR) + " && pnpm exec drizzle-kit migrate</pre>";
        status.innerHTML =
          ".env written, but <strong>" + failed.label + " FAILED</strong>." + preflightBox;
        status.className = "err";
        $("saveBtn").disabled = false;
        return;
      }
      const parts = [".env written to " + SETUP_ENV_PATH + "."];
      if (body.migrate) parts.push("Migrations applied.");
      parts.push("You can close this tab and run \\\`pnpm dev\\\`.");
      setStatus(parts.join(" "), "ok");
    } catch (err) {
      setStatus(String(err), "err");
      $("saveBtn").disabled = false;
    }
  });
</script>
</body>
</html>`;
}
