import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pc from "picocolors";
import { npValidateRegisteredThemeDefinition } from "@nexpress/core";

import {
  addThemeToConfig,
  buildManualThemeSnippet,
  packageToThemeIdentifier,
  type ThemeEntry,
} from "../config-editor.js";
import {
  buildPackageManagerArgs,
  inspectLocalWorkspacePackage,
  isPnpmWorkspaceRoot,
  missingLocalPackageBuildArtifacts,
  type NpPackageManager,
  type NpPackageManagerOptions,
} from "../package-manager.js";

/**
 * `nexpress theme add <pkg>` registers a theme package without
 * patching the operator's `src/collections/*.ts` files. The
 * framework picks up the theme's `manifest.requires.collections`
 * at config-resolution time (`defineConfig` → `mergeThemeRequirements`)
 * and unions the declared fields into the collections array, so
 * the operator's source tree stays untouched.
 *
 * Steps the runner performs:
 *
 *   1. Validate the package name shape (`theme-<name>` so we can
 *      derive a `<name>Theme` identifier for the import) and
 *      resolve the operator's nexpress.config.ts path.
 *   2. Run `pnpm/yarn/npm add <pkg>` against the operator's cwd.
 *   3. Re-load the config file, AST-patch the theme markers
 *      (`@nexpress:themes-imports-*` and `@nexpress:themes-list-*`)
 *      to insert the import + identifier.
 *   4. Dynamic-import the freshly-installed module to confirm
 *      it exposes a `<identifier>` export shaped like a
 *      defineTheme() return value — the lazy-import fix from
 *      #726 means this doesn't boot Next.
 *   5. With `--apply`, chain `pnpm db:generate` + `pnpm db:migrate`
 *      so the theme-declared columns hit the database in one
 *      shot. Otherwise print the two commands and return.
 *   6. `--dry-run` short-circuits after step 1 with the planned
 *      mutations printed; `--yes` skips the interactive confirm.
 */

interface RunInput {
  themePackage: string;
  flags: {
    /** Print the plan and exit; don't touch the filesystem or run package manager. */
    dryRun: boolean;
    /** Skip the interactive Continue? prompt. */
    yes: boolean;
    /** Chain `pnpm db:generate && pnpm db:migrate` after the registration. */
    apply: boolean;
  };
}

type PackageManagerRunner = (
  manager: NpPackageManager,
  action: "add" | "remove",
  packageName: string,
  cwd: string,
  options?: NpPackageManagerOptions,
) => Promise<void>;

interface ThemeAddRuntime {
  cwd?: string;
  runPackageManager?: PackageManagerRunner;
  themeExportProbe?: (
    themePackage: string,
    identifier: string,
    cwd: string,
  ) => Promise<string | null>;
}

interface ResolvedProject {
  cwd: string;
  configPath: string;
  packageManager: NpPackageManager;
}

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
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  const packageJsonPath = resolve(cwd, "package.json");
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
      // Ignore malformed package.json here; command-specific IO will
      // report the actionable failure.
    }
  }
  if (existsSync(resolve(cwd, "pnpm-workspace.yaml"))) return "pnpm";
  return "npm";
}

function resolveProject(cwd: string): ResolvedProject {
  return {
    cwd,
    configPath: resolveConfigPath(cwd),
    packageManager: detectPackageManager(cwd),
  };
}

function runChild(manager: NpPackageManager, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolveFn) => {
    const child = spawn(manager, args, { cwd, stdio: "inherit" });
    child.on("error", () => resolveFn(false));
    child.on("exit", (code) => resolveFn(code === 0));
  });
}

function formatProjectScriptCommand(manager: NpPackageManager, script: string): string {
  return manager === "npm" ? `npm run ${script}` : `${manager} ${script}`;
}

