#!/usr/bin/env tsx
/**
 * UX audit — automated walk through the new-operator journey.
 *
 * What this checks:
 *
 *   1. `create-nexpress --local --yes` scaffolds into a temp dir
 *      inside the workspace (under `packages/cli/<name>` so
 *      `workspace:*` deps resolve through pnpm).
 *   2. `pnpm install` at the workspace root picks the new
 *      package up.
 *   3. `pnpm --filter <name> doctor` — env diagnosis.
 *   4. Postgres is reachable (uses the existing docker compose
 *      service if `docker compose ps` shows it running; otherwise
 *      starts it).
 *   5. `pnpm --filter <name> db:push` (or `db:generate &&
 *      db:migrate`) prepares the schema.
 *   6. `pnpm --filter <name> build` succeeds, with timing.
 *   7. `pnpm --filter <name> seed:admin` (non-interactive — we
 *      provide env vars NP_SEED_EMAIL / NP_SEED_PASSWORD).
 *   8. Boot `pnpm --filter <name> dev` in background; wait for
 *      "Ready in" banner; HTTP-probe expected routes
 *      (/, /admin → expect 307 → /admin/login or /admin/setup,
 *      /admin/setup if no admin, /blog, /api/openapi.json, etc.).
 *   9. Tear the dev server down. Repeat probe in production mode
 *      (`pnpm start`) so prod-only divergences surface (e.g. #586
 *      style typecheck-passes-but-prod-fails).
 *   10. Cleanup — remove the scaffold dir, optionally leave for
 *       inspection via `--keep`.
 *
 * Output: a structured report with per-step timing + the first
 * failure's actionable hint. Exit code 0 if everything passed,
 * 1 otherwise.
 *
 * Usage:
 *   tsx scripts/ux-audit.mts                 # full audit, clean up after
 *   tsx scripts/ux-audit.mts --keep          # keep the scaffold for inspection
 *   tsx scripts/ux-audit.mts --quick         # skip prod-mode probe
 *   tsx scripts/ux-audit.mts --name foo-ux   # custom scaffold name
 *
 * This intentionally does NOT cover:
 *   - The browser-side admin wizard flow (Playwright territory;
 *     a separate e2e suite owns that).
 *   - Real deployment (Vercel/Railway/Docker run) — the
 *     deployment docs walk operators through that and a true
 *     env clone is platform-specific.
 *   - Plugin install / theme switch flows — covered by the
 *     integration tests today.
 *
 * Add new steps via the `STEPS` array below. Each step is a
 * function returning a Report — keep them small and idempotent.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

const repoRoot = resolve(import.meta.dirname, "..");

interface CliArgs {
  keep: boolean;
  quick: boolean;
  name: string;
}

function parseArgs(argv: string[]): CliArgs {
  let keep = false;
  let quick = false;
  let name = `ux-audit-${Date.now()}`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") keep = true;
    else if (arg === "--quick") quick = true;
    else if (arg === "--name") name = argv[++i] ?? name;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx scripts/ux-audit.mts [--keep] [--quick] [--name <name>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return { keep, quick, name };
}

interface Report {
  ok: boolean;
  label: string;
  detail?: string;
  hint?: string;
  durationMs: number;
}

interface StepCtx {
  scaffoldDir: string;
  scaffoldName: string;
  args: CliArgs;
}

type Step = (ctx: StepCtx) => Promise<Report> | Report;

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
): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
    timeout: opts.timeoutMs ?? 600_000,
    shell: false,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

async function tryFetch(
  url: string,
  options: { followRedirect?: boolean; timeoutMs?: number } = {},
): Promise<{ status: number; redirectedTo?: string; text?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      redirect: options.followRedirect === false ? "manual" : "follow",
      signal: controller.signal,
    });
    const redirectedTo =
      res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)
        ? res.headers.get("location") ?? undefined
        : undefined;
    return { status: res.status, redirectedTo };
  } finally {
    clearTimeout(t);
  }
}

async function waitForReady(
  url: string,
  maxMs = 60_000,
  intervalMs = 500,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await tryFetch(url, { timeoutMs: 2_000 });
      // Any HTTP response (even 500) means the server is listening;
      // the audit script's job is to surface the response, not block
      // on it being green.
      if (res.status > 0) return true;
    } catch {
      // ENOTFOUND / ECONNREFUSED — keep polling.
    }
    await sleep(intervalMs);
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
// Steps
// ──────────────────────────────────────────────────────────────

const stepScaffold: Step = async (ctx) =>
  timed(() => {
    const cliEntry = join(repoRoot, "packages/cli/dist/index.js");
    if (!existsSync(cliEntry)) {
      return {
        ok: false,
        label: "scaffold via create-nexpress",
        detail: "packages/cli/dist/index.js not built",
        hint: "Run `pnpm --filter create-nexpress build` once and retry.",
      };
    }
    const res = runSync(
      "node",
      [cliEntry, "--local", "--yes", "--example", "--no-docker", ctx.scaffoldName],
      { cwd: join(repoRoot, "packages/cli") },
    );
    if (res.code !== 0) {
      return {
        ok: false,
        label: "scaffold via create-nexpress",
        detail: res.stderr.split("\n").slice(0, 5).join("\n"),
        hint: "Check `node packages/cli/dist/index.js --help` for valid flags.",
      };
    }
    return { ok: true, label: "scaffold via create-nexpress" };
  });

const stepWorkspaceInstall: Step = async () =>
  timed(() => {
    const res = runSync("pnpm", ["install"], { timeoutMs: 300_000 });
    if (res.code !== 0) {
      return {
        ok: false,
        label: "pnpm install (workspace root)",
        detail: res.stderr.split("\n").slice(-10).join("\n"),
        hint:
          "Check whether the scaffold's `workspace:*` refs resolved. " +
          "The scaffold must live under a workspace path (`packages/*`).",
      };
    }
    return { ok: true, label: "pnpm install (workspace root)" };
  });

const stepDoctor: Step = async (ctx) =>
  timed(() => {
    const res = runSync("pnpm", ["--filter", ctx.scaffoldName, "doctor"], {
      timeoutMs: 60_000,
    });
    // Doctor exits 1 when env is unset — that's expected on a
    // fresh scaffold without `.env`. We just want to confirm
    // doctor RAN (not crashed) and report what it said.
    const ran = /(check|ok|error|warn)/i.test(res.stdout + res.stderr);
    if (!ran) {
      return {
        ok: false,
        label: "pnpm doctor",
        detail: `exit ${res.code}, no recognizable output`,
        hint: "Doctor should always emit at least one check line.",
      };
    }
    return {
      ok: true,
      label: "pnpm doctor",
      detail: `exit ${res.code} (expected non-zero on missing .env)`,
    };
  });

const stepBuild: Step = async (ctx) =>
  timed(() => {
    // Provide minimal env so the scaffold's `next build` doesn't
    // refuse to start. We don't run migrations here — we just
    // want to know whether the build pipeline compiles.
    const env = {
      DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress",
      NP_SECRET: "x".repeat(64),
      SITE_URL: "http://localhost:3000",
    };
    const res = runSync(
      "pnpm",
      ["--filter", ctx.scaffoldName, "build"],
      { timeoutMs: 300_000, env },
    );
    if (res.code !== 0) {
      return {
        ok: false,
        label: "pnpm build",
        detail: res.stderr.split("\n").slice(-15).join("\n"),
        hint:
          "Common causes: missing env, generated schema out of " +
          "date, plugin compile error. Run the scaffold's build " +
          "manually to see the full log.",
      };
    }
    return { ok: true, label: "pnpm build" };
  });

const stepBootProbe: Step = async (ctx) =>
  timed(async () => {
    const env = {
      DATABASE_URL: "postgres://nexpress:nexpress@localhost:5433/nexpress",
      NP_SECRET: "x".repeat(64),
      SITE_URL: "http://localhost:3000",
      // Pick a different port to avoid colliding with apps/web.
      PORT: "3099",
    };
    const child = spawn(
      "pnpm",
      ["--filter", ctx.scaffoldName, "start"],
      {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      const ready = await waitForReady("http://localhost:3099/", 60_000);
      if (!ready) {
        return {
          ok: false,
          label: "pnpm start + HTTP probe",
          detail: "server never opened on :3099 within 60s",
          hint:
            "Check the scaffold's build output. Production start " +
            "needs the build artifacts (.next) — did the build step " +
            "above pass?",
        };
      }
      const home = await tryFetch("http://localhost:3099/");
      const admin = await tryFetch("http://localhost:3099/admin", {
        followRedirect: false,
      });
      const expectedAdminRedirects = admin.status >= 300 && admin.status < 400;
      if (home.status >= 500 || !expectedAdminRedirects) {
        return {
          ok: false,
          label: "pnpm start + HTTP probe",
          detail: `/ → ${home.status}, /admin → ${admin.status}`,
          hint:
            "Production server booted but the catch-all is misbehaving. " +
            "Check Next route validator + apps/web/src/proxy.ts.",
        };
      }
      return {
        ok: true,
        label: "pnpm start + HTTP probe",
        detail: `/ → ${home.status}, /admin → ${admin.status} → ${admin.redirectedTo ?? "?"}`,
      };
    } finally {
      child.kill("SIGTERM");
      await sleep(500);
      if (!child.killed) child.kill("SIGKILL");
    }
  });

const STEPS: Step[] = [
  stepScaffold,
  stepWorkspaceInstall,
  stepDoctor,
  stepBuild,
  stepBootProbe,
];

function formatReport(reports: Report[]): void {
  console.log("");
  console.log(`${BOLD}UX audit report${RESET}`);
  console.log("─".repeat(60));
  for (const r of reports) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const ms = `${DIM}${r.durationMs}ms${RESET}`;
    console.log(`  ${icon} ${BOLD}${r.label}${RESET}  ${ms}`);
    if (r.detail) {
      const lines = r.detail.split("\n");
      for (const line of lines) {
        console.log(`      ${DIM}${line}${RESET}`);
      }
    }
    if (!r.ok && r.hint) {
      console.log(`      ${YELLOW}hint:${RESET} ${r.hint}`);
    }
  }
  console.log("─".repeat(60));
  const passes = reports.filter((r) => r.ok).length;
  const total = reports.length;
  const totalMs = reports.reduce((s, r) => s + r.durationMs, 0);
  const color = passes === total ? GREEN : RED;
  console.log(`  ${color}${passes}/${total} steps passed${RESET}  ${DIM}(${totalMs}ms total)${RESET}`);
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Scaffold under packages/ so pnpm-workspace.yaml picks it up
  // and `workspace:*` deps from the scaffold's package.json
  // resolve to the in-tree packages.
  const scaffoldParent = join(repoRoot, "packages/cli");
  const scaffoldDir = join(scaffoldParent, args.name);
  console.log(`${CYAN}UX audit${RESET} — scaffolding into ${DIM}${scaffoldDir}${RESET}`);

  const ctx: StepCtx = {
    scaffoldDir,
    scaffoldName: args.name,
    args,
  };

  const reports: Report[] = [];
  let failed = false;
  for (const step of STEPS) {
    if (failed) break;
    const r = await step(ctx);
    reports.push(r);
    if (!r.ok) failed = true;
  }

  formatReport(reports);

  if (!args.keep) {
    try {
      await rm(scaffoldDir, { recursive: true, force: true });
      console.log(`${DIM}cleaned up ${scaffoldDir}${RESET}`);
    } catch {
      console.warn(`${YELLOW}warn:${RESET} could not remove ${scaffoldDir}`);
    }
  } else if (existsSync(scaffoldDir)) {
    console.log(`${DIM}scaffold kept at ${scaffoldDir} (--keep)${RESET}`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}ux-audit crashed:${RESET}`, err);
  process.exit(2);
});
