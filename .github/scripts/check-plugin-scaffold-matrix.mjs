#!/usr/bin/env node
/**
 * Plugin scaffold matrix smoke.
 *
 * Run inside the fresh scaffold CI job after the app dependencies have
 * installed. It exercises the operator-facing `pnpm exec nexpress create
 * *-plugin` path, then proves each generated plugin package can be
 * installed, type-checked, and built in the scaffold workspace.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = scaffoldDirArg ? resolve(scaffoldDirArg) : process.cwd();
const pluginsDir = resolve(scaffoldDir, "packages/plugins");

function fail(message, detail = "") {
  console.error(`::error::${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Could not read ${label}`, error instanceof Error ? error.message : String(error));
  }
}

function run(label, args, options = {}) {
  const result = spawnSync("pnpm", args, {
    cwd: options.cwd ?? scaffoldDir,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    shell: false,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if ((result.status ?? 1) !== 0) {
    fail(
      `${label} failed`,
      [`$ pnpm ${args.join(" ")}`, output.split("\n").slice(-80).join("\n")].join("\n"),
    );
  }
  return output;
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    fail(`${label} missing expected text: ${needle}`, text.split("\n").slice(-40).join("\n"));
  }
}

const rootPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
const expectedRanges = {
  "@nexpress/blocks":
    rootPkg.dependencies?.["@nexpress/blocks"] ?? rootPkg.devDependencies?.["@nexpress/blocks"],
  "@nexpress/plugin-sdk":
    rootPkg.dependencies?.["@nexpress/plugin-sdk"] ??
    rootPkg.devDependencies?.["@nexpress/plugin-sdk"],
};

for (const [name, range] of Object.entries(expectedRanges)) {
  if (typeof range !== "string" || range.length === 0) {
    fail(`scaffold package.json missing ${name}; plugin scaffolds cannot inherit a range`);
  }
}

mkdirSync(pluginsDir, { recursive: true });

const matrix = [
  {
    label: "hook plugin",
    args: ["exec", "nexpress", "create", "hook-plugin", "smoke-hook", "--workspace"],
    dir: "smoke-hook",
    packageName: "smoke-hook",
    cwd: scaffoldDir,
  },
  {
    label: "route plugin",
    args: [
      "exec",
      "nexpress",
      "create",
      "route-plugin",
      "smoke-route",
      "--out",
      "packages/plugins",
    ],
    dir: "smoke-route",
    packageName: "smoke-route",
    cwd: scaffoldDir,
  },
  {
    label: "admin plugin",
    args: ["exec", "nexpress", "create", "admin-plugin", "smoke-admin"],
    dir: "smoke-admin",
    packageName: "smoke-admin",
  },
  {
    label: "scheduled plugin",
    args: ["exec", "nexpress", "create", "scheduled-plugin", "smoke-scheduled"],
    dir: "smoke-scheduled",
    packageName: "smoke-scheduled",
  },
  {
    label: "static block plugin",
    args: ["exec", "nexpress", "create", "block-plugin", "smoke-block"],
    dir: "smoke-block",
    packageName: "smoke-block",
  },
  {
    label: "interactive block plugin",
    args: ["exec", "nexpress", "create", "block-plugin", "smoke-interactive", "--interactive"],
    dir: "smoke-interactive",
    packageName: "smoke-interactive",
    interactive: true,
  },
];

for (const entry of matrix) {
  run(`create ${entry.label}`, entry.args, { cwd: entry.cwd ?? pluginsDir });
  const pluginDir = resolve(pluginsDir, entry.dir);
  const pkg = readJson(resolve(pluginDir, "package.json"), `${entry.label} package.json`);
  const tsconfig = readJson(resolve(pluginDir, "tsconfig.json"), `${entry.label} tsconfig.json`);

  if (pkg.name !== entry.packageName) {
    fail(
      `${entry.label} package name drifted`,
      `expected ${entry.packageName}\nactual ${pkg.name}`,
    );
  }
  for (const [name, range] of Object.entries(expectedRanges)) {
    if (pkg.dependencies?.[name] !== range) {
      fail(
        `${entry.label} did not inherit ${name} dependency range`,
        `expected: ${range}\nactual: ${pkg.dependencies?.[name] ?? "(missing)"}`,
      );
    }
  }
  if (typeof tsconfig.extends === "string") {
    fail(`${entry.label} tsconfig should not extend the scaffold app tsconfig`, tsconfig.extends);
  }
  if (
    tsconfig.compilerOptions?.module !== "NodeNext" ||
    tsconfig.compilerOptions?.moduleResolution !== "NodeNext"
  ) {
    fail(
      `${entry.label} tsconfig should be a self-contained package config`,
      JSON.stringify(tsconfig, null, 2),
    );
  }
  if (entry.label === "admin plugin" && pkg.dependencies?.zod !== "^4.4.3") {
    fail("admin plugin scaffold should include zod for configSchema", JSON.stringify(pkg, null, 2));
  }
}
console.log(`✓ generated plugin packages: ${matrix.map((entry) => entry.packageName).join(", ")}`);

run("install generated plugin workspaces", ["install", "--no-frozen-lockfile"], {
  timeout: 180_000,
});

for (const entry of matrix) {
  run(`${entry.label} typecheck`, ["--filter", entry.packageName, "typecheck"]);
  run(`${entry.label} build`, ["--filter", entry.packageName, "build"], { timeout: 180_000 });
}
console.log("✓ generated plugin packages typecheck and build");

run("register generated local plugin", ["exec", "nexpress", "plugin", "add", "smoke-hook"], {
  timeout: 180_000,
});
const registeredPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
if (registeredPkg.dependencies?.["smoke-hook"] !== "workspace:*") {
  fail(
    "local plugin registration should add the workspace dependency",
    `actual: ${registeredPkg.dependencies?.["smoke-hook"] ?? "(missing)"}`,
  );
}
const configSource = readFileSync(resolve(scaffoldDir, "src/nexpress.config.ts"), "utf8");
assertIncludes(configSource, 'import smokeHook from "smoke-hook";', "nexpress.config.ts");
assertIncludes(configSource, "smokeHook,", "nexpress.config.ts");
console.log("✓ generated local plugin registers through nexpress plugin add");

const interactiveClient = resolve(pluginsDir, "smoke-interactive/dist/client.js");
if (!existsSync(interactiveClient)) {
  fail("interactive block build should emit dist/client.js");
}
assertIncludes(
  readFileSync(interactiveClient, "utf8").slice(0, 240),
  '"use client";',
  "interactive block dist/client.js",
);
console.log("✓ interactive block scaffold preserves the client boundary after build");