async function confirm(message: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

function selectImportExport(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = selectImportExport(candidate);
      if (selected) return selected;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const conditions = value as Record<string, unknown>;
  for (const condition of ["import", "node", "default"] as const) {
    const selected = selectImportExport(conditions[condition]);
    if (selected) return selected;
  }
  return null;
}

async function resolveThemeImport(themePackage: string, cwd: string): Promise<string> {
  // `createRequire().resolve()` uses the `require` export condition, so it
  // cannot resolve a correct ESM-only package whose root exposes only
  // `{ import, types }`. Read the installed package's root import target first;
  // retain createRequire as a fallback for classic main/default packages and
  // package-manager resolvers that do not expose a normal node_modules path.
  try {
    const packageDirectory = resolve(cwd, "node_modules", ...themePackage.split("/"));
    const packageJson = JSON.parse(
      await readFile(resolve(packageDirectory, "package.json"), "utf-8"),
    ) as Record<string, unknown>;
    const exportsField = packageJson.exports;
    const rootExport =
      exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)
        ? ((exportsField as Record<string, unknown>)["."] ?? exportsField)
        : exportsField;
    const target =
      selectImportExport(rootExport) ??
      (typeof packageJson.module === "string" ? packageJson.module : null) ??
      (typeof packageJson.main === "string" ? packageJson.main : null);
    if (target) {
      const resolvedTarget = resolve(packageDirectory, target);
      const relativeTarget = relative(packageDirectory, resolvedTarget);
      if (relativeTarget !== "" && !relativeTarget.startsWith("..")) return resolvedTarget;
    }
  } catch {
    // Fall through to the package manager's CommonJS-compatible resolver.
  }

  const { createRequire } = await import("node:module");
  return createRequire(resolve(cwd, "package.json")).resolve(themePackage);
}

/**
 * Dynamic-import contract check. The lazy-import fix
 * landed in #726 ensures themes don't boot Next during their
 * top-level module evaluation, so loading `<pkg>` here is cheap
 * and side-effect free. We accept either:
 *   - a named `<identifier>` export shaped like
 *     `{ manifest, impl }` (the real theme), OR
 *   - a `default` export of the same shape (some authors export
 *     `default defineTheme(...)`).
 * Anything else surfaces a clear "your package's main export
 * doesn't look like a theme" message so the operator can fix
 * the package or add the import manually.
 *
 * Returns null only for a valid named export. Import, export-shape, and
 * definition failures stop registration so a broken package cannot be written
 * into nexpress.config.ts and deferred until application boot.
 */
async function probeThemeExport(
  themePackage: string,
  identifier: string,
  cwd: string,
): Promise<string | null> {
  // Resolve through the operator's node_modules — not the CLI
  // package's. Without the explicit base path, `import()` would
  // try the CLI's own resolution and fail to find a freshly
  // installed peer.
  let resolved: string;
  try {
    resolved = await resolveThemeImport(themePackage, cwd);
  } catch (err) {
    return `Could not resolve "${themePackage}" from ${cwd}: ${err instanceof Error ? err.message : String(err)}`;
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(resolved)) as Record<string, unknown>;
  } catch (err) {
    return `Failed to import "${themePackage}": ${err instanceof Error ? err.message : String(err)}`;
  }

  const named = mod[identifier];
  const defaultExport = mod["default"];
  if (named && typeof named === "object") {
    const validation = npValidateRegisteredThemeDefinition(named);
    if (validation.ok) return null;
    return `"${themePackage}" exports an invalid theme at ${validation.issue.location}: ${validation.issue.message}`;
  }
  if (defaultExport && typeof defaultExport === "object") {
    // Operator's package exports as default — we still register
    // via a named import (`import { magazineTheme } from ...`),
    // so warn so they know the import will need a default-shape
    // tweak.
    return `"${themePackage}" exports the theme as the default export, but \`theme add\` writes a named import \`{ ${identifier} }\`. Re-export as \`export const ${identifier} = ...\` or add the import manually.`;
  }
  return `"${themePackage}" has no \`${identifier}\` export shaped like a defineTheme() result. Confirm the package exports its theme as \`export const ${identifier} = defineTheme(...)\`.`;
}

async function runDbCommand(
  manager: NpPackageManager,
  script: "db:generate" | "db:migrate",
  cwd: string,
): Promise<boolean> {
  const args = manager === "npm" ? ["run", script] : [script];
  return runChild(manager, args, cwd);
}

/**
 * Entry point for `nexpress theme add <pkg>`. Returns a process
 * exit code so the bin wrapper can `process.exit()` cleanly.
 */
