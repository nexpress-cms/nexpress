#!/usr/bin/env node
/**
 * apps/web script runtime smoke.
 *
 * `tsc` and ESLint catch syntax/type drift, but not every failure
 * class that only appears once `tsx` evaluates a script. The canonical
 * regression is a compiled @nexpress/app chunk importing the consumer
 * alias `@/lib/bootstrap`, which Node cannot resolve from
 * node_modules. This smoke runs the apps/web tsx entrypoints in a
 * closed-port environment and fails only on import-resolution crashes.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const webDir = resolve(repoRoot, "apps/web");
const packageJson = JSON.parse(readFileSync(resolve(webDir, "package.json"), "utf8"));
const requiredAppDist = resolve(repoRoot, "packages/app/dist/scripts/build.js");

if (!existsSync(requiredAppDist)) {
  console.error(
    "::error::apps/web script runtime smoke must run after `pnpm build`; missing packages/app/dist/scripts/build.js",
  );
  process.exit(1);
}

const RESOLVER_CRASH =
  /ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_PACKAGE_IMPORT_NOT_DEFINED|Cannot find package|Cannot find module/;

const COMMON_ENV = {
  DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable",
  TEST_DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable_test",
  NP_SECRET: "ci-secret-which-is-long-enough-for-jwt-signing-tests",
  SITE_URL: "http://localhost:3000",
  NP_ADMIN_EMAIL: "admin@example.test",
  NP_ADMIN_PASSWORD: "password-long-enough",
  NP_ADMIN_NAME: "CI Admin",
  NO_COLOR: "1",
  CI: "1",
};

const CASES = [
  { script: "build.ts", args: ["--help"], timeoutMs: 20_000 },
  { script: "deploy-plan.ts", args: ["--help"] },
  { script: "dev-notice.ts" },
  { script: "doctor.ts", args: ["--help"] },
  { script: "ops-backup.ts", args: ["--help"] },
  { script: "ops-contracts.ts", args: ["--help"] },
  { script: "ops-health.ts", args: ["--help"] },
  { script: "ops-jobs.ts", args: ["--help"] },
  { script: "ops-migrate.ts", args: ["--help"] },
  { script: "ops-plugins.ts", args: ["--help"] },
  { script: "ops-preflight.ts", args: ["--help"] },
  { script: "ops-status.ts", args: ["--help"] },
  { script: "ops-storage.ts", args: ["--help"] },
  { script: "postinstall-notice.ts" },
  { script: "release.ts", args: ["--help"] },
  { script: "run-migrations.ts", args: ["--help"] },
  { script: "runbook.ts", args: ["--help"] },
  {
    script: "seed-admin.ts",
    args: ["admin@example.test", "password-long-enough", "CI Admin"],
  },
  { script: "seed-content.ts" },
  { script: "super-admin.ts", args: ["admin@example.test"] },
  { script: "worker.ts" },
  { script: "wp-import.ts", args: ["--help"] },
  { script: "gettext.ts", args: ["--help"] },
  { script: "xliff.ts", args: ["--help"] },
];

const SKIPPED = new Map([
  [
    "generate-schema.ts",
    "writes generated schema files; covered by build/typecheck and scaffold smoke",
  ],
  ["setup-server.ts", "can write .env; covered by apps/web setup-server spawn tests"],
]);

function directScriptEntrypoints() {
  const scripts = packageJson.scripts ?? {};
  const files = new Set();
  for (const command of Object.values(scripts)) {
    if (typeof command !== "string") continue;
    for (const match of command.matchAll(/\btsx\s+scripts\/([^\s]+)/g)) {
      files.add(match[1]);
    }
  }
  return [...files].sort();
}

function validateCoverage() {
  const covered = new Set(CASES.map((entry) => entry.script));
  const missing = directScriptEntrypoints().filter(
    (script) => !covered.has(script) && !SKIPPED.has(script),
  );
  if (missing.length === 0) return;

  console.error("::error::apps/web script runtime smoke is missing package script entries:");
  for (const script of missing) console.error(`- ${script}`);
  process.exit(1);
}

function runCase(entry) {
  const args = ["exec", "tsx", `scripts/${entry.script}`, ...(entry.args ?? [])];
  const env = { ...process.env, ...COMMON_ENV, ...(entry.env ?? {}) };
  const timeoutMs = entry.timeoutMs ?? 12_000;

  return new Promise((resolveCase) => {
    const child = spawn("pnpm", args, {
      cwd: webDir,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const kill = () => {
      timedOut = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      } else {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }, 1_000).unref();
    };

    const timer = setTimeout(kill, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveCase({
        ...entry,
        stdout,
        stderr: `${stderr}\n${error.message}`,
        code: 1,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveCase({ ...entry, stdout, stderr, code: code ?? 1, signal, timedOut });
    });
  });
}

function tail(text) {
  const lines = text.trimEnd().split("\n");
  return lines.slice(-30).join("\n");
}

validateCoverage();

let failed = false;
for (const entry of CASES) {
  const result = await runCase(entry);
  const output = `${result.stdout}\n${result.stderr}`;
  if (RESOLVER_CRASH.test(output)) {
    failed = true;
    console.error(`::error::scripts/${entry.script} crashed at module load`);
    console.error(tail(output));
    continue;
  }

  const status = result.timedOut
    ? `timed out after module load (${entry.timeoutMs ?? 12_000}ms)`
    : `exit ${result.code}`;
  console.log(`✓ scripts/${entry.script} module-loaded cleanly (${status})`);
}

for (const [script, reason] of SKIPPED) {
  console.log(`- scripts/${script} skipped: ${reason}`);
}

if (failed) process.exit(1);
