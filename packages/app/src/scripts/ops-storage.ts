// Must be first so .env is available before storage checks run.
import "./_load-env.js";

import {
  collectOpsStorageStatus,
  renderBriefOpsStorageStatus,
  runOpsStorageTest,
} from "./ops-storage-core.js";

const ARGV = process.argv.slice(2);
const SUBCOMMAND = ARGV[0] && !ARGV[0].startsWith("--") ? ARGV[0] : "status";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops storage

Usage:
  pnpm run ops:storage
  pnpm run ops:storage -- --json
  pnpm run ops:storage -- verify --json
  pnpm run ops:storage -- test --json
  pnpm run ops:storage -- test --execute --approve storage-test --json
  nexpress ops storage status --json
  nexpress ops storage verify --json
  nexpress ops storage test --execute --approve storage-test --json

Options:
  --execute      Apply the storage test probe. Without this, test dry-runs.
  --approve <id> Required with --execute: storage-test.
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

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (SUBCOMMAND !== "status" && SUBCOMMAND !== "verify" && SUBCOMMAND !== "test") {
    printHelp();
    process.exit(2);
  }

  const report =
    SUBCOMMAND === "test"
      ? await runOpsStorageTest({
          execute: ARGV.includes("--execute"),
          approve: readStringArg("--approve"),
        })
      : await collectOpsStorageStatus(process.env, SUBCOMMAND);
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsStorageStatus(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
