import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  addPluginToConfig,
  buildManualSnippet,
  packageToIdentifier,
  removePluginFromConfig,
  type PluginEntry,
} from "./config-editor.js";

const HELP_TEXT = `nexpress — project-side CLI

Usage:
  nexpress plugin add <package>      Install a plugin and register it in nexpress.config.ts
  nexpress plugin remove <package>   Uninstall a plugin and unregister it
  nexpress --help                    Show this message

Notes:
  - Run from the project root (where nexpress.config.ts lives).
  - The config file must include marker comments for automated edits:
      // @nexpress:plugins-imports-start
      // @nexpress:plugins-imports-end
      // @nexpress:plugins-list-start
      // @nexpress:plugins-list-end
    Without them the CLI prints the snippet to paste manually.
`;

interface ResolvedProject {
  configPath: string;
  packageManager: "pnpm" | "npm" | "yarn";
}

/**
 * Resolves the project root by looking for nexpress.config.ts in `cwd`,
 * `cwd/src`, and a couple of conventional places. Returns the path that
 * exists; throws when none does so the operator gets a clear error
 * instead of "config file not found at <relative path>" later.
 */
function resolveConfigPath(cwd: string): string {
  const candidates = [
    "nexpress.config.ts",
    "src/nexpress.config.ts",
    "apps/web/src/nexpress.config.ts",
  ];
  for (const candidate of candidates) {
    const full = resolve(cwd, candidate);
    if (existsSync(full)) return full;
  }
  throw new Error(
    `Could not find nexpress.config.ts. Looked at:\n  - ${candidates.join("\n  - ")}\nRun this from your project root.`,
  );
}

function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function resolveProject(cwd: string): ResolvedProject {
  return {
    configPath: resolveConfigPath(cwd),
    packageManager: detectPackageManager(cwd),
  };
}

function runPackageManager(
  manager: "pnpm" | "npm" | "yarn",
  action: "add" | "remove",
  packageName: string,
  cwd: string,
): Promise<void> {
  const args =
    manager === "yarn"
      ? [action === "add" ? "add" : "remove", packageName]
      : manager === "pnpm"
        ? [action === "add" ? "add" : "remove", packageName]
        : [action === "add" ? "install" : "uninstall", packageName];
  return new Promise((resolveFn, reject) => {
    const child = spawn(manager, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveFn();
      else reject(new Error(`${manager} ${args.join(" ")} exited with code ${code ?? "null"}`));
    });
  });
}

async function readConfig(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

async function writeConfig(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8");
}

async function pluginAdd(packageName: string, cwd: string): Promise<number> {
  const entry: PluginEntry = {
    packageName,
    identifier: packageToIdentifier(packageName),
  };
  const project = resolveProject(cwd);

  process.stdout.write(`\n→ Installing ${packageName} via ${project.packageManager}…\n`);
  await runPackageManager(project.packageManager, "add", packageName, cwd);

  const original = await readConfig(project.configPath);
  const result = addPluginToConfig(original, entry);

  if (result.kind === "ok") {
    await writeConfig(project.configPath, result.content);
    process.stdout.write(
      `✓ Registered ${entry.identifier} in ${project.configPath}\n` +
        `  Restart the dev server (or run \`nexpress plugins reload\` from the admin) to load it.\n`,
    );
    return 0;
  }
  if (result.kind === "no-op") {
    process.stdout.write(
      `· Package installed; ${result.reason}. No config change needed.\n`,
    );
    return 0;
  }

  // no-markers branch — print the manual snippet so the operator finishes by hand.
  process.stdout.write(
    `\n⚠ ${project.configPath} doesn't have plugin markers. Add this manually:\n\n${buildManualSnippet(
      entry,
    )}\n\nThen restart the dev server.\n`,
  );
  return 1;
}

async function pluginRemove(packageName: string, cwd: string): Promise<number> {
  const entry: PluginEntry = {
    packageName,
    identifier: packageToIdentifier(packageName),
  };
  const project = resolveProject(cwd);

  // Strip the config first so a failed npm step doesn't leave the user with
  // a "ghost" registration referencing an uninstalled package.
  const original = await readConfig(project.configPath);
  const result = removePluginFromConfig(original, entry);
  if (result.kind === "ok") {
    await writeConfig(project.configPath, result.content);
    process.stdout.write(`✓ Unregistered ${entry.identifier} from ${project.configPath}\n`);
  } else if (result.kind === "no-op") {
    process.stdout.write(`· ${result.reason}; nothing to update in config.\n`);
  } else {
    process.stdout.write(
      `\n⚠ ${project.configPath} doesn't have plugin markers; remove the import + list entry manually.\n`,
    );
  }

  process.stdout.write(`\n→ Uninstalling ${packageName} via ${project.packageManager}…\n`);
  await runPackageManager(project.packageManager, "remove", packageName, cwd);
  process.stdout.write(`✓ Removed ${packageName}.\n`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [, , ...args] = argv;
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args[0] === "plugin") {
    const sub = args[1];
    const target = args[2];
    if (!sub || !target) {
      process.stderr.write(
        `Missing arguments. Usage: nexpress plugin add|remove <package>\n`,
      );
      return 2;
    }
    const cwd = process.cwd();
    if (sub === "add") return pluginAdd(target, cwd);
    if (sub === "remove") return pluginRemove(target, cwd);
    process.stderr.write(`Unknown subcommand: plugin ${sub}\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${args[0] ?? ""}\n${HELP_TEXT}`);
  return 2;
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nnexpress: ${message}\n`);
    process.exit(1);
  });
