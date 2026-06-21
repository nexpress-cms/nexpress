import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type NpPackageManager = "pnpm" | "npm" | "yarn";
export type NpPackageManagerAction = "add" | "remove";

export interface NpPackageManagerOptions {
  localWorkspace?: boolean;
}

export interface NpLocalPackageJson {
  name?: unknown;
  exports?: unknown;
  main?: unknown;
}

export type NpLocalPluginWorkspace =
  | {
      kind: "found";
      dir: string;
      packageJsonPath: string;
      packageJson: NpLocalPackageJson;
    }
  | {
      kind: "malformed";
      dir: string;
      packageJsonPath: string;
      errorMessage: string;
    }
  | { kind: "missing" };

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

function localPluginDirName(packageName: string): string {
  return packageName.replace(/^@[^/]+\//, "");
}

export function inspectLocalPluginWorkspace(
  cwd: string,
  packageName: string,
): NpLocalPluginWorkspace {
  const pluginsRoot = resolve(cwd, "packages/plugins");
  if (!existsSync(pluginsRoot)) return { kind: "missing" };

  const expectedDirName = localPluginDirName(packageName);
  let malformedCandidate: Extract<NpLocalPluginWorkspace, { kind: "malformed" }> | null = null;

  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = resolve(pluginsRoot, entry.name, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as NpLocalPackageJson;
      if (pkg.name === packageName) {
        return {
          kind: "found",
          dir: resolve(pluginsRoot, entry.name),
          packageJsonPath,
          packageJson: pkg,
        };
      }
    } catch {
      if (entry.name === expectedDirName) {
        malformedCandidate = {
          kind: "malformed",
          dir: resolve(pluginsRoot, entry.name),
          packageJsonPath,
          errorMessage: "package.json is not valid JSON",
        };
      }
    }
  }

  return malformedCandidate ?? { kind: "missing" };
}

export function findLocalPluginWorkspaceDir(cwd: string, packageName: string): string | null {
  const result = inspectLocalPluginWorkspace(cwd, packageName);
  return result.kind === "found" ? result.dir : null;
}

function addDistEntrypoint(value: unknown, paths: Set<string>): void {
  if (typeof value !== "string") return;
  if (!value.startsWith("./dist/")) return;
  paths.add(value);
}

export function missingLocalPluginBuildArtifacts(
  packageDir: string,
  packageJson: NpLocalPackageJson,
): string[] {
  const paths = new Set<string>();
  const exportsBlock = packageJson.exports;

  if (exportsBlock && typeof exportsBlock === "object") {
    const dotExport = (exportsBlock as Record<string, unknown>)["."];
    if (typeof dotExport === "string") {
      addDistEntrypoint(dotExport, paths);
    } else if (dotExport && typeof dotExport === "object") {
      addDistEntrypoint((dotExport as Record<string, unknown>).import, paths);
    }
  }

  if (paths.size === 0) addDistEntrypoint(packageJson.main, paths);

  return [...paths].filter((path) => !existsSync(resolve(packageDir, path)));
}
