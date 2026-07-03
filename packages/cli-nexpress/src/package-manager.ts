import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type NpPackageManager = "pnpm" | "npm" | "yarn";
export type NpPackageManagerAction = "add" | "remove";

export interface NpPackageManagerOptions {
  localWorkspace?: boolean;
  workspaceRoot?: boolean;
}

export interface NpLocalPackageJson {
  name?: unknown;
  exports?: unknown;
  main?: unknown;
}

export type NpLocalWorkspacePackage =
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
    const packageSpec =
      action === "add" && options.localWorkspace ? `${packageName}@workspace:*` : packageName;
    return [
      action === "add" ? "add" : "remove",
      packageSpec,
      ...(options.workspaceRoot ? ["-w"] : []),
    ];
  }
  return [action === "add" ? "install" : "uninstall", packageName];
}

export function isPnpmWorkspaceRoot(cwd: string): boolean {
  return existsSync(resolve(cwd, "pnpm-workspace.yaml"));
}

function localPackageDirName(packageName: string): string {
  return packageName.replace(/^@[^/]+\//, "");
}

export function inspectLocalWorkspacePackage(
  cwd: string,
  packageName: string,
  packageRoots: string[],
): NpLocalWorkspacePackage {
  const expectedDirName = localPackageDirName(packageName);
  const expectedDirNames = new Set([expectedDirName, expectedDirName.replace(/^theme[-_]/, "")]);
  let malformedCandidate: Extract<NpLocalWorkspacePackage, { kind: "malformed" }> | null = null;

  for (const packageRoot of packageRoots) {
    const root = resolve(cwd, packageRoot);
    if (!existsSync(root)) continue;

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = resolve(root, entry.name, "package.json");
      if (!existsSync(packageJsonPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as NpLocalPackageJson;
        if (pkg.name === packageName) {
          return {
            kind: "found",
            dir: resolve(root, entry.name),
            packageJsonPath,
            packageJson: pkg,
          };
        }
      } catch {
        if (expectedDirNames.has(entry.name)) {
          malformedCandidate = {
            kind: "malformed",
            dir: resolve(root, entry.name),
            packageJsonPath,
            errorMessage: "package.json is not valid JSON",
          };
        }
      }
    }
  }

  return malformedCandidate ?? { kind: "missing" };
}

export function findLocalWorkspacePackageDir(
  cwd: string,
  packageName: string,
  packageRoots: string[],
): string | null {
  const result = inspectLocalWorkspacePackage(cwd, packageName, packageRoots);
  return result.kind === "found" ? result.dir : null;
}

function addDistEntrypoint(value: unknown, paths: Set<string>): void {
  if (typeof value !== "string") return;
  if (!value.startsWith("./dist/")) return;
  paths.add(value);
}

export function missingLocalPackageBuildArtifacts(
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
