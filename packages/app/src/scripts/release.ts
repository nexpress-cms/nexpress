// Must be first so child scripts see the same environment shape.
import "./_load-env.js";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DEPLOY_TARGETS, parseDeployTargetArg, type DeployTarget } from "./deploy-targets.js";
import {
  buildReleaseJson,
  renderBriefReleaseReport,
  type ReleaseJson,
  type ReleaseMode,
  type ReleaseStep,
  type ReleaseStepId,
  type ReleaseStepReport,
} from "./release-core.js";

type PackageManager = "pnpm" | "npm" | "yarn";

interface CapturedCommand {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const MODE: ReleaseMode = ARGV[0] === "verify" ? "verify" : "check";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress release

Usage:
  pnpm run release -- check --target vercel --json
  pnpm run release -- verify --url https://example.com --json
  nexpress release check --target vercel --brief --no-color
  nexpress release verify --url https://example.com --brief --no-color

Targets:
  ${DEPLOY_TARGETS.join(", ")}

Options:
  --target <host> Deployment target for release check. Defaults to docker.
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
  if (MODE === "check") {
    const target = parseDeployTargetArg(ARGV) ?? "docker";
    const steps = await Promise.all(checkRuns(manager, target));
    return buildReleaseJson({ mode: MODE, target, steps });
  }

  const url = readUrlArg(ARGV);
  const steps = await Promise.all(verifyRuns(manager, url));
  return buildReleaseJson({ mode: MODE, url, steps });
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
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
