// Must be first so child scripts see the same environment shape.
import "./_load-env.js";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildRunbookJson,
  renderBriefRunbook,
  type RunbookEvidence,
  type RunbookId,
} from "./runbook-core.js";

type PackageManager = "pnpm" | "npm" | "yarn";

interface CapturedCommand {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface OpsReport {
  schemaVersion?: string;
  ok?: boolean;
  status?: string;
  summary?: unknown;
  nextCommand?: string | null;
  plan?: {
    nextCommands?: unknown;
  };
}

const RUNBOOKS: RunbookId[] = [
  "worker-not-draining",
  "storage-local-to-s3",
  "backup-restore-drill",
  "migration-crashed",
];

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const RUNBOOK = RUNBOOKS.includes(ARGV[0] as RunbookId) ? (ARGV[0] as RunbookId) : null;
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress runbook

Usage:
  pnpm run runbook -- worker-not-draining --json
  pnpm run runbook -- storage-local-to-s3 --brief --no-color
  nexpress runbook migration-crashed --json

Runbooks:
  ${RUNBOOKS.join(", ")}

Options:
  --json       Print the stable machine-readable runbook report.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
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

function parseJson(run: CapturedCommand): OpsReport | null {
  const start = run.stdout.indexOf("{");
  const end = run.stdout.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? run.stdout.slice(start, end + 1) : run.stdout;
  try {
    return JSON.parse(candidate) as OpsReport;
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function evidenceFromRun(id: string, run: CapturedCommand): RunbookEvidence {
  const report = parseJson(run);
  const nextCommands = readStringArray(report?.plan?.nextCommands);
  return {
    id,
    command: run.command,
    ...(typeof report?.schemaVersion === "string" ? { schemaVersion: report.schemaVersion } : {}),
    ok: report?.ok ?? run.exitCode === 0,
    status:
      typeof report?.status === "string" ? report.status : run.exitCode === 0 ? "ready" : "blocked",
    ...(report?.summary ? { summary: report.summary } : {}),
    nextCommand: typeof report?.nextCommand === "string" ? report.nextCommand : null,
    ...(nextCommands.length > 0 ? { nextCommands } : {}),
    ...(report
      ? {}
      : {
          error: (run.stderr || run.stdout || "command did not return JSON").trim(),
        }),
  };
}

function evidenceRuns(
  manager: PackageManager,
  runbook: RunbookId,
): Array<Promise<RunbookEvidence>> {
  switch (runbook) {
    case "worker-not-draining":
      return [
        capture(manager, runArgs(manager, "ops:jobs", ["--json"])).then((run) =>
          evidenceFromRun("ops.jobs", run),
        ),
      ];
    case "storage-local-to-s3":
      return [
        capture(manager, runArgs(manager, "ops:storage", ["--json"])).then((run) =>
          evidenceFromRun("ops.storage", run),
        ),
        capture(manager, runArgs(manager, "ops:storage", ["missing-files", "--json"])).then((run) =>
          evidenceFromRun("ops.storage.missing", run),
        ),
        capture(manager, runArgs(manager, "ops:storage", ["orphaned-files", "--json"])).then(
          (run) => evidenceFromRun("ops.storage.orphaned", run),
        ),
        capture(
          manager,
          runArgs(manager, "ops:storage", ["migrate", "plan", "--target", "s3", "--json"]),
        ).then((run) => evidenceFromRun("ops.storage.migrate-plan", run)),
        capture(manager, runArgs(manager, "ops:preflight", ["--target", "vercel", "--json"])).then(
          (run) => evidenceFromRun("ops.preflight.vercel", run),
        ),
      ];
    case "backup-restore-drill":
      return [
        capture(manager, runArgs(manager, "ops:backup", ["verify", "latest", "--json"])).then(
          (run) => evidenceFromRun("ops.backup.verify", run),
        ),
        capture(manager, runArgs(manager, "ops:backup", ["restore-plan", "latest", "--json"])).then(
          (run) => evidenceFromRun("ops.backup.restore-plan", run),
        ),
        capture(
          manager,
          runArgs(manager, "release", ["check", "--target", "docker", "--json"]),
        ).then((run) => evidenceFromRun("release.check", run)),
      ];
    case "migration-crashed":
      return [
        capture(manager, runArgs(manager, "ops:migrate", ["status", "--json"])).then((run) =>
          evidenceFromRun("ops.migrate.status", run),
        ),
        capture(manager, runArgs(manager, "ops:migrate", ["plan", "--json"])).then((run) =>
          evidenceFromRun("ops.migrate.plan", run),
        ),
        capture(manager, runArgs(manager, "ops:migrate", ["rollback-plan", "--json"])).then((run) =>
          evidenceFromRun("ops.migrate.rollback-plan", run),
        ),
      ];
  }
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (!RUNBOOK) {
    printHelp();
    process.exit(2);
  }

  const manager = detectPackageManager(process.cwd());
  const evidence = await Promise.all(evidenceRuns(manager, RUNBOOK));
  const report = buildRunbookJson({ runbook: RUNBOOK, evidence });
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefRunbook(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
