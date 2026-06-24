// Must be first so .env is available before backup checks run.
import "./_load-env.js";

import {
  collectOpsBackupReport,
  collectOpsBackupRestorePlan,
  createOpsBackupManifest,
  renderBriefOpsBackupReport,
  renderBriefOpsBackupRestoreApply,
  renderBriefOpsBackupRestorePlan,
  runOpsBackupRestoreApply,
  type OpsBackupMode,
} from "./ops-backup-core.js";
import { normalizePnpmPassthroughArgv } from "./ops-command-format.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = normalizePnpmPassthroughArgv(RAW_ARGV);
const SUBCOMMAND = ARGV[0] && !ARGV[0].startsWith("--") ? ARGV[0] : "status";
const MODE: OpsBackupMode =
  SUBCOMMAND === "create"
    ? "create"
    : SUBCOMMAND === "list"
      ? "list"
      : SUBCOMMAND === "verify"
        ? "verify"
        : "status";
const RESTORE_PLAN_MODE = SUBCOMMAND === "restore-plan";
const RESTORE_APPLY_MODE = SUBCOMMAND === "restore" && ARGV[1] === "apply";
const JSON_MODE = ARGV.includes("--json");
const REQUIRED_MODE = ARGV.includes("--required");
const VERIFIED_MODE = ARGV.includes("--verified");
const RESTORE_VERIFIED_MODE = ARGV.includes("--restore-verified");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops backup

Usage:
  pnpm --silent run ops:backup -- create --json
  pnpm --silent run ops:backup -- create --database artifacts/db.dump --verified --json
  pnpm --silent run ops:backup -- status --json
  pnpm --silent run ops:backup -- status --required --json
  pnpm run ops:backup -- list --brief --no-color
  pnpm --silent run ops:backup -- verify latest --json
  pnpm --silent run ops:backup -- verify <manifestId> --json
  pnpm --silent run ops:backup -- restore-plan [latest|manifestId] --json
  pnpm --silent run ops:backup -- restore apply [latest|manifestId] --json
  pnpm --silent run ops:backup -- restore apply [latest|manifestId] --execute --approve restore-apply --json
  nexpress ops backup create --json
  nexpress ops backup status --json
  nexpress ops backup verify latest --json
  nexpress ops backup restore-plan latest --json
  nexpress ops backup restore apply latest --execute --approve restore-apply --json

Options:
  --database <path>       Register a database artifact path inside the backup dir.
  --media <path>          Register a media artifact path inside the backup dir.
  --verified              Mark the created manifest as verified.
  --restore-verified      Mark the created manifest as restore-verified.
  --execute               Run restore apply. Without this, restore apply dry-runs.
  --approve <token>       Required with restore apply --execute: restore-apply.
  --out <path>            Write a restore apply JSON artifact to a specific path.
  --required              Treat missing/stale/unverified backups as blocked.
  --json                  Print the stable machine-readable backup report.
  --brief                 Print compact human output. This is the default.
  --no-color              Disable ANSI color in human-readable output.
  --help, -h              Show this help.
`);
}

function shouldPrintHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function invalidSubcommand(): boolean {
  if (SUBCOMMAND === "create" || SUBCOMMAND === "status" || SUBCOMMAND === "list") return false;
  if (SUBCOMMAND === "verify") return !readPositional(1);
  if (SUBCOMMAND === "restore-plan") return false;
  if (RESTORE_APPLY_MODE) return false;
  return true;
}

function readPositional(index: number): string | null {
  const positionals = ARGV.filter((arg) => !arg.startsWith("--"));
  return positionals[index] ?? null;
}

function readArgValue(name: string): string | null {
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
  if (invalidSubcommand()) {
    printHelp();
    process.exit(2);
  }

  if (RESTORE_PLAN_MODE) {
    const report = await collectOpsBackupRestorePlan({ manifestId: readPositional(1) ?? "latest" });
    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderBriefOpsBackupRestorePlan(report, { color: COLOR_MODE }));
    }
    process.exit(report.ok ? 0 : 1);
  }

  if (RESTORE_APPLY_MODE) {
    const report = await runOpsBackupRestoreApply({
      manifestId: readPositional(2) ?? "latest",
      execute: ARGV.includes("--execute"),
      approve: readArgValue("--approve"),
      out: readArgValue("--out"),
    });
    if (JSON_MODE) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderBriefOpsBackupRestoreApply(report, { color: COLOR_MODE }));
    }
    process.exit(report.ok ? 0 : 1);
  }

  const report =
    MODE === "create"
      ? await createOpsBackupManifest({
          databasePath: readArgValue("--database"),
          mediaPath: readArgValue("--media"),
          verified: VERIFIED_MODE,
          restoreVerified: RESTORE_VERIFIED_MODE,
        })
      : await collectOpsBackupReport({
          mode: MODE,
          required: REQUIRED_MODE,
          manifestId: MODE === "verify" ? (readPositional(1) ?? "latest") : null,
        });
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
