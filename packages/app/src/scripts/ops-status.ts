// Must be first so .env is available before status checks run.
import "./_load-env.js";

import {
  buildOpsStatusJson,
  collectOpsStatusChecks,
  renderBriefOpsStatus,
} from "./ops-status-core.js";

const ARGV = process.argv.slice(2);
const JSON_MODE = ARGV.includes("--json");
const BRIEF_MODE = ARGV.includes("--brief");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops status

Usage:
  pnpm run ops:status
  pnpm --silent run ops:status -- --json
  pnpm run ops:status -- --brief --no-color
  nexpress ops status --json

Options:
  --json       Print the stable machine-readable ops status report.
  --brief      Print compact one-line-per-check human output.
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

  const checks = await collectOpsStatusChecks();
  const report = buildOpsStatusJson(checks);

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsStatus(report, { color: COLOR_MODE || !BRIEF_MODE }));
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
