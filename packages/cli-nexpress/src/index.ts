import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
  addPluginToConfig,
  buildManualSnippet,
  packageToIdentifier,
  removePluginFromConfig,
  type PluginEntry,
} from "./config-editor.js";
import { scaffoldBlockPlugin } from "./scaffold-block-plugin.js";
import {
  scaffoldAdminPlugin,
  scaffoldHookPlugin,
  scaffoldRoutePlugin,
  scaffoldScheduledPlugin,
} from "./scaffold-plugin-types.js";
import { packageNameFromSlug, resolveScaffoldDependencyRanges } from "./scaffold-utils.js";
import type { ScaffoldKind, ScaffoldResult } from "./scaffold-utils.js";
import { buildRunScriptArgs, resolveOpsScriptInvocation } from "./ops-command.js";
import {
  formatPluginManualConfigGuidance,
  formatPluginPostInstallGuidance,
} from "./plugin-guidance.js";
import {
  buildPackageManagerArgs,
  inspectLocalPluginWorkspace,
  missingLocalPluginBuildArtifacts,
  type NpPackageManager,
  type NpPackageManagerOptions,
} from "./package-manager.js";
import { runThemeAdd } from "./theme-add/run.js";
import { runThemeUninstall } from "./theme-uninstall/run.js";

const HELP_TEXT = `nexpress — project-side CLI

Usage:
  nexpress plugin add <package>                       Install a plugin and register it
  nexpress plugin remove <package>                    Uninstall a plugin and unregister it
  nexpress theme add <package>                        Install a theme and register it in nexpress.config.ts
  nexpress theme add <package> --dry-run              Same, but print the plan and exit without mutating
  nexpress theme add <package> --yes                  Same, but skip the interactive confirm prompt
  nexpress theme add <package> --apply                Same, but chain db:generate + db:migrate after registration
  nexpress theme:uninstall <package>                  Uninstall: AST-remove fields the theme contributed
  nexpress theme:uninstall <package> --dry-run        Same, but print the plan and exit without mutating
  nexpress theme:uninstall <package> --yes            Same, but skip the destructive confirm prompt
  nexpress theme:uninstall <package> --with-collections  Also delete collection FILES that match the theme's spec exactly
  nexpress theme:uninstall <package> --apply          Same, but auto-chain db:migrate after generate (DROP COLUMN runs)
  nexpress deploy plan --target <host> [--json]       Print a deployment bridge plan
  nexpress ops status [--json|--brief|--no-color]     Print read-only runtime status for operators and agents
  nexpress ops contracts [--json|--brief]             Print the shipped local ops contract registry
  nexpress ops doctor [--prod|--json|--fix-plan]      Run the project doctor through the ops namespace
  nexpress ops preflight --target <host> [--json]     Run deploy-plan + production doctor as one gate
  nexpress ops health [--url <origin>] [--json]       Probe /api/health/ready on a running site
  nexpress ops backup status [--json|--brief]         Report backup manifest freshness and verification
  nexpress ops backup create [--json|--brief]         Register a backup manifest
  nexpress ops backup verify latest [--json|--brief]  Verify latest backup manifest artifact presence
  nexpress ops backup restore-plan latest [--json]    Print a read-only restore drill plan
  nexpress ops jobs status [--json|--brief]           Report worker heartbeat and queue counts
  nexpress ops jobs pause|resume [--json|--brief]     Pause or resume job processing
  nexpress ops jobs retry-all|drain [--json]          Dry-run or approval-gate bounded queue actions
  nexpress ops migrate status [--json|--brief]        Report local vs applied migrations
  nexpress ops migrate plan [--json|--brief]          Plan migration safety and destructive SQL risk
  nexpress ops migrate rollback-plan [--json]         Print a read-only rollback handoff
  nexpress ops storage status [--json|--brief]        Report storage adapter and media file drift
  nexpress ops storage verify|missing-files|orphaned-files [--json]  Inspect media drift
  nexpress ops storage migrate plan --target s3       Print a read-only local-to-S3 migration plan
  nexpress ops plugins list [--json|--brief]          List configured plugins
  nexpress ops plugins doctor [--json|--brief]        Report plugin ID/block/route conflicts
  nexpress ops plugins inspect|upgrade-plan [id]      Inspect plugin details or upgrade plans
  nexpress release check [--target <host>] [--json]   Run the pre-release readiness gate
  nexpress release plan [--target <host>] [--json]    Persist a release plan artifact
  nexpress release apply --plan <path> [--json]       Validate or execute a release plan
  nexpress release verify [--url <origin>] [--json]   Run the post-release readiness gate
  nexpress runbook <name> [--json|--brief]            Diagnose a common incident runbook
  nexpress create block-plugin <slug> [--workspace|--out <dir>]  Scaffold a static block plugin
  nexpress create block-plugin <slug> --interactive              Scaffold with a "use client" form
  nexpress create hook-plugin <slug> [--workspace|--out <dir>]   Scaffold a content-hook plugin
  nexpress create route-plugin <slug> [--workspace|--out <dir>]  Scaffold an API-route plugin
  nexpress create admin-plugin <slug> [--workspace|--out <dir>]  Scaffold an admin-extension plugin
  nexpress create scheduled-plugin <slug> [--workspace|--out <dir>] Scaffold a scheduled-task plugin

Notes:
  - "plugin add/remove" and "theme add" run from the project root (where
    nexpress.config.ts lives).
  - "theme add" only registers the theme. The framework auto-merges the
    theme's manifest.requires.collections into your \`collections\` array at
    config-resolution time, so a follow-up \`pnpm db:generate && pnpm
    db:migrate\` (or \`--apply\` here) is all you need to materialise
    theme-declared columns. No more AST patches to your collection files.
  - "create *-plugin" writes a starter package to the current directory by
    default. From a project root, use --workspace to write packages/plugins/<slug>
    or --out <dir> for an explicit destination. Then run pnpm install +
    pnpm --filter <packageName> build before registering with "nexpress plugin add".
  - --interactive (block kind only) emits a second client entry with the boundary
    wiring (splitting off, self-import external, DOM lib) pre-configured.
  - The config file must include marker comments for automated edits:
      // @nexpress:plugins-imports-start         // @nexpress:themes-imports-start
      // @nexpress:plugins-imports-end           // @nexpress:themes-imports-end
      // @nexpress:plugins-list-start            // @nexpress:themes-list-start
      // @nexpress:plugins-list-end              // @nexpress:themes-list-end
    Without them the CLI prints the snippet to paste manually.
`;

