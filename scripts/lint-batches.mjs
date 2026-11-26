#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const cli = fileURLToPath(new URL("../node_modules/eslint/bin/eslint.js", import.meta.url));
export const batchSize = 16;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Existing file/directory targets precede --; normal ESLint options follow it.
 * Shell-expanded globs work as explicit files. Unexpanded globs fail closed.
 * Positive global warning thresholds and fixing are deliberately unsupported:
 * they require cross-batch semantics beyond this read-only repository lint gate. */
export function parseArgs(args) {
  const separator = args.indexOf("--");
  const targets = separator < 0 ? args : args.slice(0, separator);
  const options = separator < 0 ? [] : args.slice(separator + 1);
  if (!targets.length || targets.some((value) => !value || value.startsWith("-")))
    throw new Error(
      "Provide existing lint files/directories before -- and ESLint options after it.",
    );
  const discovery = {};
  const extensions = [];
  let explicitConfig;
  let cache = false;
  let cacheLocation = ".eslintcache";
  let cacheIndex = -1;
  let cacheInline = false;
  let allowEmpty = false;
  const valued = new Set([
    "--cache-location",
    "--cache-strategy",
    "--ext",
    "--config",
    "-c",
    "--ignore-pattern",
    "--max-warnings",
    "--format",
    "-f",
  ]);
  const flags = new Set([
    "--cache",
    "--no-cache",
    "--ignore",
    "--no-ignore",
    "--no-config-lookup",
    "--no-warn-ignored",
    "--no-error-on-unmatched-pattern",
    "--quiet",
    "--no-inline-config",
    "--report-unused-disable-directives",
  ]);
  for (let index = 0; index < options.length; index++) {
    const argument = options[index];
    const equal = argument.indexOf("=");
    const key = equal < 0 ? argument : argument.slice(0, equal);
    if (!valued.has(key) && !flags.has(key))
      throw new Error(`Unsupported ESLint option: ${argument}`);
    let value;
    const position = index;
    if (valued.has(key)) {
      value = equal < 0 ? options[++index] : argument.slice(equal + 1);
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    } else if (equal >= 0) throw new Error(`Unexpected value for ${key}`);
    if (key === "--cache") cache = true;
    if (key === "--no-cache") cache = false;
    if (key === "--cache-location") {
      cacheLocation = value;
      cacheIndex = position;
      cacheInline = equal >= 0;
    }
    if (key === "--ignore" || key === "--no-ignore") discovery.ignore = key === "--ignore";
    if (key === "--no-config-lookup") discovery.overrideConfigFile = true;
    if (key === "--config" || key === "-c") explicitConfig = value;
    if (key === "--ignore-pattern") (discovery.ignorePatterns ??= []).push(value);
    if (key === "--ext") extensions.push(...value.split(","));
    if (key === "--no-error-on-unmatched-pattern") allowEmpty = true;
    if (key === "--max-warnings" && value !== "0" && value !== "-1")
      throw new Error("Only --max-warnings 0 or -1 preserves the global threshold across batches.");
  }
  if (explicitConfig !== undefined) discovery.overrideConfigFile = explicitConfig;
  if (extensions.length) {
    if (extensions.some((extension) => !/^\.?[a-zA-Z0-9]+$/u.test(extension)))
      throw new Error("--ext requires comma-separated file extensions.");
    discovery.overrideConfig = [
      { files: extensions.map((extension) => `**/*.${extension.replace(/^\./u, "")}`) },
    ];
  }
  return { targets, options, discovery, cache, cacheLocation, cacheIndex, cacheInline, allowEmpty };
}