export async function runThemeAdd(input: RunInput, runtime: ThemeAddRuntime = {}): Promise<number> {
  let identifier: string;
  try {
    identifier = packageToThemeIdentifier(input.themePackage);
  } catch (err) {
    process.stderr.write(
      `\n${pc.red("error:")} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  const cwd = runtime.cwd ?? process.cwd();
  const packageManagerRunner =
    runtime.runPackageManager ??
    ((manager, action, packageName, projectCwd, options = {}) =>
      new Promise<void>((resolveFn, reject) => {
        const args = buildPackageManagerArgs(manager, action, packageName, options);
        const child = spawn(manager, args, { cwd: projectCwd, stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolveFn();
          else reject(new Error(`${manager} ${args.join(" ")} failed; theme was not installed.`));
        });
      }));
  let project: ResolvedProject;
  try {
    project = resolveProject(cwd);
  } catch (err) {
    process.stderr.write(
      `\n${pc.red("error:")} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
  const pnpmWorkspaceRoot = project.packageManager === "pnpm" && isPnpmWorkspaceRoot(project.cwd);

  const entry: ThemeEntry = {
    packageName: input.themePackage,
    identifier,
  };

  // Plan / dry-run path: don't touch the package manager or
  // disk. Print what would happen and exit.
  if (input.flags.dryRun) {
    const localWorkspace = pnpmWorkspaceRoot
      ? inspectLocalWorkspacePackage(project.cwd, input.themePackage, ["packages/themes"])
      : ({ kind: "missing" } as const);
    const packageManagerArgs = buildPackageManagerArgs(
      project.packageManager,
      "add",
      input.themePackage,
      {
        localWorkspace: localWorkspace.kind === "found",
        ...(pnpmWorkspaceRoot ? { workspaceRoot: true } : {}),
      },
    );
    process.stdout.write(
      `${pc.dim("Plan (dry-run):")}\n` +
        `  • ${pc.cyan(`${project.packageManager} ${packageManagerArgs.join(" ")}`)}\n` +
        `  • Insert ${pc.cyan(`import { ${identifier} } from "${input.themePackage}";`)} into ${pc.cyan(project.configPath)}\n` +
        `  • Append ${pc.cyan(identifier)} to the \`themes:\` array\n` +
        (input.flags.apply
          ? `  • Run ${pc.cyan(formatProjectScriptCommand(project.packageManager, "db:generate"))} then ${pc.cyan(formatProjectScriptCommand(project.packageManager, "db:migrate"))}\n`
          : `  • You then run ${pc.cyan(`${formatProjectScriptCommand(project.packageManager, "db:generate")} && ${formatProjectScriptCommand(project.packageManager, "db:migrate")}`)} to materialise theme-declared columns\n`),
    );
    return 0;
  }

  // Read the config FIRST so a missing-markers error short-
  // circuits BEFORE running the package manager. This mirrors
  // `plugin add`'s safety check and saves the operator from an
  // installed-but-not-registered limbo state.
  const original = await readFile(project.configPath, "utf-8");
  const dryEdit = addThemeToConfig(original, entry);
  if (dryEdit.kind === "no-markers") {
    process.stdout.write(
      `\n${pc.yellow("⚠")} ${project.configPath} doesn't have theme markers, so "${project.packageManager} add" was NOT run.\n` +
        `  Add the marker template below to your config (or paste the snippet directly), then re-run.\n\n` +
        `${buildManualThemeSnippet(entry)}\n\n` +
        `Marker template (one new pair next to the plugin markers, one inside your \`themes: [...]\`):\n` +
        `  // @nexpress:themes-imports-start\n` +
        `  // @nexpress:themes-imports-end\n\n` +
        `  themes: [\n` +
        `    ...defaultThemes,\n` +
        `    // @nexpress:themes-list-start\n` +
        `    // @nexpress:themes-list-end\n` +
        `  ],\n`,
    );
    return 1;
  }

  const localWorkspace = pnpmWorkspaceRoot
    ? inspectLocalWorkspacePackage(project.cwd, input.themePackage, ["packages/themes"])
    : ({ kind: "missing" } as const);
  if (localWorkspace.kind === "malformed") {
    process.stdout.write(
      `\n${pc.yellow("⚠")} Found a local theme candidate at ${relative(project.cwd, localWorkspace.dir)}, but ${relative(
        project.cwd,
        localWorkspace.packageJsonPath,
      )} is not valid JSON.\n` +
        `  Fix that package.json, then re-run pnpm exec nexpress theme add ${input.themePackage} --yes.\n`,
    );
    return 1;
  }
  if (localWorkspace.kind === "found") {
    const missingArtifacts = missingLocalPackageBuildArtifacts(
      localWorkspace.dir,
      localWorkspace.packageJson,
    );
    if (missingArtifacts.length > 0) {
      process.stdout.write(
        `\n${pc.yellow("⚠")} Found local workspace theme at ${relative(project.cwd, localWorkspace.dir)}, but build output is missing:\n` +
          missingArtifacts
            .map((path) => `  - ${relative(project.cwd, resolve(localWorkspace.dir, path))}\n`)
            .join("") +
          `\nRun pnpm --filter ${input.themePackage} build, then re-run pnpm exec nexpress theme add ${input.themePackage} --yes.\n`,
      );
      return 1;
    }
  }

  if (!input.flags.yes) {
    if (!stdin.isTTY) {
      process.stderr.write(
        `${pc.red("error:")} theme add needs interactive confirmation, but stdin isn't a TTY.\n` +
          `  Re-run with --yes to skip the prompt non-interactively.\n`,
      );
      return 2;
    }
    const prompt = input.flags.apply
      ? `Install ${input.themePackage}, register it, then run db:generate + db:migrate?`
      : `Install ${input.themePackage} and register it?`;
    const ok = await confirm(prompt);
    if (!ok) {
      process.stdout.write(pc.dim("Aborted.\n"));
      return 0;
    }
  }

  // 1. Run the package manager — gives us the on-disk module.
  process.stdout.write(`\n→ Installing ${input.themePackage} via ${project.packageManager}…\n`);
  if (localWorkspace.kind === "found") {
    process.stdout.write(
      `  Detected local workspace theme at ${relative(project.cwd, localWorkspace.dir)}; using workspace:*.\n`,
    );
  }
  try {
    await packageManagerRunner(project.packageManager, "add", input.themePackage, project.cwd, {
      localWorkspace: localWorkspace.kind === "found",
      ...(pnpmWorkspaceRoot ? { workspaceRoot: true } : {}),
    });
  } catch (err) {
    process.stderr.write(
      `\n${pc.red("error:")} ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 2. Probe the freshly-installed module so structurally wrong
  //    themes surface NOW with a fix-it hint rather than booting
  //    Next first.
  const probeMsg = await (runtime.themeExportProbe ?? probeThemeExport)(
    input.themePackage,
    identifier,
    project.cwd,
  );
  if (probeMsg) {
    process.stderr.write(
      `\n${pc.red("error:")} ${probeMsg}\n  Theme registration was not written.\n`,
    );
    return 1;
  }

  // 3. Re-read the config (some installers run formatters /
  //    write back tsconfig — unlikely to touch this file, but
  //    re-reading is cheap insurance).
  const afterInstall = await readFile(project.configPath, "utf-8");
  const result = addThemeToConfig(afterInstall, entry);

  if (result.kind === "no-markers") {
    process.stdout.write(
      `\n${pc.yellow("⚠")} ${project.configPath} no longer has theme markers. Paste this manually:\n\n${buildManualThemeSnippet(
        entry,
      )}\n`,
    );
    return 1;
  }
  if (result.kind === "ok") {
    await writeFile(project.configPath, result.content, "utf-8");
    process.stdout.write(
      `${pc.green("✓")} Registered ${pc.cyan(identifier)} in ${pc.cyan(project.configPath)}\n`,
    );
  } else if (result.kind === "no-op") {
    process.stdout.write(
      pc.dim(`· Package installed; ${result.reason}. No config change needed.\n`),
    );
  }

  // 4. Migrations. Without `--apply`, print the two commands so
  //    the operator can review the diff between them.
  if (input.flags.apply) {
    process.stdout.write(
      `\n${pc.dim("Running")} ${formatProjectScriptCommand(project.packageManager, "db:generate")}…\n`,
    );
    const generated = await runDbCommand(project.packageManager, "db:generate", project.cwd);
    if (!generated) {
      process.stdout.write(
        `\n${pc.yellow("⚠")} db:generate failed. Run \`${formatProjectScriptCommand(
          project.packageManager,
          "db:generate",
        )} && ${formatProjectScriptCommand(project.packageManager, "db:migrate")}\` manually after fixing.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `\n${pc.dim("Running")} ${formatProjectScriptCommand(project.packageManager, "db:migrate")}…\n`,
    );
    const migrated = await runDbCommand(project.packageManager, "db:migrate", project.cwd);
    if (!migrated) {
      process.stdout.write(
        `\n${pc.yellow("⚠")} db:migrate failed. Review the generated SQL and run \`${formatProjectScriptCommand(
          project.packageManager,
          "db:migrate",
        )}\` manually.\n`,
      );
      return 1;
    }
    process.stdout.write(
      `\n${pc.green("✓")} Theme installed, registered, and migrated.\n` +
        `  Activate in admin → Settings → Theme.\n`,
    );
    return 0;
  }

  process.stdout.write(
    `\nNext:\n` +
      `  1. Run ${pc.cyan(`${formatProjectScriptCommand(project.packageManager, "db:generate")} && ${formatProjectScriptCommand(project.packageManager, "db:migrate")}`)} to materialise theme-declared columns.\n` +
      `  2. Activate the theme in admin → Settings → Theme.\n` +
      `  ${pc.dim("(or re-run with --apply to chain db:generate + db:migrate automatically)")}\n`,
  );
  return 0;
}