interface ResolvedProject {
  configPath: string;
  packageManager: NpPackageManager;
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

function detectPackageManager(cwd: string): NpPackageManager {
  let current = cwd;
  while (true) {
    if (existsSync(resolve(current, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(resolve(current, "yarn.lock"))) return "yarn";
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
          packageManager?: unknown;
        };
        if (typeof pkg.packageManager === "string") {
          if (pkg.packageManager.startsWith("pnpm@")) return "pnpm";
          if (pkg.packageManager.startsWith("yarn@")) return "yarn";
        }
      } catch {
        // Ignore malformed package.json files here; the command-specific
        // package manager call will surface the actionable failure.
      }
    }
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return "pnpm";
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "npm";
}

function resolveProject(cwd: string): ResolvedProject {
  return {
    configPath: resolveConfigPath(cwd),
    packageManager: detectPackageManager(cwd),
  };
}

function runPackageManager(
  manager: NpPackageManager,
  action: "add" | "remove",
  packageName: string,
  cwd: string,
  options: NpPackageManagerOptions = {},
): Promise<void> {
  const args = buildPackageManagerArgs(manager, action, packageName, options);
  return new Promise((resolveFn, reject) => {
    const child = spawn(manager, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveFn();
      else reject(new Error(`${manager} ${args.join(" ")} exited with code ${code ?? "null"}`));
    });
  });
}

function formatPackageManagerCommand(
  manager: NpPackageManager,
  action: "add" | "remove",
  packageName: string,
  options: NpPackageManagerOptions = {},
): string {
  return [manager, ...buildPackageManagerArgs(manager, action, packageName, options)].join(" ");
}

