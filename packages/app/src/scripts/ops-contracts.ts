import { buildOpsContractsJson, renderBriefOpsContracts } from "./ops-contracts-core.js";

const ARGV = process.argv.slice(2);
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops contracts

Usage:
  pnpm --silent run ops:contracts -- --json
  pnpm run ops:contracts -- --brief --no-color
  nexpress ops contracts --json

Options:
  --json       Print the stable machine-readable ops contract registry.
  --brief      Print compact human output. This is the default.
  --no-color   Disable ANSI color in human-readable output.
  --help, -h   Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function main(): void {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }

  const report = buildOpsContractsJson();
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsContracts(report, { color: COLOR_MODE }));
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
