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

export function pluginRemoveCommand(manager: NpPackageManager, packageName: string): string {
  if (manager === "pnpm") return `pnpm exec nexpress plugin remove ${packageName}`;
  if (manager === "yarn") return `yarn nexpress plugin remove ${packageName}`;
  return `npx nexpress plugin remove ${packageName}`;
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

export function formatPluginPostRemoveGuidance(manager: NpPackageManager): string {
  return [
    `  Next:`,
    `    1. Restart your dev server or redeploy so boot-time plugin code unloads.`,
    `    2. Verify plugin contracts:`,
    `       ${pluginDoctorCommand(manager)}`,
    `    3. If the plugin still appears after restart:`,
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

export function formatPluginManualRemoveGuidance(args: {
  manager: NpPackageManager;
  packageName: string;
}): string {
  return [
    `  Next:`,
    `    1. Remove the config snippet above from nexpress.config.ts.`,
    `    2. Restart your dev server or redeploy so boot-time plugin code unloads.`,
    `    3. Verify plugin contracts:`,
    `       ${pluginDoctorCommand(args.manager)}`,
    `  Tip: marker-aware projects can remove plugins with ${pluginRemoveCommand(
      args.manager,
      args.packageName,
    )}.`,
  ].join("\n");
}