function runProjectScript(
  manager: NpPackageManager,
  script: string,
  passthrough: string[],
  cwd: string,
): Promise<void> {
  const args = buildRunScriptArgs(manager, script, passthrough);
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

  // Validate the config edit BEFORE running the package manager. If the
  // operator's nexpress.config.ts doesn't have markers, we'd rather bail
  // with a clear error than leave them with a half-installed state where
  // the package is on disk but the framework doesn't know about it.
  const original = await readConfig(project.configPath);
  const dryRun = addPluginToConfig(original, entry);
  if (dryRun.kind === "no-markers") {
    process.stdout.write(
      `\n⚠ ${project.configPath} doesn't have plugin markers, so I won't run "${formatPackageManagerCommand(
        project.packageManager,
        "add",
        packageName,
      )}" yet.\n` +
        `  Add the markers below to your config (or paste the snippet directly), then re-run.\n\n` +
        `${buildManualSnippet(entry)}\n\n` +
        `Marker template:\n` +
        `  // @nexpress:plugins-imports-start\n` +
        `  // @nexpress:plugins-imports-end\n` +
        `  // @nexpress:plugins-list-start\n` +
        `  // @nexpress:plugins-list-end\n\n` +
        `${formatPluginManualConfigGuidance({
          manager: project.packageManager,
          packageName,
        })}\n`,
    );
    return 1;
  }

  const localWorkspace =
    project.packageManager === "pnpm"
      ? inspectLocalPluginWorkspace(cwd, packageName)
      : ({ kind: "missing" } as const);

  if (localWorkspace.kind === "malformed") {
    process.stdout.write(
      `\n⚠ Found a local plugin candidate at ${relative(cwd, localWorkspace.dir)}, but ${relative(
        cwd,
        localWorkspace.packageJsonPath,
      )} is not valid JSON.\n` +
        `  Fix that package.json, then re-run pnpm exec nexpress plugin add ${packageName}.\n`,
    );
    return 1;
  }

  if (localWorkspace.kind === "found") {
    const missingArtifacts = missingLocalPluginBuildArtifacts(
      localWorkspace.dir,
      localWorkspace.packageJson,
    );
    if (missingArtifacts.length > 0) {
      process.stdout.write(
        `\n⚠ Found local workspace package at ${relative(cwd, localWorkspace.dir)}, but build output is missing:\n` +
          missingArtifacts
            .map((path) => `  - ${relative(cwd, resolve(localWorkspace.dir, path))}\n`)
            .join("") +
          `\nRun pnpm --filter ${packageName} build, then re-run pnpm exec nexpress plugin add ${packageName}.\n`,
      );
      return 1;
    }
  }

  process.stdout.write(`\n→ Installing ${packageName} via ${project.packageManager}…\n`);
  if (localWorkspace.kind === "found") {
    process.stdout.write(
      `  Detected local workspace package at ${relative(cwd, localWorkspace.dir)}; using pnpm --workspace.\n`,
    );
  }
  await runPackageManager(project.packageManager, "add", packageName, cwd, {
    localWorkspace: localWorkspace.kind === "found",
  });
  process.stdout.write(`✓ Installed ${packageName}.\n`);

  // Re-read after install — formatters / lockfile updates rarely touch the
  // config, but if anything did the dry-run is no longer authoritative.
  const afterInstall = await readConfig(project.configPath);
  const result = addPluginToConfig(afterInstall, entry);

  if (result.kind === "ok") {
    await writeConfig(project.configPath, result.content);
    process.stdout.write(
      `✓ Registered ${entry.identifier} in ${project.configPath}\n` +
        `${formatPluginPostInstallGuidance(project.packageManager)}\n`,
    );
    return 0;
  }
  if (result.kind === "no-op") {
    process.stdout.write(
      `· Package installed; ${result.reason}. No config change needed.\n` +
        `${formatPluginPostInstallGuidance(project.packageManager)}\n`,
    );
    return 0;
  }

  // The dry-run passed but the post-install read changed shape. Tell the
  // operator what to paste so they can finish the registration by hand.
  process.stdout.write(
    `\n⚠ ${project.configPath} changed during install and no longer has plugin markers. Add this manually:\n\n${buildManualSnippet(
      entry,
    )}\n\n${formatPluginManualConfigGuidance({
      manager: project.packageManager,
      packageName,
    })}\n`,
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

  if (args[0] === "theme") {
    // `nexpress theme add <pkg> [flags]` — the only theme
    // subcommand for now. `theme:install` was retired in this
    // release (the framework auto-merges theme requirements at
    // config-resolution time, so the AST-patch path is gone).
    const sub = args[1];
    if (sub === "add") {
      let themePackage: string | undefined;
      let dryRun = false;
      let yes = false;
      let apply = false;
      for (const arg of args.slice(2)) {
        if (arg === "--dry-run") dryRun = true;
        else if (arg === "--yes" || arg === "-y") yes = true;
        else if (arg === "--apply") apply = true;
        else if (arg.startsWith("--")) {
          process.stderr.write(`Unknown flag for theme add: ${arg}\n`);
          return 2;
        } else if (themePackage === undefined) {
          themePackage = arg;
        } else {
          process.stderr.write(`Unexpected positional: ${arg}\n`);
          return 2;
        }
      }
      if (!themePackage) {
        process.stderr.write(
          `theme add requires a theme package name. Example: nexpress theme add @nexpress/theme-magazine\n`,
        );
        return 2;
      }
      return runThemeAdd({ themePackage, flags: { dryRun, yes, apply } });
    }
    process.stderr.write(`Unknown subcommand: theme ${sub ?? ""}\n${HELP_TEXT}`);
    return 2;
  }

  if (args[0] === "theme:uninstall") {
    let themePackage: string | undefined;
    let dryRun = false;
    let yes = false;
    let withCollections = false;
    let apply = false;
    for (const arg of args.slice(1)) {
      if (arg === "--dry-run") dryRun = true;
      else if (arg === "--yes" || arg === "-y") yes = true;
      else if (arg === "--with-collections") withCollections = true;
      else if (arg === "--apply") apply = true;
      else if (arg.startsWith("--")) {
        process.stderr.write(`Unknown flag for theme:uninstall: ${arg}\n`);
        return 2;
      } else if (themePackage === undefined) {
        themePackage = arg;
      } else {
        process.stderr.write(`Unexpected positional: ${arg}\n`);
        return 2;
      }
    }
    if (!themePackage) {
      process.stderr.write(
        `theme:uninstall requires a theme package name. Example: nexpress theme:uninstall @nexpress/theme-magazine\n`,
      );
      return 2;
    }
    return runThemeUninstall({
      themePackage,
      flags: { dryRun, yes, withCollections, apply },
    });
  }

  if (args[0] === "ops") {
    const sub = args[1];
    const invocation = resolveOpsScriptInvocation(sub, args.slice(2));
    if (invocation) {
      const cwd = process.cwd();
      const manager = detectPackageManager(cwd);
      await runProjectScript(manager, invocation.script, invocation.args, cwd);
      return 0;
    }
    process.stderr.write(`Unknown subcommand: ops ${sub ?? ""}\n${HELP_TEXT}`);
    return 2;
  }

  if (args[0] === "deploy") {
    const sub = args[1];
    if (sub === "plan") {
      const cwd = process.cwd();
      const manager = detectPackageManager(cwd);
      await runProjectScript(manager, "deploy:plan", args.slice(2), cwd);
      return 0;
    }
    process.stderr.write(`Unknown subcommand: deploy ${sub ?? ""}\n${HELP_TEXT}`);
    return 2;
  }

  if (args[0] === "release") {
    const sub = args[1];
    if (sub === "apply" || sub === "check" || sub === "plan" || sub === "verify") {
      const cwd = process.cwd();
      const manager = detectPackageManager(cwd);
      await runProjectScript(manager, "release", args.slice(1), cwd);
      return 0;
    }
    process.stderr.write(`Unknown subcommand: release ${sub ?? ""}\n${HELP_TEXT}`);
    return 2;
  }

  if (args[0] === "runbook") {
    const runbook = args[1];
    if (runbook) {
      const cwd = process.cwd();
      const manager = detectPackageManager(cwd);
      await runProjectScript(manager, "runbook", args.slice(1), cwd);
      return 0;
    }
    process.stderr.write(`Missing runbook name.\n${HELP_TEXT}`);
    return 2;
  }

  if (args[0] === "plugin") {
    const sub = args[1];
    const target = args[2];
    if (!sub || !target) {
      process.stderr.write(`Missing arguments. Usage: nexpress plugin add|remove <package>\n`);
      return 2;
    }
    const cwd = process.cwd();
    if (sub === "add") return pluginAdd(target, cwd);
    if (sub === "remove") return pluginRemove(target, cwd);
    process.stderr.write(`Unknown subcommand: plugin ${sub}\n`);
    return 2;
  }

  if (args[0] === "create") {
    const sub = args[1];
    const positional: string[] = [];
    const flags = new Set<string>();
    let outDirArg: string | undefined;

    for (let i = 2; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--interactive" || arg === "--workspace") {
        flags.add(arg);
      } else if (arg === "--out") {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          process.stderr.write(`--out requires a directory. Example: --out packages/plugins\n`);
          return 2;
        }
        outDirArg = value;
        i += 1;
      } else if (arg.startsWith("--out=")) {
        const value = arg.slice("--out=".length);
        if (!value) {
          process.stderr.write(`--out requires a directory. Example: --out packages/plugins\n`);
          return 2;
        }
        outDirArg = value;
      } else if (arg.startsWith("--")) {
        process.stderr.write(`Unknown flag for create ${sub ?? ""}: ${arg}\n`);
        return 2;
      } else {
        positional.push(arg);
      }
    }
    const slug = positional[0];

    // sub-command → kind + label. Adding a new plugin kind = one row here
    // and one new generator function in `scaffold-plugin-types.ts`.
    const kindMap: Record<
      string,
      { kind: ScaffoldKind; label: string; supportsInteractive: boolean }
    > = {
      "block-plugin": { kind: "block", label: "block", supportsInteractive: true },
      "hook-plugin": { kind: "hook", label: "content-hook", supportsInteractive: false },
      "route-plugin": { kind: "route", label: "API-route", supportsInteractive: false },
      "admin-plugin": { kind: "admin", label: "admin-extension", supportsInteractive: false },
      "scheduled-plugin": {
        kind: "scheduled",
        label: "scheduled-task",
        supportsInteractive: false,
      },
    };

    const meta = sub ? kindMap[sub] : undefined;
    if (!meta || !slug) {
      process.stderr.write(
        `Missing or unknown subcommand. Usage: nexpress create <${Object.keys(kindMap).join("|")}> <slug> [--interactive] [--workspace|--out <dir>]\n`,
      );
      return 2;
    }
    if (positional.length > 1) {
      process.stderr.write(`Unexpected positional: ${positional[1]}\n`);
      return 2;
    }

    const interactive = flags.has("--interactive");
    const workspace = flags.has("--workspace");
    if (interactive && !meta.supportsInteractive) {
      process.stderr.write(
        `--interactive isn't supported for ${meta.label} plugins (it only applies to block-plugin).\n`,
      );
      return 2;
    }
    if (workspace && outDirArg) {
      process.stderr.write(`Use either --workspace or --out <dir>, not both.\n`);
      return 2;
    }

    const cwd = process.cwd();
    const outDir = workspace ? resolve(cwd, "packages/plugins") : resolve(cwd, outDirArg ?? ".");
    if (workspace) {
      try {
        resolveProject(cwd);
      } catch {
        process.stderr.write(
          `--workspace must be run from a NexPress project root so packages/plugins can be registered.\n`,
        );
        return 2;
      }
    }
    const dependencyRanges = resolveScaffoldDependencyRanges(cwd);
    try {
      let result: ScaffoldResult;
      switch (meta.kind) {
        case "block":
          result = await scaffoldBlockPlugin({ slug, outDir, dependencyRanges, interactive });
          break;
        case "hook":
          result = await scaffoldHookPlugin({ slug, outDir, dependencyRanges });
          break;
        case "route":
          result = await scaffoldRoutePlugin({ slug, outDir, dependencyRanges });
          break;
        case "admin":
          result = await scaffoldAdminPlugin({ slug, outDir, dependencyRanges });
          break;
        case "scheduled":
          result = await scaffoldScheduledPlugin({ slug, outDir, dependencyRanges });
          break;
        default: {
          // Exhaustiveness check — adding a kind without updating the
          // switch makes the type system complain here.
          const _exhaustive: never = meta.kind;
          void _exhaustive;
          throw new Error(`unreachable: unhandled scaffold kind ${meta.kind as string}`);
        }
      }

      const labelPrefix = meta.kind === "block" && interactive ? "interactive block" : meta.label;
      const packageName = packageNameFromSlug(slug);
      process.stdout.write(
        `\n✓ Scaffolded ${labelPrefix} plugin in ${result.pluginDir}\n` +
          `  Files written:\n` +
          result.files.map((f) => `    - ${f}\n`).join("") +
          `\n  Next (from your NexPress project root):\n` +
          `    1. pnpm install\n` +
          `    2. pnpm --filter ${packageName} build\n` +
          `    3. pnpm exec nexpress plugin add ${packageName}\n`,
      );
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\nnexpress: ${message}\n`);
      return 1;
    }
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
