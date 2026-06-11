// Must be first so .env is available before jobs checks run.
import "./_load-env.js";

import {
  applyOpsJobsDrainMutation,
  applyOpsJobsPauseMutation,
  applyOpsJobsRetryAllMutation,
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
  pnpm run ops:jobs -- retry-all --state failed --json
  pnpm run ops:jobs -- retry-all --state failed --execute --approve retry-all --json
  pnpm run ops:jobs -- drain --execute --approve drain --json
  nexpress ops jobs status --json
  nexpress ops jobs pause --reason "maintenance" --json
  nexpress ops jobs resume --json
  nexpress ops jobs retry-all --state failed --execute --approve retry-all --json
  nexpress ops jobs drain --execute --approve drain --json

Options:
  --reason <text>  Optional reason stored with pause/resume/drain changes.
  --state <state>  Retry-all state: failed, cancelled, or expired. Defaults to failed.
  --name <queue>   Narrow retry-all to one pg-boss queue name.
  --limit <n>      Maximum retry-all rows to process. Defaults to 200, caps at 500.
  --execute        Apply retry-all/drain. Without this, those commands dry-run.
  --approve <id>   Required with --execute: retry-all or drain.
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
  return readStringArg("--reason");
}

function readStringArg(name: string): string | null {
  for (let i = 0; i < ARGV.length; i += 1) {
    const arg = ARGV[i];
    if (arg === name) return ARGV[i + 1] ?? null;
    if (arg?.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

function readRetryStateArg(): "failed" | "cancelled" | "expired" | undefined {
  const state = readStringArg("--state");
  if (state === "failed" || state === "cancelled" || state === "expired") return state;
  return undefined;
}

function readLimitArg(): number | undefined {
  const raw = readStringArg("--limit");
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  if (shouldPrintHelp(ARGV)) {
    printHelp();
    return;
  }
  if (
    SUBCOMMAND !== "status" &&
    SUBCOMMAND !== "pause" &&
    SUBCOMMAND !== "resume" &&
    SUBCOMMAND !== "retry-all" &&
    SUBCOMMAND !== "drain"
  ) {
    printHelp();
    process.exit(2);
  }

  const report =
    SUBCOMMAND === "pause" || SUBCOMMAND === "resume"
      ? await applyOpsJobsPauseMutation({ action: SUBCOMMAND, reason: readReasonArg() })
      : SUBCOMMAND === "retry-all"
        ? await applyOpsJobsRetryAllMutation({
            state: readRetryStateArg(),
            name: readStringArg("--name"),
            limit: readLimitArg(),
            execute: ARGV.includes("--execute"),
            approve: readStringArg("--approve"),
          })
        : SUBCOMMAND === "drain"
          ? await applyOpsJobsDrainMutation({
              execute: ARGV.includes("--execute"),
              approve: readStringArg("--approve"),
              reason: readReasonArg(),
            })
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
