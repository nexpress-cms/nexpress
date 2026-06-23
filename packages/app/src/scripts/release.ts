// Must be first so child scripts see the same environment shape.
import "./_load-env.js";

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DEPLOY_TARGETS, parseDeployTargetArg, type DeployTarget } from "./deploy-targets.js";
import {
  buildReleaseApplyJson,
  buildReleaseJson,
  buildReleasePlanJson,
  getReleaseApplyCommandSpec,
  renderBriefReleaseApply,
  renderBriefReleasePlan,
  renderBriefReleaseReport,
  type ReleaseApplyCommandResult,
  type ReleaseApplyJson,
  type ReleaseJson,
  type ReleaseMode,
  type ReleasePlanJson,
  type ReleaseStep,
  type ReleaseStepId,
  type ReleaseStepReport,
} from "./release-core.js";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

type PackageManager = "pnpm" | "npm" | "yarn";
type ReleaseCliMode = ReleaseMode | "apply";

interface CapturedCommand {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RAW_ARGV = process.argv.slice(2);
const ARGV = normalizePnpmPassthroughArgv(RAW_ARGV);
const MODE: ReleaseCliMode =
  ARGV[0] === "apply"
    ? "apply"
    : ARGV[0] === "verify"
      ? "verify"
      : ARGV[0] === "plan"
        ? "plan"
        : "check";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;
const EXECUTE_MODE = ARGV.includes("--execute");

function printHelp(): void {
  console.log(`NexPress release

Usage:
  pnpm --silent run ops:release -- check --target vercel --json
  pnpm --silent run ops:release -- plan --target vercel --json
  pnpm --silent run ops:release -- apply --plan .nexpress/releases/<plan>.json --json
  pnpm --silent run ops:release -- verify --url https://example.com --json
  pnpm --silent run release -- check --target vercel --json
  pnpm --silent run release -- plan --target vercel --json
  pnpm --silent run release -- apply --plan .nexpress/releases/<plan>.json --json
  pnpm --silent run release -- verify --url https://example.com --json
  nexpress release check --target vercel --brief --no-color
  nexpress release plan --target vercel --brief --no-color
  nexpress release apply --plan .nexpress/releases/<plan>.json --execute --approve <planId>
  nexpress release verify --url https://example.com --brief --no-color

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --target <host> Deployment target for release check. Defaults to docker.
  --out <path>    Artifact path for release plan. Defaults to .nexpress/releases/<plan>.json.
  --plan <path>   Release plan artifact for release apply.
  --execute       Execute release apply commands. Without this, apply is a dry-run.
  --approve <id>  Required with --execute. Must match the plan ID.
  --url <origin>  Deployed origin for release verify. Defaults to SITE_URL, then localhost.
  --json          Print the stable machine-readable release report.
  --brief         Print compact human output. This is the default.
  --no-color      Disable ANSI color in human-readable output.
  --help, -h      Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readUrlArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") return argv[i + 1] ?? null;
    if (arg?.startsWith("--url=")) return arg.slice("--url=".length);
  }
  return null;
}

function readOutArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") return argv[i + 1] ?? null;
    if (arg?.startsWith("--out=")) return arg.slice("--out=".length);
  }
  return null;
}

function readPlanArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") return argv[i + 1] ?? null;
    if (arg?.startsWith("--plan=")) return arg.slice("--plan=".length);
  }
  return null;
}

function readApproveArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--approve") return argv[i + 1] ?? null;
    if (arg?.startsWith("--approve=")) return arg.slice("--approve=".length);
  }
  return null;
}

function detectPackageManager(cwd: string): PackageManager {
  let current = cwd;
  while (true) {
    if (existsSync(resolve(current, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(resolve(current, "yarn.lock"))) return "yarn";
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "npm";
}

function runArgs(manager: PackageManager, script: string, passthrough: string[]): string[] {
  if (manager === "yarn") return [script, ...passthrough];
  if (passthrough.includes("--json")) return ["--silent", "run", script, "--", ...passthrough];
  return ["run", script, "--", ...passthrough];
}

function commandText(manager: PackageManager, args: string[]): string {
  return `${manager} ${args.join(" ")}`;
}

function captureProcess(
  executable: string,
  args: string[],
  displayCommand: string,
): Promise<CapturedCommand> {
  return new Promise((resolveFn) => {
    let settled = false;
    const finish = (run: CapturedCommand): void => {
      if (settled) return;
      settled = true;
      resolveFn(run);
    };
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        command: displayCommand,
        stdout,
        stderr: error.message,
        exitCode: 127,
      });
    });
    child.on("exit", (code) => {
      finish({
        command: displayCommand,
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

function capture(manager: PackageManager, args: string[]): Promise<CapturedCommand> {
  return captureProcess(manager, args, commandText(manager, args));
}

function parseJson(run: CapturedCommand): ReleaseStepReport | null {
  const start = run.stdout.indexOf("{");
  const end = run.stdout.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? run.stdout.slice(start, end + 1) : run.stdout;
  try {
    return JSON.parse(candidate) as ReleaseStepReport;
  } catch {
    return null;
  }
}

function stepFromRun(id: ReleaseStepId, run: CapturedCommand): ReleaseStep {
  const report = parseJson(run);
  return {
    id,
    command: run.command,
    ok: report?.ok ?? run.exitCode === 0,
    exitCode: run.exitCode,
    status:
      typeof report?.status === "string" ? report.status : run.exitCode === 0 ? "ready" : "blocked",
    nextCommand: typeof report?.nextCommand === "string" ? report.nextCommand : null,
    report,
    ...(report
      ? {}
      : {
          error: (run.stderr || run.stdout || "command did not return JSON").trim(),
        }),
  };
}

function checkRuns(manager: PackageManager, target: DeployTarget): Array<Promise<ReleaseStep>> {
  return [
    capture(manager, runArgs(manager, "ops:preflight", ["--target", target, "--json"])).then(
      (run) => stepFromRun("ops.preflight", run),
    ),
    capture(manager, runArgs(manager, "ops:migrate", ["plan", "--json"])).then((run) =>
      stepFromRun("ops.migrate", run),
    ),
    capture(manager, runArgs(manager, "ops:backup", ["status", "--required", "--json"])).then(
      (run) => stepFromRun("ops.backup", run),
    ),
    capture(manager, runArgs(manager, "ops:jobs", ["--json"])).then((run) =>
      stepFromRun("ops.jobs", run),
    ),
    capture(manager, runArgs(manager, "ops:storage", ["--json"])).then((run) =>
      stepFromRun("ops.storage", run),
    ),
    capture(manager, runArgs(manager, "ops:plugins", ["doctor", "--json"])).then((run) =>
      stepFromRun("ops.plugins", run),
    ),
  ];
}

function verifyRuns(manager: PackageManager, url: string | null): Array<Promise<ReleaseStep>> {
  const healthArgs = url ? ["--url", url, "--json"] : ["--json"];
  return [
    capture(manager, runArgs(manager, "ops:health", healthArgs)).then((run) =>
      stepFromRun("ops.health", run),
    ),
    capture(manager, runArgs(manager, "ops:jobs", ["--json"])).then((run) =>
      stepFromRun("ops.jobs", run),
    ),
    capture(manager, runArgs(manager, "ops:storage", ["--json"])).then((run) =>
      stepFromRun("ops.storage", run),
    ),
    capture(manager, runArgs(manager, "ops:plugins", ["doctor", "--json"])).then((run) =>
      stepFromRun("ops.plugins", run),
    ),
  ];
}

async function runRelease(): Promise<ReleaseJson> {
  const manager = detectPackageManager(process.cwd());
  if (MODE === "check" || MODE === "plan") {
    const target = parseDeployTargetArg(ARGV) ?? "docker";
    const steps = await Promise.all(checkRuns(manager, target));
    return buildReleaseJson({ mode: MODE === "plan" ? "check" : MODE, target, steps });
  }

  if (MODE === "verify") {
    const url = readUrlArg(ARGV);
    const steps = await Promise.all(verifyRuns(manager, url));
    return buildReleaseJson({ mode: MODE, url, steps });
  }

  throw new Error(`Unsupported release mode: ${MODE}`);
}

function defaultPlanArtifactPath(planId: string): string {
  return resolve(process.cwd(), ".nexpress", "releases", `${planId}.json`);
}

function defaultApplyArtifactPath(planId: string): string {
  return resolve(process.cwd(), ".nexpress", "releases", `${planId}-apply.json`);
}

async function writeReleasePlanArtifact(plan: ReleasePlanJson, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

async function writeReleaseApplyArtifact(apply: ReleaseApplyJson, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(apply, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isReleaseStatus(value: unknown): value is ReleaseJson["status"] {
  return value === "ready" || value === "attention" || value === "blocked";
}

function isReleasePlanSummary(value: unknown): value is ReleasePlanJson["summary"] {
  return (
    isRecord(value) &&
    typeof value.commands === "number" &&
    typeof value.remediationCommands === "number" &&
    typeof value.releaseCommands === "number" &&
    typeof value.verifyCommands === "number"
  );
}

function isReleasePlanApply(value: unknown): value is ReleasePlanJson["apply"] {
  return (
    isRecord(value) &&
    typeof value.allowed === "boolean" &&
    value.requiresApproval === true &&
    isStringOrNull(value.blockedReason) &&
    isStringOrNull(value.nextCommand) &&
    isStringOrNull(value.projectNextCommand)
  );
}

function isReleasePlanAudit(value: unknown): value is ReleasePlanJson["audit"] {
  return isRecord(value) && isStringOrNull(value.artifactPath);
}

function isReleasePlanJson(value: unknown): value is ReleasePlanJson {
  return (
    isRecord(value) &&
    value.schemaVersion === "np.release-plan.v1" &&
    typeof value.ok === "boolean" &&
    typeof value.planId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.target === "string" &&
    isReleaseStatus(value.status) &&
    isReleasePlanSummary(value.summary) &&
    isReleasePlanApply(value.apply) &&
    isReleasePlanAudit(value.audit) &&
    Array.isArray(value.commands) &&
    isRecord(value.check)
  );
}

async function readReleasePlanArtifact(planPath: string): Promise<ReleasePlanJson> {
  const raw = await readFile(planPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isReleasePlanJson(parsed)) {
    throw new Error(`Invalid release plan artifact: ${planPath}`);
  }
  return parsed;
}

async function runReleasePlan(): Promise<ReleasePlanJson> {
  const check = await runRelease();
  const target = check.target ?? parseDeployTargetArg(ARGV) ?? "docker";
  const createdAt = new Date().toISOString();
  const planId = `release-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const artifactPath = resolve(process.cwd(), readOutArg(ARGV) ?? defaultPlanArtifactPath(planId));
  const plan = buildReleasePlanJson({ planId, createdAt, target, artifactPath, check });
  await writeReleasePlanArtifact(plan, artifactPath);
  return plan;
}

async function executeReleasePlanCommands(
  plan: ReleasePlanJson,
): Promise<ReleaseApplyCommandResult[]> {
  const results: ReleaseApplyCommandResult[] = [];
  for (const [index, command] of plan.commands.entries()) {
    if (!command.required) {
      results.push({ ...command, status: "skipped", exitCode: null });
      continue;
    }
    const spec = getReleaseApplyCommandSpec(command.command, plan.target);
    if (!spec) {
      results.push({
        ...command,
        status: "blocked",
        exitCode: null,
        stderr: "release apply command did not match the executable allowlist",
      });
      for (const remaining of plan.commands.slice(index + 1)) {
        results.push({
          ...remaining,
          status: remaining.required ? "pending" : "skipped",
          exitCode: null,
        });
      }
      break;
    }
    const run = await captureProcess(spec.executable, spec.args, command.command);
    const status = run.exitCode === 0 ? "success" : "failed";
    results.push({
      ...command,
      status,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
    });
    if (status === "failed") {
      for (const remaining of plan.commands.slice(index + 1)) {
        results.push({
          ...remaining,
          status: remaining.required ? "pending" : "skipped",
          exitCode: null,
        });
      }
      break;
    }
  }
  return results;
}

async function runReleaseApply(): Promise<ReleaseApplyJson> {
  const planArg = readPlanArg(ARGV);
  if (!planArg) throw new Error("release apply requires --plan <path>");
  const planArtifactPath = resolve(process.cwd(), planArg);
  const plan = await readReleasePlanArtifact(planArtifactPath);
  const createdAt = new Date().toISOString();
  const artifactPath = resolve(
    process.cwd(),
    readOutArg(ARGV) ?? defaultApplyArtifactPath(plan.planId),
  );
  const approved = readApproveArg(ARGV) === plan.planId;
  const mode: ReleaseApplyJson["mode"] = EXECUTE_MODE ? "execute" : "dry-run";
  const preflight = buildReleaseApplyJson({
    plan,
    createdAt,
    mode,
    approved,
    artifactPath,
    planArtifactPath,
  });
  if (!preflight.ok || mode === "dry-run") {
    await writeReleaseApplyArtifact(preflight, artifactPath);
    return preflight;
  }

  const commandResults = await executeReleasePlanCommands(plan);
  const apply = buildReleaseApplyJson({
    plan,
    createdAt,
    mode,
    approved,
    artifactPath,
    planArtifactPath,
    commandResults,
  });
  await writeReleaseApplyArtifact(apply, artifactPath);
  return apply;
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  if (MODE === "plan") {
    const plan = await runReleasePlan();
    if (JSON_MODE) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(renderBriefReleasePlan(plan, { color: COLOR_MODE }));
    }
    process.exit(plan.ok ? 0 : 1);
  }

  if (MODE === "apply") {
    const apply = await runReleaseApply();
    if (JSON_MODE) {
      console.log(JSON.stringify(apply, null, 2));
    } else {
      console.log(renderBriefReleaseApply(apply, { color: COLOR_MODE }));
    }
    process.exit(apply.ok ? 0 : 1);
  }

  const report = await runRelease();
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefReleaseReport(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
