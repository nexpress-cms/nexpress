// Must be first so .env is available before backup checks run.
import "./_load-env.js";

import {
  collectOpsBackupReport,
  renderBriefOpsBackupReport,
  type OpsBackupMode,
} from "./ops-backup-core.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const SUBCOMMAND = ARGV[0] ?? "status";
const MODE: OpsBackupMode =
  SUBCOMMAND === "list" ? "list" : SUBCOMMAND === "verify" ? "verify" : "status";
const JSON_MODE = ARGV.includes("--json");
const REQUIRED_MODE = ARGV.includes("--required");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops backup

Usage:
  pnpm run ops:backup -- status --json
  pnpm run ops:backup -- status --required --json
  pnpm run ops:backup -- list --brief --no-color
  pnpm run ops:backup -- verify latest --json
  nexpress ops backup status --json
  nexpress ops backup verify latest --json

Options:
  --required   Treat missing/stale/unverified backups as blocked.
  --json       Print the stable machine-readable backup report.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function invalidSubcommand(): boolean {
  if (SUBCOMMAND === "status" || SUBCOMMAND === "list") return false;
  if (SUBCOMMAND === "verify") return ARGV[1] !== "latest";
  return true;
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (invalidSubcommand()) {
    printHelp();
    process.exit(2);
  }

  const report = await collectOpsBackupReport({ mode: MODE, required: REQUIRED_MODE });
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsBackupReport(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
