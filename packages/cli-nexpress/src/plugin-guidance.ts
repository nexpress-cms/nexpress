import { buildRunScriptArgs } from "./ops-command.js";
import type { NpPackageManager } from "./package-manager.js";

export function formatProjectScriptCommand(
  manager: NpPackageManager,
  script: string,
  passthrough: string[],
): string {
  return [manager, ...buildRunScriptArgs(manager, script, passthrough)].join(" ");
}

export function pluginDoctorCommand(manager: NpPackageManager): string {
  return formatProjectScriptCommand(manager, "ops:plugins", ["doctor", "--json"]);
}

export function pluginListCommand(manager: NpPackageManager): string {
  return formatProjectScriptCommand(manager, "ops:plugins", ["list", "--json"]);
}

export function pluginAddCommand(manager: NpPackageManager, packageName: string): string {
  if (manager === "pnpm") return `pnpm exec nexpress plugin add ${packageName}`;
  if (manager === "yarn") return `yarn nexpress plugin add ${packageName}`;
  return `npx nexpress plugin add ${packageName}`;
}

export function formatPluginPostInstallGuidance(manager: NpPackageManager): string {
  return [
    `  Next:`,
    `    1. Restart your dev server or redeploy so boot-time plugin code loads.`,
    `    2. Verify plugin contracts:`,
    `       ${pluginDoctorCommand(manager)}`,
    `    3. If the plugin is not listed after restart:`,
    `       ${pluginListCommand(manager)}`,
  ].join("\n");
}

export function formatPluginManualConfigGuidance(args: {
  manager: NpPackageManager;
  packageName: string;
}): string {
  return [
    `  Next:`,
    `    1. Add the marker block or paste the manual config snippet above.`,
    `    2. Re-run: ${pluginAddCommand(args.manager, args.packageName)}`,
    `    3. After it registers, verify plugin contracts:`,
    `       ${pluginDoctorCommand(args.manager)}`,
  ].join("\n");
}
