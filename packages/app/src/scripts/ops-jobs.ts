// Must be first so .env is available before jobs checks run.
import "./_load-env.js";

import { collectOpsJobsStatus, renderBriefOpsJobsStatus } from "./ops-jobs-core.js";

const ARGV = process.argv.slice(2);
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops jobs

Usage:
  pnpm run ops:jobs
  pnpm run ops:jobs -- --json
  nexpress ops jobs status --json

Options:
  --json       Print the stable machine-readable jobs report.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const report = await collectOpsJobsStatus();
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
