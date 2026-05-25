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
const readme = readFileSync(resolve(scaffoldDir, "README.md"), "utf8");

const REQUIRED_SCRIPTS = [
  "setup",
  "deploy:plan",
  "doctor:prod",
  "db:generate",
  "db:migrate",
  "db:push",
];

const EXACT_SCRIPTS = {
  "db:migrate": "tsx scripts/run-migrations.ts",
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

function assertNotIncludes(text, needle, label) {
  if (text.includes(needle)) {
    fail(`${label} unexpectedly included text: ${needle}`, text.split("\n").slice(-40).join("\n"));
  }
}

function assertNoAnsi(text, label) {
  if (/\x1b\[/.test(text)) {
    fail(
      `${label} should not include ANSI color sequences`,
      text.split("\n").slice(-40).join("\n"),
    );
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
assertIncludes(deployPlan.output, "Run migrations against the same DATABASE_URL", "deploy:plan");
assertIncludes(deployPlan.output, "pnpm db:migrate -- --status", "deploy:plan");
assertIncludes(deployPlan.output, "pnpm run doctor:prod -- --target vercel", "deploy:plan");
assertIncludes(
  deployPlan.output,
  "pnpm run doctor:prod -- --target vercel --fix-plan",
  "deploy:plan",
);
console.log("✓ deploy:plan target guidance renders");

const deployPlanHelp = runTsx("scripts/deploy-plan.ts", ["--help"]);
assertNoResolverCrash(deployPlanHelp.output, "deploy:plan --help");
if (deployPlanHelp.code !== 0) {
  fail("deploy:plan --help should exit 0", deployPlanHelp.output.split("\n").slice(-40).join("\n"));
}
assertNoAnsi(deployPlanHelp.output, "deploy:plan --help");
assertIncludes(deployPlanHelp.output, "NexPress deploy plan", "deploy:plan --help");
assertIncludes(deployPlanHelp.output, "--brief", "deploy:plan --help");
assertIncludes(deployPlanHelp.output, "--no-color", "deploy:plan --help");
assertIncludes(deployPlanHelp.output, "--help, -h", "deploy:plan --help");
assertIncludes(deployPlanHelp.output, "vercel, railway, render, fly, docker", "deploy:plan --help");
console.log("✓ deploy:plan help documents output modes");

const deployPlanBrief = runTsx("scripts/deploy-plan.ts", [
  "--target",
  "vercel",
  "--brief",
  "--no-color",
]);
assertNoResolverCrash(deployPlanBrief.output, "deploy:plan --brief");
if (deployPlanBrief.code !== 0) {
  fail(
    "deploy:plan --brief should exit 0",
    deployPlanBrief.output.split("\n").slice(-40).join("\n"),
  );
}
assertNoAnsi(deployPlanBrief.output, "deploy:plan --brief --no-color");
assertIncludes(deployPlanBrief.output, "Required env:", "deploy:plan --brief");
assertIncludes(deployPlanBrief.output, "[check] NP_STORAGE_ADAPTER=s3", "deploy:plan --brief");
assertIncludes(deployPlanBrief.output, "Run before deploy:", "deploy:plan --brief");
assertIncludes(deployPlanBrief.output, "If blocked:", "deploy:plan --brief");
assertIncludes(
  deployPlanBrief.output,
  "pnpm run doctor:prod -- --target vercel --fix-plan",
  "deploy:plan --brief",
);
assertNotIncludes(deployPlanBrief.output, "Fit", "deploy:plan --brief");
console.log("✓ deploy:plan brief target guidance stays compact");

const doctorHelp = runTsx("scripts/doctor.ts", ["--help"]);
assertNoResolverCrash(doctorHelp.output, "doctor --help");
if (doctorHelp.code !== 0) {
  fail("doctor --help should exit 0", doctorHelp.output.split("\n").slice(-40).join("\n"));
}
assertNoAnsi(doctorHelp.output, "doctor --help");
assertIncludes(doctorHelp.output, "NexPress doctor", "doctor --help");
assertIncludes(doctorHelp.output, "--brief", "doctor --help");
assertIncludes(doctorHelp.output, "--fix-plan", "doctor --help");
assertIncludes(doctorHelp.output, "vercel, railway, render, fly, docker", "doctor --help");
console.log("✓ doctor help documents deploy-readiness output modes");

const migrateHelp = runTsx("scripts/run-migrations.ts", ["--help"]);
assertNoResolverCrash(migrateHelp.output, "db:migrate --help");
if (migrateHelp.code !== 0) {
  fail("db:migrate --help should exit 0", migrateHelp.output.split("\n").slice(-40).join("\n"));
}
assertNoAnsi(migrateHelp.output, "db:migrate --help");
assertIncludes(migrateHelp.output, "NexPress migrations", "db:migrate --help");
assertIncludes(migrateHelp.output, "pnpm db:generate", "db:migrate --help");
assertIncludes(migrateHelp.output, "pnpm db:migrate", "db:migrate --help");
assertIncludes(migrateHelp.output, "pnpm db:migrate -- --status", "db:migrate --help");
assertIncludes(migrateHelp.output, "--json", "db:migrate --help");
console.log("✓ db:migrate help runs without touching the database");

const doctor = runTsx("scripts/doctor.ts", ["--prod", "--target", "vercel"]);
assertNoResolverCrash(doctor.output, "doctor:prod");
if (doctor.code === 0) {
  fail("doctor:prod should fail against the intentional closed DB/local Vercel storage env");
}
assertIncludes(doctor.output, "Running in --prod mode for vercel", "doctor:prod");
assertIncludes(doctor.output, "Postgres reachable", "doctor:prod");
assertIncludes(doctor.output, "Vercel database URL", "doctor:prod");
assertIncludes(doctor.output, "DATABASE_URL host is 127.0.0.1", "doctor:prod");
assertIncludes(doctor.output, "Vercel storage", "doctor:prod");
assertIncludes(doctor.output, "NP_STORAGE_ADAPTER=local", "doctor:prod");
console.log("✓ doctor:prod target-aware failure is actionable");

const doctorBrief = runTsx("scripts/doctor.ts", [
  "--prod",
  "--target",
  "vercel",
  "--brief",
  "--no-color",
]);
assertNoResolverCrash(doctorBrief.output, "doctor:prod --brief");
if (doctorBrief.code === 0) {
  fail(
    "doctor:prod --brief should fail against the intentional closed DB/local Vercel storage env",
  );
}
assertNoAnsi(doctorBrief.output, "doctor:prod --brief --no-color");
assertIncludes(doctorBrief.output, "NexPress doctor: prod for vercel", "doctor:prod --brief");
assertIncludes(doctorBrief.output, "[error] target.vercel.database_url", "doctor:prod --brief");
assertIncludes(doctorBrief.output, "[error] target.vercel.storage", "doctor:prod --brief");
assertIncludes(doctorBrief.output, "NP_STORAGE_ADAPTER=local", "doctor:prod --brief");
assertNotIncludes(doctorBrief.output, "Running in --prod mode", "doctor:prod --brief");
console.log("✓ doctor:prod brief failure stays compact");

const doctorBriefFixPlan = runTsx("scripts/doctor.ts", [
  "--prod",
  "--target",
  "vercel",
  "--brief",
  "--no-color",
  "--fix-plan",
]);
assertNoResolverCrash(doctorBriefFixPlan.output, "doctor:prod --brief --fix-plan");
if (doctorBriefFixPlan.code === 0) {
  fail(
    "doctor:prod --brief --fix-plan should fail against the intentional closed DB/local Vercel storage env",
  );
}
assertNoAnsi(doctorBriefFixPlan.output, "doctor:prod --brief --fix-plan --no-color");
assertIncludes(
  doctorBriefFixPlan.output,
  "NexPress doctor: prod for vercel",
  "doctor:prod --fix-plan",
);
assertIncludes(doctorBriefFixPlan.output, "Fix plan", "doctor:prod --fix-plan");
assertIncludes(
  doctorBriefFixPlan.output,
  "Configure storage for the selected deployment target",
  "doctor:prod --fix-plan",
);
assertIncludes(
  doctorBriefFixPlan.output,
  "Configure a hosted Postgres DATABASE_URL for the selected deployment target",
  "doctor:prod --fix-plan",
);
assertIncludes(
  doctorBriefFixPlan.output,
  "command: pnpm run deploy:plan -- --target vercel --brief --no-color",
  "doctor:prod --fix-plan",
);
console.log("✓ doctor:prod human fix-plan renders inside the scaffold journey");

assertIncludes(readme, "Deploy with Vercel", "README");
assertIncludes(readme, "https://vercel.com/new?utm_source=nexpress", "README");
assertIncludes(readme, "NP_STORAGE_ADAPTER=s3", "README");
assertIncludes(readme, "NP_S3_ENDPOINT", "README");
assertIncludes(readme, "pnpm db:migrate", "README");
assertIncludes(readme, "pnpm run doctor:prod -- --target vercel", "README");
assertIncludes(readme, "pnpm run doctor:prod -- --target vercel --fix-plan", "README");
assertIncludes(readme, "pnpm run deploy:plan -- --target vercel --brief --no-color", "README");
assertIncludes(readme, "pnpm run doctor:prod -- --target vercel --brief --no-color", "README");
console.log("✓ README exposes the Vercel deploy entrypoint");
