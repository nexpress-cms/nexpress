#!/usr/bin/env tsx
/**
 * UX audit — automated walk through the new-operator journey.
 *
 * The full audit:
 *   1. scaffolds a local-mode app under the real `apps/*` workspace glob;
 *   2. links it without mutating pnpm-lock.yaml and confirms pnpm found it;
 *   3. runs doctor against the fresh scaffold;
 *   4. starts the repository Postgres service when necessary and creates an
 *      isolated audit database;
 *   5. generates and pushes the scaffold's schema into that empty database;
 *   6. builds the generated app;
 *   7. completes non-interactive first boot (site, theme, and admin);
 *   8. boots and probes the development server;
 *   9. boots and probes the production server; and
 *  10. drops the audit database, removes the scaffold, and restores the
 *      database service's prior stopped/running state.
 *
 * `--quick` skips only the production-server probe. `--keep` preserves the
 * scaffold and audit database for inspection. The browser setup wizard and
 * real deployment targets remain owned by Playwright and deployment smoke.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

const repoRoot = resolve(import.meta.dirname, "..");
const composeFile = join(repoRoot, "docker/docker-compose.yml");
const databaseUser = "nexpress";
const auditSecret = "ux-audit-secret-".padEnd(64, "x");
const auditAdminEmail = "ux-audit@nexpress.local";
const auditAdminPassword = "ux-audit-password-123";
const projectNamePattern = /^[a-z0-9][a-z0-9-]{0,48}$/u;

export interface CliArgs {
  keep: boolean;
  quick: boolean;
  help: boolean;
  name: string;
}

export function parseArgs(argv: string[]): CliArgs {
  let keep = false;
  let quick = false;
  let help = false;
  let name = `ux-audit-${Date.now().toString()}`;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep") keep = true;
    else if (arg === "--quick") quick = true;
    else if (arg === "--name") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--name requires a value.");
      name = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown flag: ${arg ?? ""}`);
  }

  if (!projectNamePattern.test(name)) {
    throw new Error(
      "--name must start with a lowercase letter or number and contain only lowercase letters, numbers, and hyphens (49 characters max).",
    );
  }

  return { keep, quick, help, name };
}

export function databaseNameForAudit(projectName: string, pid = process.pid): string {
  const safeProject = projectName.toLowerCase().replace(/[^a-z0-9]+/gu, "_");
  const suffix = `_${pid.toString()}`;
  return `np_ux_${safeProject}`.slice(0, 63 - suffix.length) + suffix;
}

export function scaffoldDestinationConflict(
  scaffoldDir: string,
  pathExists: (path: string) => boolean = existsSync,
): string | undefined {
  return pathExists(scaffoldDir)
    ? `Existing workspace path ${scaffoldDir} cannot be used; choose a different \`--name\`.`
    : undefined;
}

export function parseComposePort(output: string): number | undefined {
  const matches = [...output.matchAll(/:(\d+)\s*$/gmu)];
  const value = matches.at(-1)?.[1];
  if (!value) return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

export interface ProbeResponse {
  path: "/" | "/admin" | "/blog" | "/api/openapi.json" | "/api/health";
  status: number;
  redirectedTo?: string;
}

function redirectPath(location: string | undefined): string | undefined {
  if (!location) return undefined;
  try {
    return new URL(location, "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

export function evaluateProbeResponses(responses: ProbeResponse[]): string[] {
  const byPath = new Map(responses.map((response) => [response.path, response]));
  const errors: string[] = [];

  for (const path of ["/", "/blog"] as const) {
    const response = byPath.get(path);
    if (!response || response.status < 200 || response.status >= 400) {
      errors.push(
        `${path} expected 2xx/3xx, received ${response?.status.toString() ?? "no response"}.`,
      );
    }
  }

  for (const path of ["/api/openapi.json", "/api/health"] as const) {
    const response = byPath.get(path);
    if (response?.status !== 200) {
      errors.push(
        `${path} expected 200, received ${response?.status.toString() ?? "no response"}.`,
      );
    }
  }

  const admin = byPath.get("/admin");
  const adminTarget = redirectPath(admin?.redirectedTo);
  if (
    !admin ||
    admin.status < 300 ||
    admin.status >= 400 ||
    (adminTarget !== "/admin/login" && adminTarget !== "/admin/setup")
  ) {
    errors.push(
      `/admin expected a login/setup redirect, received ${admin?.status.toString() ?? "no response"} → ${adminTarget ?? "none"}.`,
    );
  }

  return errors;
}

export function plannedStepLabels(quick: boolean): string[] {
  return [
    "scaffold via create-nexpress",
    "pnpm install + workspace discovery",
    "pnpm doctor",
    "isolated Postgres database",
    "pnpm db:push",
    "pnpm build",
    "pnpm run setup -- --non-interactive",
    "pnpm dev + HTTP probe",
    ...(quick ? [] : ["pnpm start + HTTP probe"]),
  ];
}

interface Report {
  ok: boolean;
  label: string;
  detail?: string;
  hint?: string;
  durationMs: number;
}

interface StepContext {
  args: CliArgs;
  scaffoldDir: string;
  scaffoldName: string;
  databaseName: string;
  databaseUrl?: string;
  databaseCreated: boolean;
  databaseServiceStarted: boolean;
}

type Step = (ctx: StepContext) => Promise<Report> | Report;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function timed<T extends Omit<Report, "durationMs">>(
  fn: () => Promise<T> | T,
): Promise<Report> {
  const start = performance.now();
  const result = await fn();
  return { ...result, durationMs: Math.round(performance.now() - start) };
}

function runSync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): RunResult {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 600_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  const diagnostics = [
    result.stderr ?? "",
    result.error?.message ?? "",
    result.signal ? `terminated by ${result.signal}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: diagnostics,
  };
}

function combinedOutput(result: RunResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function tail(value: string, lines = 20): string {
  return value.trim().split("\n").slice(-lines).join("\n");
}

function filteredScriptCommand(ctx: StepContext, script: string, ...args: string[]): string[] {
  return ["--filter", ctx.scaffoldName, "--fail-if-no-match", "run", script, ...args];
}

function applicationEnv(ctx: StepContext, port = 3000): Record<string, string> {
  if (!ctx.databaseUrl) throw new Error("Audit database is not ready.");
  return {
    DATABASE_URL: ctx.databaseUrl,
    NP_SECRET: auditSecret,
    SITE_URL: `http://localhost:${port.toString()}`,
    NP_EMAIL_ADAPTER: "noop",
    NP_ADMIN_EMAIL: auditAdminEmail,
    NP_ADMIN_PASSWORD: auditAdminPassword,
    NP_ADMIN_NAME: "UX Audit Admin",
  };
}

function composeArgs(...args: string[]): string[] {
  return ["compose", "-f", composeFile, ...args];
}

async function waitForPostgres(maxMs = 60_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    const result = runSync(
      "docker",
      composeArgs("exec", "-T", "db", "pg_isready", "-U", databaseUser, "-d", "postgres"),
      { timeoutMs: 10_000 },
    );
    if (result.code === 0) return true;
    await sleep(500);
  }
  return false;
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not allocate a local audit port.");
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function fetchStatus(
  baseUrl: string,
  path: ProbeResponse["path"],
  timeoutMs = 30_000,
): Promise<ProbeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const manualRedirect = path === "/admin";
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: manualRedirect ? "manual" : "follow",
      signal: controller.signal,
    });
    return {
      path,
      status: response.status,
      redirectedTo: manualRedirect ? (response.headers.get("location") ?? undefined) : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStatusWithRetry(
  baseUrl: string,
  path: ProbeResponse["path"],
  maxMs = 60_000,
): Promise<ProbeResponse> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < maxMs) {
    try {
      return await fetchStatus(baseUrl, path);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`${path} did not respond within ${maxMs.toString()}ms.`);
}

async function waitForServer(
  child: ChildProcess,
  baseUrl: string,
  maxMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const response = await fetchStatus(baseUrl, "/api/health");
      if (response.status > 0) return true;
    } catch {
      // Server has not opened its socket yet.
    }
    await sleep(500);
  }
  return false;
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  sendSignal(child, "SIGTERM");
  await Promise.race([exited, sleep(3_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    sendSignal(child, "SIGKILL");
    await Promise.race([exited, sleep(3_000)]);
  }
}

const stepScaffold: Step = async (ctx) =>
  timed(() => {
    const cliEntry = join(repoRoot, "packages/cli/dist/index.js");
    if (!existsSync(cliEntry)) {
      return {
        ok: false,
        label: "scaffold via create-nexpress",
        detail: "packages/cli/dist/index.js is not built.",
        hint: "Run `pnpm --filter create-nexpress build` and retry.",
      };
    }

    const result = runSync(
      "node",
      [cliEntry, ctx.scaffoldName, "--local", "--yes", "--no-docker"],
      { cwd: join(repoRoot, "apps") },
    );
    if (result.code !== 0 || !existsSync(join(ctx.scaffoldDir, "package.json"))) {
      return {
        ok: false,
        label: "scaffold via create-nexpress",
        detail: tail(combinedOutput(result)),
        hint: "Check `node packages/cli/dist/index.js --help` and the target directory.",
      };
    }
    return { ok: true, label: "scaffold via create-nexpress" };
  });

const stepWorkspaceInstall: Step = async (ctx) =>
  timed(() => {
    const install = runSync(
      "pnpm",
      ["install", "--lockfile=false", "--offline", "--ignore-scripts"],
      {
        timeoutMs: 300_000,
      },
    );
    if (install.code !== 0) {
      return {
        ok: false,
        label: "pnpm install + workspace discovery",
        detail: tail(combinedOutput(install)),
        hint: "Run the repository's frozen install first so the offline pnpm store is complete.",
      };
    }

    const postinstall = runSync("pnpm", filteredScriptCommand(ctx, "postinstall"), {
      timeoutMs: 300_000,
    });
    if (postinstall.code !== 0) {
      return {
        ok: false,
        label: "pnpm install + workspace discovery",
        detail: tail(combinedOutput(postinstall)),
        hint: "Fix the generated project's postinstall script before releasing the scaffold.",
      };
    }

    const listing = runSync("pnpm", ["m", "ls", "--json", "--depth=-1"]);
    try {
      const rows = JSON.parse(listing.stdout) as Array<{ name?: string; path?: string }>;
      const match = rows.find((row) => row.name === ctx.scaffoldName);
      if (resolve(match?.path ?? "") !== ctx.scaffoldDir) throw new Error("workspace not found");
    } catch {
      return {
        ok: false,
        label: "pnpm install + workspace discovery",
        detail:
          tail(combinedOutput(listing)) || `Workspace ${ctx.scaffoldName} was not discovered.`,
        hint: "The audit scaffold must live directly under the `apps/*` workspace glob.",
      };
    }

    return {
      ok: true,
      label: "pnpm install + workspace discovery",
      detail: `${ctx.scaffoldName} → ${ctx.scaffoldDir}`,
    };
  });

const stepDoctor: Step = async (ctx) =>
  timed(() => {
    const result = runSync("pnpm", filteredScriptCommand(ctx, "doctor"), {
      timeoutMs: 60_000,
    });
    const output = combinedOutput(result);
    const ran =
      !output.includes("No projects matched") &&
      /(doctor|database|check|warn|error)/iu.test(output);
    if (!ran) {
      return {
        ok: false,
        label: "pnpm doctor",
        detail: tail(output) || `exit ${result.code.toString()}, no recognizable doctor output`,
        hint: "Doctor must execute the generated project's script, even when its fresh DB is absent.",
      };
    }
    return {
      ok: true,
      label: "pnpm doctor",
      detail: `exit ${result.code.toString()} (a fresh database diagnostic is expected)`,
    };
  });

const stepDatabase: Step = async (ctx) =>
  timed(async () => {
    const running = runSync("docker", composeArgs("ps", "--status", "running", "--services"), {
      timeoutMs: 30_000,
    });
    if (running.code !== 0) {
      return {
        ok: false,
        label: "isolated Postgres database",
        detail: tail(combinedOutput(running)),
        hint: "Install/start Docker and confirm `docker compose` is available.",
      };
    }
    const wasRunning = running.stdout.split("\n").includes("db");

    const started = runSync("docker", composeArgs("up", "-d", "db"), { timeoutMs: 120_000 });
    if (started.code !== 0) {
      return {
        ok: false,
        label: "isolated Postgres database",
        detail: tail(combinedOutput(started)),
        hint: "Inspect the repository Postgres service with `docker compose ... logs db`.",
      };
    }
    ctx.databaseServiceStarted = !wasRunning;

    if (!(await waitForPostgres())) {
      return {
        ok: false,
        label: "isolated Postgres database",
        detail: "Postgres did not become ready within 60 seconds.",
        hint: "Inspect `docker compose -f docker/docker-compose.yml logs db`.",
      };
    }

    const portResult = runSync("docker", composeArgs("port", "db", "5432"));
    const port = parseComposePort(portResult.stdout);
    if (port === undefined) {
      return {
        ok: false,
        label: "isolated Postgres database",
        detail: tail(combinedOutput(portResult)) || "Could not resolve the Postgres host port.",
        hint: "Confirm the compose db service publishes container port 5432.",
      };
    }

    const created = runSync(
      "docker",
      composeArgs(
        "exec",
        "-T",
        "db",
        "createdb",
        "-U",
        databaseUser,
        "--encoding=UTF8",
        ctx.databaseName,
      ),
      { timeoutMs: 30_000 },
    );
    if (created.code !== 0) {
      return {
        ok: false,
        label: "isolated Postgres database",
        detail: tail(combinedOutput(created)),
        hint: "Drop a stale audit DB with the same name or choose a different `--name`.",
      };
    }

    ctx.databaseCreated = true;
    ctx.databaseUrl = `postgres://${databaseUser}:${databaseUser}@127.0.0.1:${port.toString()}/${ctx.databaseName}`;
    return {
      ok: true,
      label: "isolated Postgres database",
      detail: `${ctx.databaseName} on 127.0.0.1:${port.toString()}`,
    };
  });

function commandStep(label: string, command: string, timeoutMs: number): Step {
  return async (ctx) =>
    timed(() => {
      const result = runSync("pnpm", filteredScriptCommand(ctx, command), {
        timeoutMs,
        env: applicationEnv(ctx),
      });
      const output = combinedOutput(result);
      if (result.code !== 0) {
        return {
          ok: false,
          label,
          detail: tail(output),
          hint: `Run \`pnpm --filter ${ctx.scaffoldName} run ${command}\` with the reported audit DATABASE_URL.`,
        };
      }
      return { ok: true, label };
    });
}

const stepDatabasePush = commandStep("pnpm db:push", "db:push", 300_000);
const stepBuild = commandStep("pnpm build", "build", 300_000);

const stepFirstBootSetup: Step = async (ctx) =>
  timed(() => {
    const result = runSync("pnpm", filteredScriptCommand(ctx, "setup", "--", "--non-interactive"), {
      timeoutMs: 180_000,
      env: {
        ...applicationEnv(ctx),
        NP_SETUP_RUN_MIGRATIONS: "false",
        NP_SETUP_CREATE_ADMIN: "true",
        NP_SETUP_SAMPLE_CONTENT: "false",
        NP_ADMIN_THEME: "default",
        NP_SITE_NAME: "UX Audit Site",
      },
    });
    const output = combinedOutput(result);
    if (result.code !== 0 || !/Setup complete/iu.test(output)) {
      return {
        ok: false,
        label: "pnpm run setup -- --non-interactive",
        detail: tail(output),
        hint: "Run the generated project's non-interactive setup with the reported audit DATABASE_URL.",
      };
    }
    return { ok: true, label: "pnpm run setup -- --non-interactive" };
  });

function serverProbeStep(mode: "dev" | "start"): Step {
  return async (ctx) =>
    timed(async () => {
      const label = `pnpm ${mode} + HTTP probe`;
      const port = await findFreePort();
      const baseUrl = `http://127.0.0.1:${port.toString()}`;
      let output = "";
      const child = spawn("pnpm", filteredScriptCommand(ctx, mode), {
        cwd: repoRoot,
        env: { ...process.env, ...applicationEnv(ctx, port), PORT: port.toString() },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const capture = (chunk: Buffer): void => {
        output = `${output}${chunk.toString("utf8")}`.slice(-60_000);
      };
      child.stdout?.on("data", capture);
      child.stderr?.on("data", capture);

      try {
        const ready = await waitForServer(child, baseUrl, mode === "dev" ? 90_000 : 60_000);
        if (!ready) {
          return {
            ok: false,
            label,
            detail: tail(output) || "Server exited or never opened its HTTP port.",
            hint: `Run the generated project's \`${mode}\` script directly and inspect its startup log.`,
          };
        }

        const paths: ProbeResponse["path"][] = [
          "/",
          "/admin",
          "/blog",
          "/api/openapi.json",
          "/api/health",
        ];
        const responses: ProbeResponse[] = [];
        try {
          for (const path of paths) responses.push(await fetchStatusWithRetry(baseUrl, path));
        } catch (error) {
          return {
            ok: false,
            label,
            detail:
              `${error instanceof Error ? error.message : String(error)}\n${tail(output)}`.trim(),
            hint: "The server opened its health route but another first-run route never completed.",
          };
        }
        const errors = evaluateProbeResponses(responses);
        const summary = responses
          .map(
            (response) =>
              `${response.path}=${response.status.toString()}${response.redirectedTo ? `→${response.redirectedTo}` : ""}`,
          )
          .join(", ");
        if (errors.length > 0) {
          return {
            ok: false,
            label,
            detail: `${summary}\n${errors.join("\n")}\n${tail(output, 12)}`.trim(),
            hint: "The generated app booted but its first-run routes did not satisfy the public/admin contract.",
          };
        }

        return { ok: true, label, detail: summary };
      } finally {
        await terminateChild(child);
      }
    });
}

const stepDevProbe = serverProbeStep("dev");
const stepProductionProbe = serverProbeStep("start");

function stepsFor(args: CliArgs): Step[] {
  return [
    stepScaffold,
    stepWorkspaceInstall,
    stepDoctor,
    stepDatabase,
    stepDatabasePush,
    stepBuild,
    stepFirstBootSetup,
    stepDevProbe,
    ...(args.quick ? [] : [stepProductionProbe]),
  ];
}

function formatReport(reports: Report[]): void {
  console.log("");
  console.log(`${BOLD}UX audit report${RESET}`);
  console.log("─".repeat(72));
  for (const report of reports) {
    const icon = report.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(
      `  ${icon} ${BOLD}${report.label}${RESET}  ${DIM}${report.durationMs.toString()}ms${RESET}`,
    );
    if (report.detail) {
      for (const line of report.detail.split("\n")) console.log(`      ${DIM}${line}${RESET}`);
    }
    if (!report.ok && report.hint) console.log(`      ${YELLOW}hint:${RESET} ${report.hint}`);
  }
  console.log("─".repeat(72));
  const passes = reports.filter((report) => report.ok).length;
  const totalMs = reports.reduce((sum, report) => sum + report.durationMs, 0);
  const color = passes === reports.length ? GREEN : RED;
  console.log(
    `  ${color}${passes.toString()}/${reports.length.toString()} steps passed${RESET}  ${DIM}(${totalMs.toString()}ms total)${RESET}`,
  );
  console.log("");
}

async function cleanup(ctx: StepContext): Promise<boolean> {
  if (ctx.args.keep) {
    console.log(`${DIM}kept scaffold: ${ctx.scaffoldDir}${RESET}`);
    if (ctx.databaseCreated) console.log(`${DIM}kept database: ${ctx.databaseName}${RESET}`);
    return true;
  }

  let ok = true;
  if (ctx.databaseCreated) {
    const dropped = runSync(
      "docker",
      composeArgs(
        "exec",
        "-T",
        "db",
        "dropdb",
        "-U",
        databaseUser,
        "--if-exists",
        "--force",
        ctx.databaseName,
      ),
      { timeoutMs: 30_000 },
    );
    if (dropped.code !== 0) {
      ok = false;
      console.warn(
        `${YELLOW}warn:${RESET} could not drop ${ctx.databaseName}: ${tail(combinedOutput(dropped))}`,
      );
    }
  }

  try {
    await rm(ctx.scaffoldDir, { recursive: true, force: true });
  } catch (error) {
    ok = false;
    console.warn(`${YELLOW}warn:${RESET} could not remove ${ctx.scaffoldDir}: ${String(error)}`);
  }

  if (ctx.databaseServiceStarted) {
    const stopped = runSync("docker", composeArgs("stop", "db"), { timeoutMs: 60_000 });
    if (stopped.code !== 0) {
      ok = false;
      console.warn(
        `${YELLOW}warn:${RESET} could not restore the stopped db state: ${tail(combinedOutput(stopped))}`,
      );
    }
  }

  console.log(`${DIM}cleaned scaffold ${ctx.scaffoldDir} and database ${ctx.databaseName}${RESET}`);
  return ok;
}

function printHelp(): void {
  console.log("Usage: tsx scripts/ux-audit.mts [--keep] [--quick] [--name <safe-name>]");
  console.log("  --quick  skip the production-server probe");
  console.log("  --keep   preserve the generated scaffold and isolated database");
}

export async function runAudit(args: CliArgs): Promise<number> {
  if (args.help) {
    printHelp();
    return 0;
  }

  const scaffoldDir = join(repoRoot, "apps", args.name);
  const destinationConflict = scaffoldDestinationConflict(scaffoldDir);
  if (destinationConflict) {
    console.error(`${RED}ux-audit refused to continue:${RESET} ${destinationConflict}`);
    return 2;
  }

  const ctx: StepContext = {
    args,
    scaffoldDir,
    scaffoldName: args.name,
    databaseName: databaseNameForAudit(args.name),
    databaseCreated: false,
    databaseServiceStarted: false,
  };
  console.log(`${CYAN}UX audit${RESET} — scaffold ${DIM}${scaffoldDir}${RESET}`);

  const reports: Report[] = [];
  let failed = false;
  try {
    for (const step of stepsFor(args)) {
      if (failed) break;
      const report = await step(ctx);
      reports.push(report);
      failed = !report.ok;
    }
  } catch (error) {
    reports.push({
      ok: false,
      label: "unexpected audit failure",
      detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
      durationMs: 0,
    });
    failed = true;
  }

  const cleanupOk = await cleanup(ctx);
  if (!cleanupOk) {
    reports.push({ ok: false, label: "audit cleanup", durationMs: 0 });
    failed = true;
  }
  formatReport(reports);
  return failed ? 1 : 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runAudit(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`${RED}ux-audit crashed:${RESET}`, error);
    process.exitCode = 2;
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) await main();
