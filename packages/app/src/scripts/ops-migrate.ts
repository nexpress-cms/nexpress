// Must be first so .env is available before migration checks run.
import "./_load-env.js";

import {
  collectOpsMigrateRollbackPlan,
  collectOpsMigrateReport,
  renderBriefOpsMigrateApply,
  renderBriefOpsMigrateReport,
  renderBriefOpsMigrateRollbackPlan,
  runOpsMigrateApply,
  type OpsMigrateMode,
} from "./ops-migrate-core.js";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = normalizePnpmPassthroughArgv(RAW_ARGV);
const MODE: OpsMigrateMode = ARGV[0] === "plan" ? "plan" : "status";
const ROLLBACK_PLAN_MODE = ARGV[0] === "rollback-plan";
const APPLY_MODE = ARGV[0] === "apply";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops migrate

Usage:
  pnpm --silent run ops:migrate -- status --json
  pnpm run ops:migrate -- plan --brief --no-color
  pnpm --silent run ops:migrate -- rollback-plan --json
  pnpm --silent run ops:migrate -- apply --safe --json
  pnpm --silent run ops:migrate -- apply --safe --execute --approve migrate-apply --json
  nexpress ops migrate status --json
  nexpress ops migrate plan --json
  nexpress ops migrate rollback-plan --json
  nexpress ops migrate apply --safe --execute --approve migrate-apply --json

Options:
  --safe       Required for apply. Blocks drift, unknown applied migrations, destructive SQL, and stale backups.
  --execute    Apply pending migrations. Without this, apply dry-runs.
  --approve    Required with --execute: migrate-apply.
  --out <path> Write a JSON artifact to a specific path.
  --json       Print the stable machine-readable migration report.
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

  if (ROLLBACK_PLAN_MODE) {
    const report = await collectOpsMigrateRollbackPlan({});
    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderBriefOpsMigrateRollbackPlan(report, { color: COLOR_MODE }));
    }
    process.exit(report.ok ? 0 : 1);
  }

  if (APPLY_MODE) {
    const report = await runOpsMigrateApply({
      safe: ARGV.includes("--safe"),
      execute: ARGV.includes("--execute"),
      approve: readStringArg("--approve"),
      out: readStringArg("--out"),
    });
    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderBriefOpsMigrateApply(report, { color: COLOR_MODE }));
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
