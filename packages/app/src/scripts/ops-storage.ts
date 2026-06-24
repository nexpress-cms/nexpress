// Must be first so .env is available before storage checks run.
import "./_load-env.js";

import {
  buildOpsStorageMigrationPlan,
  collectOpsStorageStatus,
  collectOpsStorageDriftList,
  renderBriefOpsStorageStatus,
  runOpsStorageMigrationApply,
  runOpsStorageTest,
} from "./ops-storage-core.js";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = normalizePnpmPassthroughArgv(RAW_ARGV);
const SUBCOMMAND = ARGV[0] && !ARGV[0].startsWith("--") ? ARGV[0] : "status";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops storage

Usage:
  pnpm run ops:storage
  pnpm --silent run ops:storage -- --json
  pnpm --silent run ops:storage -- verify --json
  pnpm --silent run ops:storage -- missing-files --json
  pnpm --silent run ops:storage -- orphaned-files --json
  pnpm --silent run ops:storage -- migrate plan --target s3 --json
  pnpm --silent run ops:storage -- migrate apply --target s3 --json
  pnpm --silent run ops:storage -- migrate apply --target s3 --execute --approve storage-migrate --json
  pnpm --silent run ops:storage -- test --json
  pnpm --silent run ops:storage -- test --execute --approve storage-test --json
  nexpress ops storage status --json
  nexpress ops storage verify --json
  nexpress ops storage missing-files --json
  nexpress ops storage orphaned-files --json
  nexpress ops storage migrate plan --target s3 --json
  nexpress ops storage migrate apply --target s3 --execute --approve storage-migrate --json
  nexpress ops storage test --execute --approve storage-test --json

Options:
  --target <id>  Migration plan target. Currently only s3.
  --limit <n>    Maximum drift-list rows to return. Defaults to 100, caps at 1000.
  --execute      Apply the storage test probe or migration apply. Without this, commands dry-run.
  --approve <id> Required with --execute: storage-test or storage-migrate.
  --out <path>   Write a JSON artifact to a specific path.
  --json       Print the stable machine-readable storage report.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readStringArg(name: string): string | null {
  for (let i = 0; i < ARGV.length; i += 1) {
    const arg = ARGV[i];
    if (arg === name) return ARGV[i + 1] ?? null;
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

function readLimitArg(): number | undefined {
  const raw = readStringArg("--limit");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function renderBriefGeneric(report: {
  schemaVersion: string;
  status: string;
  nextCommand: string | null;
  summary: unknown;
}): string {
  const lines = [
    `NexPress ${report.schemaVersion}`,
    `${report.status}`,
    `summary: ${JSON.stringify(report.summary)}`,
  ];
  if (report.nextCommand) lines.push(`Next: ${report.nextCommand}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (
    SUBCOMMAND !== "status" &&
    SUBCOMMAND !== "verify" &&
    SUBCOMMAND !== "test" &&
    SUBCOMMAND !== "missing-files" &&
    SUBCOMMAND !== "orphaned-files" &&
    SUBCOMMAND !== "migrate"
  ) {
    printHelp();
    process.exit(2);
  }
  if (SUBCOMMAND === "migrate" && ARGV[1] !== "plan" && ARGV[1] !== "apply") {
    printHelp();
    process.exit(2);
  }

  const report =
    SUBCOMMAND === "test"
      ? await runOpsStorageTest({
          execute: ARGV.includes("--execute"),
          approve: readStringArg("--approve"),
        })
      : SUBCOMMAND === "missing-files" || SUBCOMMAND === "orphaned-files"
        ? await collectOpsStorageDriftList({
            operation: SUBCOMMAND,
            limit: readLimitArg(),
          })
        : SUBCOMMAND === "migrate"
          ? ARGV[1] === "apply"
            ? await runOpsStorageMigrationApply({
                target: readStringArg("--target") ?? "s3",
                execute: ARGV.includes("--execute"),
                approve: readStringArg("--approve"),
                out: readStringArg("--out"),
              })
            : await buildOpsStorageMigrationPlan({
                target: readStringArg("--target") ?? "s3",
              })
          : await collectOpsStorageStatus(process.env, SUBCOMMAND);
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.schemaVersion === "np.ops-storage.v1") {
    console.log(renderBriefOpsStorageStatus(report, { color: COLOR_MODE }));
  } else {
    console.log(renderBriefGeneric(report));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
