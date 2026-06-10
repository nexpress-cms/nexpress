// Must be first so .env is available before jobs checks run.
import "./_load-env.js";

import {
  applyOpsJobsPauseMutation,
  collectOpsJobsStatus,
  renderBriefOpsJobsStatus,
} from "./ops-jobs-core.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const SUBCOMMAND = ARGV[0] && !ARGV[0].startsWith("--") ? ARGV[0] : "status";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops jobs

Usage:
  pnpm run ops:jobs
  pnpm run ops:jobs -- --json
  pnpm run ops:jobs -- pause --reason "maintenance" --json
  pnpm run ops:jobs -- resume --json
  nexpress ops jobs status --json
  nexpress ops jobs pause --reason "maintenance" --json
  nexpress ops jobs resume --json

Options:
  --reason <text>  Optional reason stored with pause/resume changes.
  --json       Print the stable machine-readable jobs report.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function readReasonArg(): string | null {
  for (let i = 0; i < ARGV.length; i += 1) {
    const arg = ARGV[i];
    if (arg === "--reason") return ARGV[i + 1] ?? null;
    if (arg?.startsWith("--reason=")) return arg.slice("--reason=".length);
  }
  return null;
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (SUBCOMMAND !== "status" && SUBCOMMAND !== "pause" && SUBCOMMAND !== "resume") {
    printHelp();
    process.exit(2);
  }

  const report =
    SUBCOMMAND === "pause" || SUBCOMMAND === "resume"
      ? await applyOpsJobsPauseMutation({ action: SUBCOMMAND, reason: readReasonArg() })
      : await collectOpsJobsStatus();
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsJobsStatus(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
