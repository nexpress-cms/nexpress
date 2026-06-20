import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type NpPackageManager = "pnpm" | "npm" | "yarn";
export type NpPackageManagerAction = "add" | "remove";

export interface NpPackageManagerOptions {
  localWorkspace?: boolean;
}

export function buildPackageManagerArgs(
  manager: NpPackageManager,
  action: NpPackageManagerAction,
  packageName: string,
  options: NpPackageManagerOptions = {},
): string[] {
  if (manager === "yarn") return [action === "add" ? "add" : "remove", packageName];
  if (manager === "pnpm") {
    return [
      action === "add" ? "add" : "remove",
      packageName,
      ...(action === "add" && options.localWorkspace ? ["--workspace"] : []),
    ];
  }
  return [action === "add" ? "install" : "uninstall", packageName];
}

export function findLocalPluginWorkspaceDir(cwd: string, packageName: string): string | null {
  const pluginsRoot = resolve(cwd, "packages/plugins");
  if (!existsSync(pluginsRoot)) return null;

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = resolve(pluginsRoot, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
      if (pkg.name === packageName) return resolve(pluginsRoot, entry.name);
    } catch {
      // Ignore malformed local packages; pnpm will surface a better error
      // if the operator tries to install that package directly.
    }
  }

  return null;
}
