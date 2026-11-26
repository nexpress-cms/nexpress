import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn";

export function detectPackageManager(cwd: string): PackageManager {
  let current = cwd;
  while (true) {
    if (existsSync(resolve(current, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(resolve(current, "yarn.lock"))) return "yarn";
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "npm";
}

export function runArgs(manager: PackageManager, script: string, passthrough: string[]): string[] {
  if (manager === "yarn") return [script, ...passthrough];
  if (passthrough.includes("--json")) return ["--silent", "run", script, "--", ...passthrough];
  return ["run", script, "--", ...passthrough];
}

export function commandText(manager: PackageManager, args: string[]): string {
  return `${manager} ${args.join(" ")}`;
}
