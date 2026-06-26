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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = scaffoldDirArg ? resolve(scaffoldDirArg) : process.cwd();
const pkg = JSON.parse(readFileSync(resolve(scaffoldDir, "package.json"), "utf8"));
const readme = readFileSync(resolve(scaffoldDir, "README.md"), "utf8");
const opsDoc = readFileSync(resolve(scaffoldDir, "docs/ops.md"), "utf8");

const REQUIRED_SCRIPTS = [
  "setup",
  "deploy:plan",
  "doctor:prod",
  "db:generate",
  "db:migrate",
  "db:push",
  "ops:contracts",
  "ops:preflight",
  "ops:release",
  "ops:runbook",
  "ops:status",
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

function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} should emit parseable JSON`, text.split("\n").slice(-40).join("\n"));
  }
}

function parseJsonStdout(run, label) {
  try {
    return JSON.parse(run.stdout);
  } catch {
    fail(
      `${label} stdout should be strict parseable JSON`,
      [
        "stdout:",
        run.stdout.split("\n").slice(-40).join("\n"),
        "",
        "stderr:",
        run.stderr.split("\n").slice(-40).join("\n"),
      ].join("\n"),
    );
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

function runPnpm(args) {
  const result = spawnSync("pnpm", args, {
    cwd: scaffoldDir,
    env: { ...process.env, ...JOURNEY_ENV },
    encoding: "utf8",
    timeout: 60_000,
    shell: false,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runProjectJson(label, args, schemaVersion) {
  const run = runPnpm(["--silent", "run", ...args]);
  assertNoResolverCrash(run.output, label);
  const json = parseJsonStdout(run, label);
  if (json.schemaVersion !== schemaVersion) {
    fail(`${label} should emit ${schemaVersion}`, run.stdout);
  }
  return { run, json };
}

function assertProjectJsonCommand(command, label) {
  if (typeof command !== "string") {
    fail(`${label} should include a project command string`);
  }
  if (!command.startsWith("pnpm --silent run ")) {
    fail(`${label} should use pnpm --silent for JSON project commands`, command);
  }
  if (!command.includes("--json")) {
    fail(`${label} should preserve --json in project commands`, command);
  }
}

function extractImportSpecifiers(source) {
  const specifiers = new Set();
  const staticImport =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(staticImport)) specifiers.add(match[1]);
  for (const match of source.matchAll(dynamicImport)) specifiers.add(match[1]);
  return [...specifiers];
}

function resolveJsImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;

  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(base)) return base;
  if (existsSync(`${base}.js`)) return `${base}.js`;
  return null;
}

function findUnsafeAppLibModules() {
  const appDistDir = resolve(scaffoldDir, "node_modules/@nexpress/app/dist");
  const appDistLibDir = resolve(appDistDir, "lib");
  if (!existsSync(appDistLibDir)) {
    fail("installed @nexpress/app package is missing dist/lib");
  }

  const unsafeByFile = new Map();
  function fileTouchesConsumerAlias(file, stack = new Set()) {
    const cached = unsafeByFile.get(file);
    if (cached !== undefined) return cached;
    if (stack.has(file)) return false;

    stack.add(file);
    const source = readFileSync(file, "utf8");
    let unsafe = /@\/lib\//.test(source);
    if (!unsafe) {
      for (const specifier of extractImportSpecifiers(source)) {
        const resolved = resolveJsImport(file, specifier);
        if (
          resolved &&
          resolved.startsWith(appDistDir) &&
          fileTouchesConsumerAlias(resolved, stack)
        ) {
          unsafe = true;
          break;
        }
      }
    }
    stack.delete(file);
    unsafeByFile.set(file, unsafe);
    return unsafe;
  }

  return new Set(
    readdirSync(appDistLibDir)
      .filter((entry) => entry.endsWith(".js"))
      .filter((entry) => fileTouchesConsumerAlias(resolve(appDistLibDir, entry)))
      .map((entry) => entry.replace(/\.js$/, "")),
  );
}

function unsafeScriptImport(scriptFile, specifier, unsafeAppLibModules) {
  const withoutExtension = specifier.replace(/\.(?:js|ts|tsx)$/, "");

  const appLibPrefix = "@nexpress/app/lib/";
  if (withoutExtension.startsWith(appLibPrefix)) {
    const imported = withoutExtension.slice(appLibPrefix.length);
    return unsafeAppLibModules.has(imported) ? imported : null;
  }

  const aliasPrefix = "@/lib/";
  if (withoutExtension.startsWith(aliasPrefix)) {
    const imported = withoutExtension.slice(aliasPrefix.length);
    return unsafeAppLibModules.has(imported) ? imported : null;
  }

  if (!specifier.startsWith(".")) return null;

  const scriptDir = dirname(scriptFile);
  const resolved = resolve(scriptDir, withoutExtension);
  const rel = relative(resolve(scaffoldDir, "src/lib"), resolved);
  if (rel.startsWith("..") || rel === "" || rel.includes("..")) return null;

  const imported = rel.split(/[\\/]/).join("/");
  return unsafeAppLibModules.has(imported) ? imported : null;
}

function assertScaffoldScriptsAvoidUnsafeAppLibs() {
  const scriptsDir = resolve(scaffoldDir, "scripts");
  const unsafeAppLibModules = findUnsafeAppLibModules();
  const violations = [];

  for (const entry of readdirSync(scriptsDir)) {
    if (!entry.endsWith(".ts")) continue;

    const scriptFile = resolve(scriptsDir, entry);
    const source = readFileSync(scriptFile, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      const unsafeModule = unsafeScriptImport(scriptFile, specifier, unsafeAppLibModules);
      if (!unsafeModule) continue;
      violations.push(`${entry}: ${specifier} -> @nexpress/app/lib/${unsafeModule}`);
    }
  }

  if (violations.length > 0) {
    fail(
      "scaffold tsx scripts must not import app lib modules that transit through the consumer bootstrap alias",
      violations.join("\n"),
    );
  }

  const listed = [...unsafeAppLibModules].sort().join(", ") || "(none)";
  console.log(`✓ scaffold tsx scripts avoid unsafe app lib bootstrap transits: ${listed}`);
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
assertScaffoldScriptsAvoidUnsafeAppLibs();

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
  "pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan",
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
  "pnpm run doctor:prod -- --target vercel --brief --no-color --fix-plan",
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

const doctorJsonFixPlan = runTsx("scripts/doctor.ts", [
  "--prod",
  "--target",
  "vercel",
  "--json",
  "--fix-plan",
]);
assertNoResolverCrash(doctorJsonFixPlan.output, "doctor:prod --json --fix-plan");
if (doctorJsonFixPlan.code === 0) {
  fail(
    "doctor:prod --json --fix-plan should fail against the intentional closed DB/local Vercel storage env",
  );
}
const doctorJson = parseJsonOutput(doctorJsonFixPlan.output, "doctor:prod --json --fix-plan");
if (doctorJson.schemaVersion !== "np.doctor.v1") {
  fail("doctor:prod --json --fix-plan should emit the v1 schema", doctorJsonFixPlan.output);
}
if (!Array.isArray(doctorJson.fixPlan)) {
  fail("doctor:prod --json --fix-plan should include a fixPlan array", doctorJsonFixPlan.output);
}
const fixPlanIds = new Set(doctorJson.fixPlan.map((item) => item?.id));
if (!fixPlanIds.has("database.configure_target_postgres")) {
  fail("doctor:prod --json --fix-plan missing target Postgres remediation");
}
if (!fixPlanIds.has("storage.configure_target_durable_storage")) {
  fail("doctor:prod --json --fix-plan missing target storage remediation");
}
const fixPlanCommands = doctorJson.fixPlan.flatMap((item) =>
  Array.isArray(item?.commands) ? item.commands : [],
);
if (!fixPlanCommands.includes("pnpm run deploy:plan -- --target vercel --brief --no-color")) {
  fail("doctor:prod --json --fix-plan should point target actions at human deploy-plan output");
}
console.log("✓ doctor:prod JSON fix-plan stays machine-readable inside the scaffold journey");

const contractsJson = runProjectJson(
  "pnpm ops:contracts --json",
  ["ops:contracts", "--", "--json"],
  "np.ops-contracts.v1",
);
if (contractsJson.run.code !== 0) {
  fail("ops:contracts --json should exit 0", contractsJson.run.output);
}
if (!Array.isArray(contractsJson.json.contracts)) {
  fail("ops:contracts --json should list the shipped ops commands", contractsJson.run.stdout);
}
console.log("✓ pnpm --silent ops:contracts emits strict JSON stdout");

const statusJson = runProjectJson(
  "pnpm ops:status --json",
  ["ops:status", "--", "--json"],
  "np.ops.v1",
);
if (typeof statusJson.json.ok !== "boolean" || !Array.isArray(statusJson.json.checks)) {
  fail("ops:status --json should include ok + checks", statusJson.run.stdout);
}
console.log("✓ pnpm --silent ops:status emits strict JSON stdout");

const preflightJson = runProjectJson(
  "pnpm ops:preflight --json",
  ["ops:preflight", "--", "--target", "vercel", "--json"],
  "np.ops-preflight.v1",
);
if (preflightJson.run.code === 0) {
  fail("ops:preflight should block against the intentional closed DB/local Vercel storage env");
}
for (const step of preflightJson.json.steps ?? []) {
  assertProjectJsonCommand(step.command, `ops:preflight step ${step.id} command`);
}
console.log("✓ pnpm --silent ops:preflight keeps child JSON commands silent");

const releaseCheckJson = runProjectJson(
  "pnpm ops:release check --json",
  ["ops:release", "--", "check", "--target", "vercel", "--json"],
  "np.release.v1",
);
if (releaseCheckJson.run.code === 0) {
  fail("release check should block against the intentional closed DB/local Vercel storage env");
}
for (const step of releaseCheckJson.json.steps ?? []) {
  assertProjectJsonCommand(step.command, `release check step ${step.id} command`);
}
console.log("✓ pnpm --silent release check keeps child JSON commands silent");

const releasePlanOut = ".nexpress/releases/scaffold-ci-release-plan.json";
const releasePlanJson = runProjectJson(
  "pnpm ops:release plan --json --out",
  ["ops:release", "--", "plan", "--target", "vercel", "--out", releasePlanOut, "--json"],
  "np.release-plan.v1",
);
const releasePlanArtifact = parseJsonOutput(
  readFileSync(resolve(scaffoldDir, releasePlanOut), "utf8"),
  "release plan artifact",
);
if (JSON.stringify(releasePlanArtifact) !== JSON.stringify(releasePlanJson.json)) {
  fail("release plan --out artifact should match stdout JSON", releasePlanJson.run.stdout);
}
for (const [index, command] of (releasePlanJson.json.commands ?? []).entries()) {
  if (command?.command?.includes("--json")) {
    assertProjectJsonCommand(command.projectCommand, `release plan command ${index.toString()}`);
  }
}
console.log("✓ pnpm --silent release plan writes a matching JSON artifact");

const runbookOut = ".nexpress/runbooks/migration-crashed.json";
const runbookJson = runProjectJson(
  "pnpm ops:runbook migration-crashed --json --out",
  ["ops:runbook", "--", "migration-crashed", "--json", "--out", runbookOut],
  "np.runbook.v1",
);
const runbookArtifact = parseJsonOutput(
  readFileSync(resolve(scaffoldDir, runbookOut), "utf8"),
  "runbook artifact",
);
if (JSON.stringify(runbookArtifact) !== JSON.stringify(runbookJson.json)) {
  fail("runbook --out artifact should match stdout JSON", runbookJson.run.stdout);
}
for (const evidence of runbookJson.json.evidence ?? []) {
  assertProjectJsonCommand(evidence.command, `runbook evidence ${evidence.id} command`);
}
for (const [index, command] of (runbookJson.json.projectNextCommands ?? []).entries()) {
  if (command.includes("--json")) {
    assertProjectJsonCommand(command, `runbook projectNextCommands[${index.toString()}]`);
  }
}
console.log("✓ pnpm --silent runbook writes a matching JSON artifact with silent evidence");

assertIncludes(readme, "## Quickstart", "README");
assertIncludes(readme, "## First Site", "README");
assertIncludes(readme, "[docs/ops.md](docs/ops.md)", "README");
assertIncludes(readme, "## Deploy Bridge", "README");
assertIncludes(readme, "pnpm run deploy:plan -- --target vercel --brief --no-color", "README");
assertIncludes(readme, "pnpm db:migrate", "README");
assertIncludes(readme, "pnpm run ops:preflight -- --target vercel --brief --no-color", "README");
assertIncludes(readme, "pnpm --silent run ops:release -- check --target vercel --json", "README");
assertIncludes(
  readme,
  "pnpm --silent run ops:release -- verify --url https://your-domain.example --json",
  "README",
);
assertNotIncludes(readme, "Deploy with Vercel", "README");
assertNotIncludes(readme, "pnpm run doctor:prod -- --target vercel", "README");
assertNotIncludes(readme, "pnpm run doctor:prod -- --target vercel --fix-plan", "README");
if (readme.split(/\r?\n/).length > 100) {
  fail("README should stay focused on the first-run path", readme);
}

assertIncludes(opsDoc, "## Deploy Bridge", "docs/ops.md");
assertIncludes(opsDoc, "Deploy with Vercel", "docs/ops.md");
assertIncludes(opsDoc, "https://vercel.com/new?utm_source=nexpress", "docs/ops.md");
assertIncludes(opsDoc, "NP_STORAGE_ADAPTER=s3", "docs/ops.md");
assertIncludes(opsDoc, "NP_S3_ENDPOINT", "docs/ops.md");
assertIncludes(opsDoc, "pnpm db:migrate", "docs/ops.md");
assertIncludes(
  opsDoc,
  "pnpm run ops:preflight -- --target vercel --brief --no-color",
  "docs/ops.md",
);
assertIncludes(
  opsDoc,
  "pnpm --silent run ops:release -- check --target vercel --json",
  "docs/ops.md",
);
assertIncludes(
  opsDoc,
  "pnpm --silent run ops:release -- verify --url https://your-domain.example --json",
  "docs/ops.md",
);
assertIncludes(opsDoc, "pnpm run doctor:prod -- --target vercel", "docs/ops.md");
assertIncludes(opsDoc, "pnpm run doctor:prod -- --target vercel --fix-plan", "docs/ops.md");
assertIncludes(opsDoc, "pnpm run deploy:plan -- --target vercel --brief --no-color", "docs/ops.md");
assertIncludes(opsDoc, "pnpm run doctor:prod -- --target vercel --brief --no-color", "docs/ops.md");
console.log("✓ README links to the ops guide and the ops guide exposes the Vercel entrypoint");
