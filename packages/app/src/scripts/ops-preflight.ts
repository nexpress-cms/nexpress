// Must be first so child scripts see the same environment shape.
import "./_load-env.js";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DEPLOY_TARGETS, parseDeployTargetArg, type DeployTarget } from "./deploy-targets.js";
import type { DeployPlanJson } from "./deploy-plan-core.js";
import type { DoctorJsonOutput } from "./doctor-output.js";
import { toProjectCommand } from "./ops-command-format.js";

interface OpsPreflightJson {
  schemaVersion: "np.ops-preflight.v1";
  ok: boolean;
  status: "ready" | "attention" | "blocked";
  target: DeployTarget;
  summary: {
    planUnresolvedRequiredEnv: number;
    doctorErrors: number;
    doctorWarnings: number;
  };
  nextCommand: string | null;
  projectNextCommand: string | null;
  steps: Array<{
    id: "deploy.plan" | "doctor.prod";
    command: string;
    projectCommand: string;
    ok: boolean;
    exitCode: number;
  }>;
  plan: DeployPlanJson | null;
  doctor: DoctorJsonOutput | null;
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
  pnpm run ops:preflight -- --target vercel --json
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

function buildReport(args: {
  target: DeployTarget;
  planRun: CapturedCommand;
  doctorRun: CapturedCommand;
  plan: DeployPlanJson;
  doctor: DoctorJsonOutput;
}): OpsPreflightJson {
  const planUnresolvedRequiredEnv = args.plan.summary.requiredEnv.unresolved;
  const blocksDeploy = planUnresolvedRequiredEnv > 0 || !args.doctor.ok;
  const needsAttention = args.doctor.summary.warnings > 0;
  const nextCommand =
    !blocksDeploy && !needsAttention
      ? null
      : (args.doctor.nextCommand ??
        `pnpm run doctor:prod -- --target ${args.target} --brief --no-color --fix-plan`);

  return {
    schemaVersion: "np.ops-preflight.v1",
    ok: !blocksDeploy,
    status: blocksDeploy ? "blocked" : needsAttention ? "attention" : "ready",
    target: args.target,
    summary: {
      planUnresolvedRequiredEnv,
      doctorErrors: args.doctor.summary.errors,
      doctorWarnings: args.doctor.summary.warnings,
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
    ],
    plan: args.plan,
    doctor: args.doctor,
  };
}

function renderBrief(report: OpsPreflightJson, color: boolean): string {
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
  ];
  for (const step of report.steps) {
    lines.push(`${step.ok ? "[ok]" : "[blocked]"} ${step.id} - ${step.command}`);
  }
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  if (report.projectNextCommand && report.projectNextCommand !== report.nextCommand) {
    lines.push(`Project next: ${report.projectNextCommand}`);
  }
  return lines.join("\n");
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

  const [planRun, doctorRun] = await Promise.all([
    capture(manager, runArgs(manager, "deploy:plan", passthrough)),
    capture(manager, runArgs(manager, "doctor:prod", doctorPassthrough)),
  ]);
  const plan = parseJson<DeployPlanJson>(planRun, "deploy:plan");
  const doctor = parseJson<DoctorJsonOutput>(doctorRun, "doctor:prod");
  const report = buildReport({ target, planRun, doctorRun, plan, doctor });

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBrief(report, COLOR_MODE));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
