#!/usr/bin/env node
/**
 * Extension scaffold matrix smoke.
 *
 * Run inside the fresh scaffold CI job after the app dependencies have
 * installed. It exercises the operator-facing `pnpm exec nexpress create
 * *-plugin` and `create theme` paths. Plugin packages are installed,
 * type-checked, built, registered, verified with ops:plugins doctor, and
 * removed. Theme packages are type-checked, built, and registered through
 * `theme add` so local theme authoring works in a fresh scaffold.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , scaffoldDirArg] = process.argv;
const scaffoldDir = scaffoldDirArg ? resolve(scaffoldDirArg) : process.cwd();
const pluginsDir = resolve(scaffoldDir, "packages/plugins");
const themesDir = resolve(scaffoldDir, "packages/themes");

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

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    fail(
      `${label} did not print valid JSON`,
      [
        error instanceof Error ? error.message : String(error),
        output.split("\n").slice(-80).join("\n"),
      ].join("\n"),
    );
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

function pluginIdentifier(packageName) {
  return packageName
    .replace(/^@[^/]+\//, "")
    .replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function themeIdentifier(packageName) {
  const tail = packageName.replace(/^@[^/]+\//, "").replace(/^theme[-_]/, "");
  const identifier = tail.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
  return `${identifier}Theme`;
}

const rootPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
const expectedPluginRanges = {
  "@nexpress/blocks":
    rootPkg.dependencies?.["@nexpress/blocks"] ?? rootPkg.devDependencies?.["@nexpress/blocks"],
  "@nexpress/plugin-sdk":
    rootPkg.dependencies?.["@nexpress/plugin-sdk"] ??
    rootPkg.devDependencies?.["@nexpress/plugin-sdk"],
};
const expectedThemeRanges = {
  "@nexpress/blocks":
    rootPkg.dependencies?.["@nexpress/blocks"] ?? rootPkg.devDependencies?.["@nexpress/blocks"],
  "@nexpress/theme":
    rootPkg.dependencies?.["@nexpress/theme"] ?? rootPkg.devDependencies?.["@nexpress/theme"],
};

for (const [name, range] of Object.entries({ ...expectedPluginRanges, ...expectedThemeRanges })) {
  if (typeof range !== "string" || range.length === 0) {
    fail(`scaffold package.json missing ${name}; extension scaffolds cannot inherit a range`);
  }
}

mkdirSync(pluginsDir, { recursive: true });
mkdirSync(themesDir, { recursive: true });

const pluginMatrix = [
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

const themeMatrix = [
  {
    label: "theme",
    args: ["exec", "nexpress", "create", "theme", "newsroom", "--workspace"],
    dir: "newsroom",
    packageName: "theme-newsroom",
    cwd: scaffoldDir,
  },
];

for (const entry of pluginMatrix) {
  const createOutput = run(`create ${entry.label}`, entry.args, { cwd: entry.cwd ?? pluginsDir });
  assertIncludes(
    createOutput,
    `pnpm --filter ${entry.packageName} build`,
    `${entry.label} create output`,
  );
  assertIncludes(
    createOutput,
    `pnpm exec nexpress plugin add ${entry.packageName}`,
    `${entry.label} create output`,
  );
  assertIncludes(
    createOutput,
    "Restart your dev server or redeploy",
    `${entry.label} create output`,
  );
  assertIncludes(
    createOutput,
    "pnpm --silent run ops:plugins -- doctor --json",
    `${entry.label} create output`,
  );
  const pluginDir = resolve(pluginsDir, entry.dir);
  const pkg = readJson(resolve(pluginDir, "package.json"), `${entry.label} package.json`);
  const tsconfig = readJson(resolve(pluginDir, "tsconfig.json"), `${entry.label} tsconfig.json`);

  if (pkg.name !== entry.packageName) {
    fail(
      `${entry.label} package name drifted`,
      `expected ${entry.packageName}\nactual ${pkg.name}`,
    );
  }
  for (const [name, range] of Object.entries(expectedPluginRanges)) {
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

for (const entry of themeMatrix) {
  const createOutput = run(`create ${entry.label}`, entry.args, { cwd: entry.cwd ?? themesDir });
  assertIncludes(
    createOutput,
    `pnpm --filter ${entry.packageName} build`,
    `${entry.label} create output`,
  );
  assertIncludes(
    createOutput,
    `pnpm exec nexpress theme add ${entry.packageName} --yes`,
    `${entry.label} create output`,
  );
  assertIncludes(
    createOutput,
    "Activate it in admin -> Settings -> Theme",
    `${entry.label} create output`,
  );

  const themeDir = resolve(themesDir, entry.dir);
  const pkg = readJson(resolve(themeDir, "package.json"), `${entry.label} package.json`);
  const tsconfig = readJson(resolve(themeDir, "tsconfig.json"), `${entry.label} tsconfig.json`);

  if (pkg.name !== entry.packageName) {
    fail(
      `${entry.label} package name drifted`,
      `expected ${entry.packageName}\nactual ${pkg.name}`,
    );
  }
  for (const [name, range] of Object.entries(expectedThemeRanges)) {
    if (pkg.dependencies?.[name] !== range) {
      fail(
        `${entry.label} did not inherit ${name} dependency range`,
        `expected: ${range}\nactual: ${pkg.dependencies?.[name] ?? "(missing)"}`,
      );
    }
  }
  if (pkg.dependencies?.["@nexpress/plugin-sdk"]) {
    fail("theme scaffold should not depend on @nexpress/plugin-sdk", JSON.stringify(pkg, null, 2));
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
}
console.log(
  `✓ generated extension packages: ${[...pluginMatrix, ...themeMatrix]
    .map((entry) => entry.packageName)
    .join(", ")}`,
);

run("install generated extension workspaces", ["install", "--no-frozen-lockfile"], {
  timeout: 180_000,
});

for (const entry of [...pluginMatrix, ...themeMatrix]) {
  run(`${entry.label} typecheck`, ["--filter", entry.packageName, "typecheck"]);
  run(`${entry.label} build`, ["--filter", entry.packageName, "build"], { timeout: 180_000 });
}
console.log("✓ generated extension packages typecheck and build");

for (const entry of pluginMatrix) {
  const addOutput = run(
    `register ${entry.label}`,
    ["exec", "nexpress", "plugin", "add", entry.packageName],
    {
      timeout: 180_000,
    },
  );
  assertIncludes(addOutput, `✓ Installed ${entry.packageName}.`, `${entry.label} add output`);
  assertIncludes(addOutput, "Restart your dev server or redeploy", `${entry.label} add output`);
  assertIncludes(
    addOutput,
    "pnpm --silent run ops:plugins -- doctor --json",
    `${entry.label} add output`,
  );
}
const registeredPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
for (const entry of pluginMatrix) {
  if (registeredPkg.dependencies?.[entry.packageName] !== "workspace:*") {
    fail(
      `${entry.label} registration should add the workspace dependency`,
      `actual: ${registeredPkg.dependencies?.[entry.packageName] ?? "(missing)"}`,
    );
  }
}
const configSource = readFileSync(resolve(scaffoldDir, "src/nexpress.config.ts"), "utf8");
for (const entry of pluginMatrix) {
  const identifier = pluginIdentifier(entry.packageName);
  assertIncludes(
    configSource,
    `import ${identifier} from "${entry.packageName}";`,
    "nexpress.config.ts",
  );
  assertIncludes(configSource, `${identifier},`, "nexpress.config.ts");
}

const registeredDoctor = parseJsonOutput(
  run(
    "doctor after generated local plugin registration",
    ["--silent", "run", "ops:plugins", "--", "doctor", "--json"],
    { timeout: 180_000 },
  ),
  "ops:plugins doctor after registration",
);
if (registeredDoctor.ok !== true) {
  fail(
    "ops:plugins doctor should pass after generated plugin registration",
    JSON.stringify(registeredDoctor, null, 2),
  );
}
const registeredIds = new Set(registeredDoctor.plugins?.map((plugin) => plugin.id) ?? []);
for (const entry of pluginMatrix) {
  if (!registeredIds.has(entry.dir)) {
    fail(
      `ops:plugins doctor did not include ${entry.label}`,
      JSON.stringify(registeredDoctor, null, 2),
    );
  }
}
console.log("✓ generated local plugins register and pass ops:plugins doctor");

for (const entry of pluginMatrix) {
  const removeOutput = run(
    `remove ${entry.label}`,
    ["exec", "nexpress", "plugin", "remove", entry.packageName],
    {
      timeout: 180_000,
    },
  );
  assertIncludes(removeOutput, `✓ Removed ${entry.packageName}.`, `${entry.label} remove output`);
  assertIncludes(removeOutput, "boot-time plugin code unloads", `${entry.label} remove output`);
  assertIncludes(
    removeOutput,
    "pnpm --silent run ops:plugins -- doctor --json",
    `${entry.label} remove output`,
  );
}

const removedPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
const removedConfigSource = readFileSync(resolve(scaffoldDir, "src/nexpress.config.ts"), "utf8");
for (const entry of pluginMatrix) {
  const identifier = pluginIdentifier(entry.packageName);
  if (removedPkg.dependencies?.[entry.packageName]) {
    fail(
      `${entry.label} removal should delete the root dependency`,
      JSON.stringify(removedPkg, null, 2),
    );
  }
  if (
    removedConfigSource.includes(`from "${entry.packageName}"`) ||
    removedConfigSource.includes(`${identifier},`)
  ) {
    fail(`${entry.label} removal should unregister config entries`, removedConfigSource);
  }
}

const removedDoctor = parseJsonOutput(
  run(
    "doctor after generated local plugin removal",
    ["--silent", "run", "ops:plugins", "--", "doctor", "--json"],
    { timeout: 180_000 },
  ),
  "ops:plugins doctor after removal",
);
if (removedDoctor.ok !== true) {
  fail(
    "ops:plugins doctor should pass after generated plugin removal",
    JSON.stringify(removedDoctor, null, 2),
  );
}
const removedIds = new Set(removedDoctor.plugins?.map((plugin) => plugin.id) ?? []);
for (const entry of pluginMatrix) {
  if (removedIds.has(entry.dir)) {
    fail(
      `ops:plugins doctor still includes removed ${entry.label}`,
      JSON.stringify(removedDoctor, null, 2),
    );
  }
}
console.log("✓ generated local plugins remove cleanly and pass ops:plugins doctor");

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

for (const entry of themeMatrix) {
  const addOutput = run(
    `register ${entry.label}`,
    ["exec", "nexpress", "theme", "add", entry.packageName, "--yes"],
    {
      timeout: 180_000,
    },
  );
  assertIncludes(addOutput, "Detected local workspace theme", `${entry.label} add output`);
  assertIncludes(addOutput, "Registered", `${entry.label} add output`);
  assertIncludes(addOutput, themeIdentifier(entry.packageName), `${entry.label} add output`);
}
const themeRegisteredPkg = readJson(resolve(scaffoldDir, "package.json"), "scaffold package.json");
const themeConfigSource = readFileSync(resolve(scaffoldDir, "src/nexpress.config.ts"), "utf8");
for (const entry of themeMatrix) {
  const identifier = themeIdentifier(entry.packageName);
  if (themeRegisteredPkg.dependencies?.[entry.packageName] !== "workspace:*") {
    fail(
      `${entry.label} registration should add the workspace dependency`,
      `actual: ${themeRegisteredPkg.dependencies?.[entry.packageName] ?? "(missing)"}`,
    );
  }
  assertIncludes(
    themeConfigSource,
    `import { ${identifier} } from "${entry.packageName}";`,
    "nexpress.config.ts",
  );
  assertIncludes(themeConfigSource, `${identifier},`, "nexpress.config.ts");
}
console.log("✓ generated local themes register through theme add");
