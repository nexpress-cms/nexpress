#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const webRoot = path.join(root, "apps/web");
const timingFile = new URL("./integration-durations.json", import.meta.url);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function uniqueFiles(files) {
  if (!Array.isArray(files) || !files.length || files.some((f) => typeof f !== "string"))
    throw new Error("A nonempty file inventory is required");
  if (new Set(files).size !== files.length) throw new Error("Duplicate test files");
  return [...files].sort(compare);
}

export function assertSameFiles(actual, expected) {
  if (JSON.stringify(uniqueFiles(actual)) !== JSON.stringify(uniqueFiles(expected)))
    throw new Error("Test file inventory differs from the planned coverage");
}

export function partitionFiles(files, durations) {
  const inventory = uniqueFiles(files);
  const known = inventory.map((f) => durations[f]).filter((n) => Number.isFinite(n) && n > 0);
  known.sort((a, b) => a - b);
  const fallback = known[Math.floor(known.length / 2)] ?? 1;
  const weight = (f) =>
    Math.max(1, Number.isFinite(durations[f]) && durations[f] >= 0 ? durations[f] : fallback);
  const groups = [
    { files: [], weightMs: 0 },
    { files: [], weightMs: 0 },
  ];
  for (const file of [...inventory].sort((a, b) => weight(b) - weight(a) || compare(a, b))) {
    const target = groups[0].weightMs <= groups[1].weightMs ? groups[0] : groups[1];
    target.files.push(file);
    target.weightMs += weight(file);
  }
  for (const group of groups) group.files.sort(compare);
  assertSameFiles(
    groups.flatMap((g) => g.files),
    inventory,
  );
  return groups;
}

export function checkResults(results, commit) {
  if (!Array.isArray(results) || results.length !== 2)
    throw new Error("Both partitions are required");
  const ordered = [...results].sort((a, b) => a.partition - b.partition);
  for (const [index, result] of ordered.entries()) {
    if (
      result.partition !== index + 1 ||
      result.version !== 1 ||
      result.commit !== commit ||
      !commit ||
      result.status !== "success" ||
      result.core !== (index === 0 ? "success" : "not-assigned") ||
      result.redis !== (index === 1 ? "success" : "not-assigned")
    )
      throw new Error("Partition identity, status or package ownership is invalid");
    uniqueFiles(result.files);
    assertSameFiles(result.inventory, ordered[0].inventory);
  }
  assertSameFiles(
    ordered.flatMap((r) => r.files),
    ordered[0].inventory,
  );
  return ordered[0].inventory.length;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
  return result.stdout;
}

function listFiles(filters = []) {
  // Vitest's own configured discovery is authoritative. Positional filters are
  // substrings, so validate the actual selection before using the same run args.
  const output = runCommand(
    "pnpm",
    ["--filter", "@nexpress/web", "exec", "vitest", "list", ...filters, "--filesOnly", "--json"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  return uniqueFiles(
    JSON.parse(output).map(({ file }) => path.relative(webRoot, file).split(path.sep).join("/")),
  );
}

export function parseArgs(args) {
  if (args.length === 1 && args[0] === "--plan") return { mode: "plan" };
  if (args.length === 2 && args[0] === "--check-results" && args[1])
    return { mode: "check", directory: path.resolve(args[1]) };
  if (args.length === 3 && ["1", "2"].includes(args[0]) && args[1] === "--output" && args[2])
    return { mode: "run", partition: Number(args[0]), directory: path.resolve(args[2]) };
  throw new Error(
    "Usage: integration-partitions.mjs --plan | <1|2> --output <directory> | --check-results <directory>",
  );
}

export function requireEnvironment(partition, env) {
  for (const name of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    ...(partition === 2 ? ["TEST_REDIS_URL"] : []),
  ]) {
    if (!env[name]?.trim())
      throw new Error(`${name} is required; CI must not silently skip integration tests`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "check") {
    const count = checkResults(
      [1, 2].map((i) => JSON.parse(readFileSync(path.join(args.directory, `${i}.json`), "utf8"))),
      process.env.GITHUB_SHA,
    );
    console.log(`Both partitions passed: ${count} Web files exactly once, Core once, Redis once.`);
    return;
  }
  if (args.mode === "run") requireEnvironment(args.partition, process.env);
  process.env.NP_DEV_FAST = "0";
  const packages = JSON.parse(
    runCommand("pnpm", ["-r", "list", "--json", "--depth", "-1"], {
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const owners = packages
    .filter(
      (p) =>
        path.resolve(p.path) !== path.resolve(root) &&
        JSON.parse(readFileSync(path.join(p.path, "package.json"), "utf8")).scripts?.[
          "test:integration"
        ],
    )
    .map((p) => p.name);
  assertSameFiles(owners, ["@nexpress/core", "@nexpress/web"]);
  if (
    JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")).scripts[
      "test:integration"
    ] !== "vitest run"
  )
    throw new Error(
      "Web integration command changed; update partition discovery and execution together",
    );
  const inventory = listFiles();
  const groups = partitionFiles(inventory, JSON.parse(readFileSync(timingFile, "utf8")).files);
  // Check both selections on each runner. Changes to Vitest matching/config must
  // never silently add duplicates or leave files outside the two groups.
  for (const group of groups) {
    if (!group.files.length) throw new Error("Empty integration partition");
    assertSameFiles(listFiles(group.files.map((f) => path.join(webRoot, f))), group.files);
  }
  console.log(JSON.stringify({ inventoryCount: inventory.length, partitions: groups }, null, 2));
  if (args.mode === "plan") return;
  const selected = groups[args.partition - 1].files;
  if (args.partition === 1) runCommand("pnpm", ["--filter", "@nexpress/core", "test:integration"]);
  runCommand("pnpm", [
    "--filter",
    "@nexpress/web",
    "exec",
    "vitest",
    "run",
    ...selected.map((f) => path.join(webRoot, f)),
  ]);
  if (args.partition === 2)
    runCommand("pnpm", ["--filter", "@nexpress/rate-limiter-redis", "test"]);
  // Publish only after every assigned command succeeds; the aggregate also
  // checks the job result, so stale files cannot turn a failed job green.
  mkdirSync(args.directory, { recursive: true });
  writeFileSync(
    path.join(args.directory, `${args.partition}.json`),
    JSON.stringify(
      {
        version: 1,
        partition: args.partition,
        commit: process.env.GITHUB_SHA,
        status: "success",
        inventory,
        files: selected,
        core: args.partition === 1 ? "success" : "not-assigned",
        redis: args.partition === 2 ? "success" : "not-assigned",
      },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
