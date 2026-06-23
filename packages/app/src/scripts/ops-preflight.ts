// Must be first so child scripts see the same environment shape.
import "./_load-env.js";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DEPLOY_TARGETS, parseDeployTargetArg, type DeployTarget } from "./deploy-targets.js";
import type { DeployPlanJson } from "./deploy-plan-core.js";
import type { DoctorJsonOutput } from "./doctor-output.js";
import { toProjectCommand } from "./ops-command-format.js";
import type { OpsMigrateJson } from "./ops-migrate-core.js";

export interface OpsPreflightJson {
  schemaVersion: "np.ops-preflight.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  target: DeployTarget;
  summary: {
    planUnresolvedRequiredEnv: number;
    doctorErrors: number;
    doctorWarnings: number;
    migrationErrors: number;
    migrationWarnings: number;
    migrationPending: number;
    migrationDestructiveFindings: number;
    migrationInspectionBlocked: boolean;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  steps: Array<{
    id: "deploy.plan" | "doctor.prod" | "ops.migrate";
    command: string;
    projectCommand: string;
    ok: boolean;
    exitCode: number;
  }>;
  plan: DeployPlanJson | null;
  doctor: DoctorJsonOutput | null;
  migrate: OpsMigrateJson | null;
}

type PackageManager = "pnpm" | "npm" | "yarn";

const ARGV = process.argv.slice(2);
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const EMPTY_ANSI = {
  green: "",
  yellow: "",
  red: "",
  dim: "",
  reset: "",
};

interface CapturedCommand {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function printHelp(): void {
  console.log(`NexPress ops preflight

Usage:
  pnpm run ops:preflight -- --target vercel
  pnpm --silent run ops:preflight -- --target vercel --json
  nexpress ops preflight --target vercel --json

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --target <host> Deployment target to check.
  --json          Print the stable machine-readable preflight report.
  --brief         Print compact human output. This is the default.
  --no-color      Disable ANSI color in human-readable output.
  --help, -h      Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
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

function capture(manager: PackageManager, args: string[]): Promise<CapturedCommand> {
  return new Promise((resolveFn, reject) => {
    const child = spawn(manager, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("error", reject);
    child.on("exit", (code) => {
      resolveFn({
        command: commandText(manager, args),
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

function parseJson<T>(run: CapturedCommand, label: string): T {
  const start = run.stdout.indexOf("{");
  const end = run.stdout.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? run.stdout.slice(start, end + 1) : run.stdout;
  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} did not return valid JSON: ${detail}\n${run.stderr || run.stdout}`, {
      cause: error,
    });
  }
}

export function buildOpsPreflightReport(args: {
  target: DeployTarget;
  planRun: CapturedCommand;
  doctorRun: CapturedCommand;
  migrateRun: CapturedCommand;
  plan: DeployPlanJson;
  doctor: DoctorJsonOutput;
  migrate: OpsMigrateJson;
}): OpsPreflightJson {
  const planUnresolvedRequiredEnv = args.plan.summary.requiredEnv.unresolved;
  const migrationErrors = args.migrate.checks.filter((check) => check.state === "error").length;
  const migrationWarnings = args.migrate.checks.filter((check) => check.state === "warn").length;
  const blocksDeploy = planUnresolvedRequiredEnv > 0 || !args.doctor.ok || !args.migrate.ok;
  const needsAttention = args.doctor.summary.warnings > 0 || migrationWarnings > 0;
  const nextCommand =
    !blocksDeploy && !needsAttention
      ? null
      : planUnresolvedRequiredEnv > 0 || !args.doctor.ok
        ? (args.doctor.nextCommand ??
          `pnpm run doctor:prod -- --target ${args.target} --brief --no-color --fix-plan`)
        : (args.migrate.nextCommand ?? "pnpm --silent run ops:migrate -- plan --json");

  return {
    schemaVersion: "np.ops-preflight.v1",
    ok: !blocksDeploy,
    status: blocksDeploy ? "blocked" : needsAttention ? "attention" : "ready",
    target: args.target,
    summary: {
      planUnresolvedRequiredEnv,
      doctorErrors: args.doctor.summary.errors,
      doctorWarnings: args.doctor.summary.warnings,
      migrationErrors,
      migrationWarnings,
      migrationPending: args.migrate.summary.pending,
      migrationDestructiveFindings: args.migrate.summary.destructiveFindings,
      migrationInspectionBlocked: args.migrate.summary.inspectionBlocked,
    },
    nextCommand,
    projectNextCommand: nextCommand ? toProjectCommand(nextCommand) : null,
    steps: [
      {
        id: "deploy.plan",
        command: args.planRun.command,
        projectCommand: toProjectCommand(args.planRun.command),
        ok: args.planRun.exitCode === 0 && planUnresolvedRequiredEnv === 0,
        exitCode: args.planRun.exitCode,
      },
      {
        id: "doctor.prod",
        command: args.doctorRun.command,
        projectCommand: toProjectCommand(args.doctorRun.command),
        ok: args.doctor.ok,
        exitCode: args.doctorRun.exitCode,
      },
      {
        id: "ops.migrate",
        command: args.migrateRun.command,
        projectCommand: toProjectCommand(args.migrateRun.command),
        ok: args.migrate.ok,
        exitCode: args.migrateRun.exitCode,
      },
    ],
    plan: args.plan,
    doctor: args.doctor,
    migrate: args.migrate,
  };
}

export function renderBriefOpsPreflightReport(report: OpsPreflightJson, color: boolean): string {
  const c = color ? ANSI : EMPTY_ANSI;
  const state =
    report.status === "ready"
      ? `${c.green}ready${c.reset}`
      : report.status === "attention"
        ? `${c.yellow}attention${c.reset}`
        : `${c.red}blocked${c.reset}`;
  const lines = [
    `${c.dim}NexPress ops preflight${c.reset}`,
    `${state}: ${report.target}`,
    `required env unresolved: ${report.summary.planUnresolvedRequiredEnv.toString()}`,
    `doctor: ${report.summary.doctorErrors.toString()} errors, ${report.summary.doctorWarnings.toString()} warnings`,
    report.summary.migrationInspectionBlocked
      ? `migrate: inspection blocked, ${report.summary.migrationErrors.toString()} errors, ${report.summary.migrationWarnings.toString()} warnings`
      : `migrate: ${report.summary.migrationPending.toString()} pending, ${report.summary.migrationDestructiveFindings.toString()} destructive findings, ${report.summary.migrationErrors.toString()} errors, ${report.summary.migrationWarnings.toString()} warnings`,
  ];
  for (const step of report.steps) {
    lines.push(`${step.ok ? "[ok]" : "[blocked]"} ${step.id} - ${step.command}`);
    if (!step.ok) {
      const next = stepNextCommand(report, step.id);
      if (next) lines.push(`  next: ${next}`);
    }
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
}

function stepNextCommand(
  report: OpsPreflightJson,
  id: OpsPreflightJson["steps"][number]["id"],
): string | null {
  switch (id) {
    case "deploy.plan":
      return report.plan?.nextCommands[0] ?? null;
    case "doctor.prod":
      return report.doctor?.projectNextCommand ?? report.doctor?.nextCommand ?? null;
    case "ops.migrate":
      return report.migrate?.projectNextCommand ?? report.migrate?.nextCommand ?? null;
  }
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const target = parseDeployTargetArg(ARGV) ?? "docker";
  const manager = detectPackageManager(process.cwd());
  const passthrough = ["--target", target, "--json"];
  const doctorPassthrough = ["--target", target, "--json", "--fix-plan"];

  const [planRun, doctorRun, migrateRun] = await Promise.all([
    capture(manager, runArgs(manager, "deploy:plan", passthrough)),
    capture(manager, runArgs(manager, "doctor:prod", doctorPassthrough)),
    capture(manager, runArgs(manager, "ops:migrate", ["plan", "--json"])),
  ]);
  const plan = parseJson<DeployPlanJson>(planRun, "deploy:plan");
  const doctor = parseJson<DoctorJsonOutput>(doctorRun, "doctor:prod");
  const migrate = parseJson<OpsMigrateJson>(migrateRun, "ops:migrate plan");
  const report = buildOpsPreflightReport({
    target,
    planRun,
    doctorRun,
    migrateRun,
    plan,
    doctor,
    migrate,
  });

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsPreflightReport(report, COLOR_MODE));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
