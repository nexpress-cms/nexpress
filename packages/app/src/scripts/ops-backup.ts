// Must be first so .env is available before backup checks run.
import "./_load-env.js";

import {
  collectOpsBackupReport,
  createOpsBackupManifest,
  renderBriefOpsBackupReport,
  type OpsBackupMode,
} from "./ops-backup-core.js";

const RAW_ARGV = process.argv.slice(2);
const ARGV = RAW_ARGV[0] === "--" ? RAW_ARGV.slice(1) : RAW_ARGV;
const SUBCOMMAND = ARGV[0] && !ARGV[0].startsWith("--") ? ARGV[0] : "status";
const MODE: OpsBackupMode =
  SUBCOMMAND === "create"
    ? "create"
    : SUBCOMMAND === "list"
      ? "list"
      : SUBCOMMAND === "verify"
        ? "verify"
        : "status";
const JSON_MODE = ARGV.includes("--json");
const REQUIRED_MODE = ARGV.includes("--required");
const VERIFIED_MODE = ARGV.includes("--verified");
const RESTORE_VERIFIED_MODE = ARGV.includes("--restore-verified");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function printHelp(): void {
  console.log(`NexPress ops backup

Usage:
  pnpm run ops:backup -- create --json
  pnpm run ops:backup -- create --database artifacts/db.dump --verified --json
  pnpm run ops:backup -- status --json
  pnpm run ops:backup -- status --required --json
  pnpm run ops:backup -- list --brief --no-color
  pnpm run ops:backup -- verify latest --json
  nexpress ops backup create --json
  nexpress ops backup status --json
  nexpress ops backup verify latest --json

Options:
  --database <path>       Register a database artifact path inside the backup dir.
  --media <path>          Register a media artifact path inside the backup dir.
  --verified              Mark the created manifest as verified.
  --restore-verified      Mark the created manifest as restore-verified.
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
  if (SUBCOMMAND === "verify") return ARGV[1] !== "latest";
  return true;
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

  const report =
    MODE === "create"
      ? await createOpsBackupManifest({
          databasePath: readArgValue("--database"),
          mediaPath: readArgValue("--media"),
          verified: VERIFIED_MODE,
          restoreVerified: RESTORE_VERIFIED_MODE,
        })
      : await collectOpsBackupReport({ mode: MODE, required: REQUIRED_MODE });
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
