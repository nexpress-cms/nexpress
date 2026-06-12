// Must be first so .env is available before migration checks run.
import "./_load-env.js";

import {
  collectOpsMigrateRollbackPlan,
  collectOpsMigrateReport,
  renderBriefOpsMigrateReport,
  renderBriefOpsMigrateRollbackPlan,
  type OpsMigrateMode,
} from "./ops-migrate-core.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const MODE: OpsMigrateMode = ARGV[0] === "plan" ? "plan" : "status";
const ROLLBACK_PLAN_MODE = ARGV[0] === "rollback-plan";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops migrate

Usage:
  pnpm run ops:migrate -- status --json
  pnpm run ops:migrate -- plan --brief --no-color
  pnpm run ops:migrate -- rollback-plan --json
  nexpress ops migrate status --json
  nexpress ops migrate plan --json
  nexpress ops migrate rollback-plan --json

Options:
  --json       Print the stable machine-readable migration report.
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

  if (ROLLBACK_PLAN_MODE) {
    const report = await collectOpsMigrateRollbackPlan({});
    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderBriefOpsMigrateRollbackPlan(report, { color: COLOR_MODE }));
    }
    process.exit(report.ok ? 0 : 1);
  }

  const report = await collectOpsMigrateReport({ mode: MODE });
  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsMigrateReport(report, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