export async function discoverFiles(plan, cwd = process.cwd()) {
  const eslint = new ESLint({ cwd, ...plan.discovery });
  const files = new Set();
  async function directory(folder, ancestors) {
    const entries = await readdir(folder, { withFileTypes: true });
    const found = [];
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      // ESLint directory traversal does not follow directory symlinks. Explicit
      // symlink file targets still use ESLint's normal resolution in the child.
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (ancestors.has(absolute)) throw new Error(`Directory cycle: ${absolute}`);
        found.push(...(await directory(absolute, new Set([...ancestors, absolute]))));
      } else if (entry.isFile() && !(await eslint.isPathIgnored(absolute))) found.push(absolute);
    }
    return found;
  }
  for (const target of plan.targets) {
    const absolute = path.resolve(cwd, target);
    let information;
    try {
      information = await stat(absolute);
    } catch (error) {
      if (plan.allowEmpty && error.code === "ENOENT") continue;
      throw new Error(`Lint target does not exist (expand globs in the shell): ${target}`, {
        cause: error,
      });
    }
    if (information.isFile()) {
      // Keep explicit ignored/unsupported files: ESLint itself owns their normal
      // warning and --max-warnings status, unlike ignored directory descendants.
      files.add(absolute);
    } else if (information.isDirectory()) {
      const descendants = await directory(absolute, new Set([absolute]));
      if (!descendants.length && !plan.allowEmpty)
        throw new Error(`No unignored lint files in ${target}`);
      for (const file of descendants) files.add(file);
    } else throw new Error(`Lint target is not a regular file or directory: ${target}`);
  }
  return [...files].map((file) => path.relative(cwd, file)).sort(compare);
}

export function batches(files, size = batchSize) {
  if (!Number.isSafeInteger(size) || size < 1 || size > batchSize)
    throw new Error(`Lint batch size must be an integer from 1 to ${batchSize}.`);
  const unique = [...new Set(files)].sort(compare);
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, index) =>
    unique.slice(index * size, (index + 1) * size),
  );
}

export function batchOptions(plan, files, cwd) {
  const options = [...plan.options];
  if (!plan.cache) return options;
  const identity = createHash("sha256").update(files.join("\0")).digest("hex").slice(0, 20);
  const location = path.join(
    path.resolve(cwd, plan.cacheLocation) + ".batches",
    identity + ".cache",
  );
  if (plan.cacheIndex < 0) options.push("--cache-location", location);
  else if (plan.cacheInline) options[plan.cacheIndex] = `--cache-location=${location}`;
  else options[plan.cacheIndex + 1] = location;
  return options;
}

export async function runBatches(
  plan,
  { cwd = process.cwd(), spawn = spawnSync, output = console.log, env = process.env } = {},
) {
  const files = await discoverFiles(plan, cwd);
  // Composition-heavy packages may lower the per-child file bound while
  // preserving the same discovery, rules, heap limit and aggregate status.
  const groups = batches(files, Number(env.NP_LINT_BATCH_SIZE ?? batchSize));
  if (plan.cache)
    await mkdir(path.resolve(cwd, plan.cacheLocation) + ".batches", { recursive: true });
  let exitCode = 0;
  for (const [index, group] of groups.entries()) {
    output(`ESLint ${index + 1}/${groups.length}: ${group.length} files`);
    const nodeOptions = env.NODE_OPTIONS || "--max-old-space-size=6144";
    const result = spawn(process.execPath, [cli, ...group, ...batchOptions(plan, group, cwd)], {
      cwd,
      env: { ...env, NODE_OPTIONS: nodeOptions },
      stdio: "inherit",
    });
    const status = Number.isInteger(result.status) && result.status >= 0 ? result.status : 2;
    if (status !== 0) {
      output(
        `ESLint batch ${index + 1} failed (${status}${result.signal ? `, ${result.signal}` : ""}).`,
      );
      exitCode = Math.max(exitCode, status);
    }
    if (result.error) output(result.error.message);
    if (result.signal === "SIGINT" || result.signal === "SIGTERM") break;
  }
  return { exitCode, files, batchCount: groups.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = (await runBatches(parseArgs(process.argv.slice(2)))).exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
