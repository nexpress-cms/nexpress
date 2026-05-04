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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** `apps/web` — cwd for spawned `pnpm db:*` (package scripts live here). */
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..");
/**
 * Repository-root `.env`, matching `.env.example`, root `package.json --env-file`,
 * `drizzle.config.ts`, and `scripts/_load-env.ts` (root wins over `apps/web/.env`).
 */
const ENV_PATH = resolve(PACKAGE_DIR, "..", "..", ".env");

const args = process.argv.slice(2);
const PORT = Number(getArg("--port") ?? "3001");
const TOKEN = randomUUID();

interface SetupBody {
  databaseUrl: string;
  testDatabaseUrl?: string;
  nxSecret: string;
  siteUrl: string;
  storage: "local" | "s3";
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  runMigrate: boolean;
}

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
  console.log("  (repository root — same as .env.example; IDE may hide gitignored files)");
  console.log("  (server binds 127.0.0.1 only; press Ctrl+C to abort)");
  console.log("");
});

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

function validateBody(
  raw: Partial<SetupBody>,
): { body: SetupBody } | { error: string } {
  const databaseUrl = (raw.databaseUrl ?? "").trim();
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    return { error: "DATABASE_URL must start with postgres:// or postgresql://" };
  }
  const nxSecret = (raw.nxSecret ?? "").trim();
  if (nxSecret.length < 32) {
    return { error: "NX_SECRET must be at least 32 characters" };
  }
  const siteUrl = (raw.siteUrl ?? "").trim();
  if (!/^https?:\/\//.test(siteUrl)) {
    return { error: "SITE_URL must start with http:// or https://" };
  }
  const storage = raw.storage === "s3" ? "s3" : "local";
  if (storage === "s3") {
    if (!raw.s3Bucket?.trim()) return { error: "S3 bucket is required" };
    if (!raw.s3Region?.trim()) return { error: "S3 region is required" };
  }
  return {
    body: {
      databaseUrl,
      testDatabaseUrl: raw.testDatabaseUrl?.trim() || undefined,
      nxSecret,
      siteUrl,
      storage,
      s3Bucket: raw.s3Bucket?.trim() || undefined,
      s3Region: raw.s3Region?.trim() || undefined,
      s3Endpoint: raw.s3Endpoint?.trim() || undefined,
      runMigrate: raw.runMigrate !== false,
    },
  };
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
  lines.push(`NX_SECRET=${body.nxSecret}`, `SITE_URL=${body.siteUrl}`, "");

  if (body.storage === "s3") {
    lines.push(
      "NX_STORAGE_ADAPTER=s3",
      `NX_S3_BUCKET=${body.s3Bucket ?? ""}`,
      `NX_S3_REGION=${body.s3Region ?? ""}`,
    );
    if (body.s3Endpoint) lines.push(`NX_S3_ENDPOINT=${body.s3Endpoint}`);
  } else {
    lines.push("# NX_STORAGE_ADAPTER=local (default)");
  }
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
    const require = createRequire(import.meta.url);
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
  console.log("");
  console.log("[setup] running pnpm db:generate …");
  const gen = await runChild(["pnpm", "run", "db:generate"], env);
  if (!gen.ok) {
    console.log("[setup] db:generate FAILED");
    return gen;
  }
  console.log("[setup] running pnpm db:migrate …");
  const mig = await runChild(["pnpm", "run", "db:migrate"], env);
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
    const child = spawn(cmd!, args, {
      cwd: PACKAGE_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const tee = (label: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString();
      buf += text;
      // Mirror to the terminal that started `pnpm run setup` so
      // operators can actually read the failure when something
      // goes wrong (used to be silent — output only made it to
      // the JSON response).
      const stream = label === "stdout" ? process.stdout : process.stderr;
      stream.write(text);
    };
    child.stdout?.on("data", tee("stdout"));
    child.stderr?.on("data", tee("stderr"));
    child.on("error", (err) => {
      resolvePromise({ ok: false, output: `${buf}\n${err.message}` });
    });
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0, output: buf });
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
    NX_SECRET: body.nxSecret,
    SITE_URL: body.siteUrl,
  };
  if (body.testDatabaseUrl) env.TEST_DATABASE_URL = body.testDatabaseUrl;
  if (body.storage === "s3") {
    env.NX_STORAGE_ADAPTER = "s3";
    if (body.s3Bucket) env.NX_S3_BUCKET = body.s3Bucket;
    if (body.s3Region) env.NX_S3_REGION = body.s3Region;
    if (body.s3Endpoint) env.NX_S3_ENDPOINT = body.s3Endpoint;
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
  return randomBytes(32).toString("base64url");
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
  Saves to <code>${escapeHtml(ENV_PATH)}</code> (monorepo repository root — next to <code>.env.example</code>). Hidden in some editors when <code>.env</code> is gitignored.
</p>

<form id="form">
  <fieldset>
    <legend>Database</legend>
    <label>
      <span>DATABASE_URL</span>
      <span class="hint">Postgres connection string. The local Docker preset is <code>postgres://nexpress:nexpress@localhost:5433/nexpress</code>.</span>
      <input id="databaseUrl" name="databaseUrl" type="text" required spellcheck="false"
             value="postgres://nexpress:nexpress@localhost:5433/nexpress" />
    </label>
    <label>
      <span>TEST_DATABASE_URL <em>(optional)</em></span>
      <span class="hint">Used by <code>pnpm test:integration</code>. Leave blank if you don't run integration tests.</span>
      <input id="testDatabaseUrl" name="testDatabaseUrl" type="text" spellcheck="false"
             value="postgres://nexpress:nexpress@localhost:5433/nexpress_test" />
    </label>
    <div class="row" style="margin-top: 0.7rem; align-items: center;">
      <button type="button" id="testBtn">Test connection</button>
      <span id="testStatus"></span>
    </div>
  </fieldset>

  <fieldset>
    <legend>Secrets &amp; URLs</legend>
    <label>
      <span>NX_SECRET</span>
      <span class="hint">JWT signing key. We generated 32 random bytes; rotate freely. Anything ≥32 chars works.</span>
      <input id="nxSecret" name="nxSecret" type="text" required spellcheck="false" value="${defaultSecret}" />
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
      nxSecret: $("nxSecret").value.trim(),
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
        const out = (failed.output || "(no output captured)").trim();
        status.innerHTML =
          ".env written, but <strong>" + failed.label + " FAILED</strong>. Full output is also in the terminal where \\\`pnpm run setup\\\` is running. " +
          "<details style=\\"margin-top:.5rem;\\"><summary style=\\"cursor:pointer;\\">Show output</summary>" +
          "<pre style=\\"white-space:pre-wrap;background:#111;color:#eee;padding:.7rem;border-radius:6px;font-size:.8rem;max-height:280px;overflow:auto;\\">" +
          out.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
          "</pre></details>";
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
