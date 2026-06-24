// Must be first so .env is available before plugin config imports run.
import "./_load-env.js";

import {
  buildOpsPluginInspectJson,
  buildOpsPluginsUpgradePlanJson,
  collectOpsPluginsStatus,
  renderBriefOpsPluginsMutation,
  renderBriefOpsPluginsStatus,
  renderBriefOpsPluginsUpgradePlan,
  runOpsPluginsMutation,
} from "./ops-plugins-core.js";

const ARGV = process.argv.slice(2);
const COMMAND = ARGV.find((arg) => !arg.startsWith("--")) ?? "doctor";
const JSON_MODE = ARGV.includes("--json");
const COLOR_MODE = !JSON_MODE && !ARGV.includes("--no-color") && !process.env.NO_COLOR;

function positionalArgs(): string[] {
  return ARGV.filter((arg) => !arg.startsWith("--"));
}

function printHelp(): void {
  console.log(`NexPress ops plugins

Usage:
  pnpm run ops:plugins -- list
  pnpm --silent run ops:plugins -- inspect <pluginId> --json
  pnpm --silent run ops:plugins -- doctor --json
  pnpm --silent run ops:plugins -- upgrade-plan [pluginId] --json
  pnpm --silent run ops:plugins -- disable <pluginId> --execute --approve plugin-disable --json
  pnpm --silent run ops:plugins -- enable <pluginId> --execute --approve plugin-enable --json
  nexpress ops plugins list --json
  nexpress ops plugins inspect <pluginId> --json
  nexpress ops plugins doctor --json
  nexpress ops plugins upgrade-plan [pluginId] --json
  nexpress ops plugins disable <pluginId> --execute --approve plugin-disable --json
  nexpress ops plugins enable <pluginId> --execute --approve plugin-enable --json

Options:
  --execute    Apply enable/disable. Without this, mutation commands dry-run.
  --approve    Required with --execute: plugin-enable or plugin-disable.
  --out <path> Write a JSON artifact to a specific path.
  --json       Print the stable machine-readable plugin report.
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

  const report = await collectOpsPluginsStatus();
  const positionals = positionalArgs();
  if (COMMAND === "enable" || COMMAND === "disable") {
    const pluginId = positionals[1];
    if (!pluginId) throw new Error(`Usage: nexpress ops plugins ${COMMAND} <pluginId> [--json]`);
    const mutationReport = await runOpsPluginsMutation({
      action: COMMAND,
      pluginId,
      execute: ARGV.includes("--execute"),
      approve: readStringArg("--approve"),
      out: readStringArg("--out"),
    });
    if (JSON_MODE) {
      console.log(JSON.stringify(mutationReport, null, 2));
    } else {
      console.log(renderBriefOpsPluginsMutation(mutationReport, { color: COLOR_MODE }));
    }
    process.exit(mutationReport.ok ? 0 : 1);
  }

  if (COMMAND === "inspect") {
    const pluginId = positionals[1];
    if (!pluginId) throw new Error("Usage: nexpress ops plugins inspect <pluginId> [--json]");
    const inspectReport = buildOpsPluginInspectJson(report, pluginId);
    if (JSON_MODE) {
      console.log(JSON.stringify(inspectReport, null, 2));
    } else {
      console.log(renderBriefOpsPluginsStatus(inspectReport, "inspect", { color: COLOR_MODE }));
    }
    process.exit(inspectReport.ok ? 0 : 1);
  }

  if (COMMAND === "upgrade-plan") {
    const pluginId = positionals[1] ?? null;
    const upgradePlan = buildOpsPluginsUpgradePlanJson({ report, pluginId });
    if (JSON_MODE) {
      console.log(JSON.stringify(upgradePlan, null, 2));
    } else {
      console.log(renderBriefOpsPluginsUpgradePlan(upgradePlan, { color: COLOR_MODE }));
    }
    process.exit(upgradePlan.ok ? 0 : 1);
  }

  if (COMMAND !== "list" && COMMAND !== "doctor") {
    throw new Error(`Unknown ops plugins command: ${COMMAND}`);
  }

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderBriefOpsPluginsStatus(report, COMMAND, { color: COLOR_MODE }));
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
