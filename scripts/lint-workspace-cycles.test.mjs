import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import rootConfig from "../eslint.config.mjs";

const importConfig = rootConfig.find(
  (config) => config.plugins?.["import-x"] && config.rules?.["import-x/no-cycle"],
);
assert.ok(importConfig, "The root import-x rule configuration must exist");

function linter(cwd, includeExternal = false) {
  const rules = { ...importConfig.rules };
  if (includeExternal) {
    const configured = rules["import-x/no-cycle"];
    const [severity, options = {}] = Array.isArray(configured) ? configured : [configured];
    rules["import-x/no-cycle"] = [severity, { ...options, ignoreExternal: false }];
  }
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.js"],
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        plugins: importConfig.plugins,
        settings: importConfig.settings,
        rules,
      },
    ],
  });
}

async function fixture() {
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "np-lint-workspace-cycles-")));
  async function write(relativePath, content) {
    const filename = path.join(cwd, relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content, { flag: "wx" });
  }
  try {
    await write("package.json", JSON.stringify({ name: "np-cycle-fixture", type: "module" }));
    await write(
      "src/local-a.js",
      'import { b } from "./local-b.js"; export function a() { return b; }\n',
    );
    await write(
      "src/local-b.js",
      'import { a } from "./local-a.js"; export function b() { return a; }\n',
    );
    const workspaces = [
      ["a", "@nexpress/lint-cycle-a", "a", "create-nexpress", "b"],
      ["create", "create-nexpress", "b", "nexpress", "c"],
      ["root", "nexpress", "c", "@nexpress/lint-cycle-a", "a"],
    ];
    for (const [directory, name, exported, dependency, imported] of workspaces) {
      await write(
        `packages/${directory}/package.json`,
        JSON.stringify({ name, type: "module", exports: "./index.js" }),
      );
      await write(
        `packages/${directory}/index.js`,
        `import { ${imported} } from "${dependency}"; export function ${exported}() { return ${imported}; }\n`,
      );
      const link = path.join(cwd, "node_modules", name);
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(path.join(cwd, "packages", directory), link, "dir");
    }
    await write(
      "src/vendor-root.js",
      'import { external } from "foreign-cycle"; export function local() { return external; }\n',
    );
    await write(
      "node_modules/foreign-cycle/package.json",
      JSON.stringify({ name: "foreign-cycle", type: "module", exports: "./index.js" }),
    );
    await write(
      "node_modules/foreign-cycle/index.js",
      'import { local } from "../../src/vendor-root.js"; export function external() { return local; }\n',
    );
    await write("src/leaf.js", "export const leaf = 1;\n");
    await write("src/acyclic.js", 'import { leaf } from "./leaf.js"; export const value = leaf;\n');
    return { cwd, dispose: () => rm(cwd, { recursive: true, force: true }) };
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

test("the root rule rejects relative and linked workspace cycles for every repository package name", async () => {
  const f = await fixture();
  try {
    const files = [
      "src/local-a.js",
      "src/local-b.js",
      "packages/a/index.js",
      "packages/create/index.js",
      "packages/root/index.js",
    ];
    const results = await linter(f.cwd).lintFiles(files);
    assert.equal(results.length, files.length);
    for (const result of results) {
      assert.equal(result.fatalErrorCount, 0);
      assert.equal(result.errorCount, 1, path.relative(f.cwd, result.filePath));
      assert.equal(result.messages[0].ruleId, "import-x/no-cycle");
      assert.equal(result.messages[0].severity, 2);
    }
  } finally {
    await f.dispose();
  }
});

test("the root rule excludes cycles through foreign packages and accepts acyclic repository imports", async () => {
  const f = await fixture();
  try {
    const results = await linter(f.cwd).lintFiles(["src/vendor-root.js", "src/acyclic.js"]);
    assert.equal(results.length, 2);
    for (const result of results) assert.deepEqual(result.messages, []);

    // Prove that the foreign-package case is a resolved cycle, not an unresolved import.
    const [traversed] = await linter(f.cwd, true).lintFiles(["src/vendor-root.js"]);
    assert.equal(traversed.fatalErrorCount, 0);
    assert.equal(traversed.errorCount, 1);
    assert.equal(traversed.messages[0].ruleId, "import-x/no-cycle");
  } finally {
    await f.dispose();
  }
});
