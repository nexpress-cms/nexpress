#!/usr/bin/env node
/**
 * Fresh scaffold journey smoke.
 *
 * Run from CI after a scaffold has been created, deps rewritten to
 * local tarballs, and `pnpm install --ignore-workspace` has completed.
 * This catches drift in the operator-facing command path that a plain
 * `tsc --noEmit` cannot see: package scripts, deploy-plan output, and
 * target-aware doctor failure messages.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = scaffoldDirArg ? resolve(scaffoldDirArg) : process.cwd();
const pkg = JSON.parse(readFileSync(resolve(scaffoldDir, "package.json"), "utf8"));

const REQUIRED_SCRIPTS = [
  "setup",
  "deploy:plan",
  "doctor:prod",
  "db:generate",
  "db:migrate",
  "db:push",
];

const EXACT_SCRIPTS = {
  "deploy:plan": "tsx scripts/deploy-plan.ts",
  "doctor:prod": "tsx scripts/doctor.ts --prod",
};

const JOURNEY_ENV = {
  DATABASE_URL: "postgres://nexpress:nexpress@127.0.0.1:55432/ci_unreachable",
  NP_SECRET: "ci-secret-which-is-long-enough-for-jwt-signing-tests",
  SITE_URL: "http://localhost:3000",
  NP_STORAGE_ADAPTER: "local",
};

function fail(message, detail = "") {
  console.error(`::error::${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    fail(`${label} missing expected text: ${needle}`, text.split("\n").slice(-40).join("\n"));
  }
}

function assertNoResolverCrash(text, label) {
  if (
    /ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find package|Cannot find module/.test(
      text,
    )
  ) {
    fail(`${label} crashed before user code ran`, text.split("\n").slice(-40).join("\n"));
  }
}

function runTsx(script, args) {
  const result = spawnSync(resolve(scaffoldDir, "node_modules/.bin/tsx"), [script, ...args], {
    cwd: scaffoldDir,
    env: { ...process.env, ...JOURNEY_ENV },
    encoding: "utf8",
    timeout: 60_000,
    shell: false,
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

for (const name of REQUIRED_SCRIPTS) {
  if (!pkg.scripts?.[name]) {
    fail(`scaffold package.json missing script: ${name}`);
  }
}
console.log(`✓ package scripts present: ${REQUIRED_SCRIPTS.join(", ")}`);

for (const [name, expected] of Object.entries(EXACT_SCRIPTS)) {
  if (pkg.scripts?.[name] !== expected) {
    fail(
      `scaffold package.json script changed: ${name}`,
      `expected: ${expected}\nactual: ${pkg.scripts?.[name]}`,
    );
  }
}
console.log("✓ deploy package scripts keep the expected pnpm run shape");

const deployPlan = runTsx("scripts/deploy-plan.ts", ["--target", "vercel"]);
assertNoResolverCrash(deployPlan.output, "deploy:plan");
if (deployPlan.code !== 0) {
  fail("deploy:plan should exit 0", deployPlan.output.split("\n").slice(-40).join("\n"));
}
assertIncludes(deployPlan.output, "NexPress deploy plan: Vercel", "deploy:plan");
assertIncludes(deployPlan.output, "NP_STORAGE_ADAPTER=s3", "deploy:plan");
assertIncludes(deployPlan.output, "pnpm run doctor:prod -- --target vercel", "deploy:plan");
console.log("✓ deploy:plan target guidance renders");

const doctor = runTsx("scripts/doctor.ts", ["--prod", "--target", "vercel"]);
assertNoResolverCrash(doctor.output, "doctor:prod");
if (doctor.code === 0) {
  fail("doctor:prod should fail against the intentional closed DB/local Vercel storage env");
}
assertIncludes(doctor.output, "Running in --prod mode for vercel", "doctor:prod");
assertIncludes(doctor.output, "Postgres reachable", "doctor:prod");
assertIncludes(doctor.output, "Vercel storage", "doctor:prod");
assertIncludes(doctor.output, "NP_STORAGE_ADAPTER=local", "doctor:prod");
console.log("✓ doctor:prod target-aware failure is actionable");
