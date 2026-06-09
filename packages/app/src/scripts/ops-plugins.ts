// Must be first so .env is available before plugin config imports run.
import "./_load-env.js";

import { collectOpsPluginsStatus, renderBriefOpsPluginsStatus } from "./ops-plugins-core.js";

const ARGV = process.argv.slice(2);
const MODE: "list" | "doctor" = ARGV[0] === "list" ? "list" : "doctor";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops plugins

Usage:
  pnpm run ops:plugins -- list
  pnpm run ops:plugins -- doctor --json
  nexpress ops plugins list --json
  nexpress ops plugins doctor --json

Options:
  --json       Print the stable machine-readable plugin report.
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

  const report = await collectOpsPluginsStatus();
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsPluginsStatus(report, MODE, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
