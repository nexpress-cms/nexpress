import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test(
  "development watch rebuilds source and reloads dependency/config inputs without erasing declarations",
  { timeout: 45_000 },
  async (t) => {
    const capsule = await mkdtemp(join(tmpdir(), "nexpress-watch-"));
    let child;
    let closed;
    t.after(async () => {
      if (child?.pid) {
        const kill = (signal) => {
          if (process.platform === "win32") {
            if (child.exitCode === null && child.signalCode === null)
              spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { timeout: 5_000 });
          } else {
            try {
              process.kill(-child.pid, signal);
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
          }
        };
        kill("SIGTERM");
        const deadline = setTimeout(() => kill("SIGKILL"), 2_000);
        deadline.unref();
        try {
          await closed;
          // A shell can exit before its compiler descendants finish teardown.
          kill("SIGKILL");
        } finally {
          clearTimeout(deadline);
        }
      }
      await rm(capsule, { recursive: true, force: true });
    });
    const cwd = join(capsule, "packages/admin");
    const manifest = JSON.parse(await readFile(join(root, "packages/admin/package.json"), "utf8"));
    await Promise.all(
      [
        "scripts",
        "packages/admin/src",
        "packages/admin/dist",
        "packages/admin/node_modules/library",
      ].map((path) => mkdir(join(capsule, path), { recursive: true })),
    );
    await copyFile(
      join(root, "scripts/build-dev-package.mjs"),
      join(capsule, "scripts/build-dev-package.mjs"),
    );
    const packageRequire = createRequire(join(root, "packages/admin/package.json"));
    for (const name of ["tsup", "typescript"])
      await symlink(
        dirname(dirname(packageRequire.resolve(name))),
        join(cwd, "node_modules", name),
        process.platform === "win32" ? "junction" : "dir",
      );
    const pkg = { name: "np-watch-fixture", type: "module", dependencies: {} };
    const json = (path, value) => writeFile(path, JSON.stringify(value));
    const base = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        ignoreDeprecations: "6.0",
        jsx: "react",
        jsxFactory: "oldJsx",
      },
    };
    const config = (
      value,
      dts = false,
    ) => `import { defineConfig } from 'tsup'; export default defineConfig([
    { entry: { index: 'src/index.ts' }, format: ['esm'], dts: ${dts}, define: { CONFIG: '${JSON.stringify(value)}' } },
    { entry: { client: 'src/client.tsx' }, format: ['esm'], dts: ${dts}, define: { CONFIG: '${JSON.stringify(value)}' }, banner: { js: '\"use client\";' } }
  ]);`;
    const shared = (value) =>
      `export const source = ${JSON.stringify(value)}; export { dependency } from 'library';`;
    await Promise.all([
      json(join(cwd, "package.json"), pkg),
      json(join(capsule, "tsconfig.base.json"), base),
      json(join(cwd, "tsconfig.json"), { extends: "../../tsconfig.base.json" }),
      json(join(cwd, "node_modules/library/package.json"), {
        name: "library",
        type: "module",
        exports: "./index.js",
        types: "./index.d.ts",
      }),
      writeFile(join(cwd, "node_modules/library/index.js"), "export const dependency = 'bundled';"),
      writeFile(join(cwd, "node_modules/library/index.d.ts"), "export const dependency: string;"),
      writeFile(join(cwd, "tsup.config.ts"), config("first")),
      writeFile(join(cwd, "src/shared.ts"), shared("initial")),
      writeFile(
        join(cwd, "src/index.ts"),
        "declare const CONFIG: string; export * from './shared.js'; export const config = CONFIG;",
      ),
      writeFile(
        join(cwd, "src/client.tsx"),
        `declare const CONFIG: string; export * from './shared.js'; export const config = CONFIG;
      declare global { namespace JSX { interface IntrinsicElements { widget: object; } } }
      const oldJsx = (tag: string) => 'old:' + tag, newJsx = (tag: string) => 'new:' + tag, ownJsx = (tag: string) => 'own:' + tag;
      export const rendered = <widget />;`,
      ),
      writeFile(join(cwd, "dist/index.d.ts"), "// retained server declaration\n"),
      writeFile(join(cwd, "dist/client.d.ts"), "// retained client declaration\n"),
    ]);
    child = spawn(manifest.scripts.dev, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        PATH: [
          dirname(process.execPath),
          join(root, "node_modules/.bin"),
          process.env.PATH ?? "",
        ].join(delimiter),
        NP_DEV_FAST: "1",
        NP_ROOT_ENV_PATH: "",
        NP_ENABLE_JOBS: "0",
        NP_EMAIL_ADAPTER: "noop",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        output = (output + data.toString()).slice(-12_000);
      });
    closed = once(child, "close");
    const load = (entry) =>
      import(`${pathToFileURL(join(cwd, `dist/${entry}.js`)).href}?read=${Math.random()}`);
    async function until(label, check) {
      const deadline = performance.now() + 8_000;
      while (performance.now() < deadline && !t.signal.aborted) {
        if (child.exitCode !== null || child.signalCode !== null)
          assert.fail(`Watcher exited during ${label}: ${output}`);
        try {
          if (await check()) return;
        } catch {
          /* An in-progress output is not a completed build. */
        }
        await delay(40, undefined, { signal: t.signal });
      }
      assert.fail(`Watch did not complete ${label}: ${output}`);
    }
    const both = async (check) => check(await load("index")) && check(await load("client"));
    await until(
      "initial entries",
      () =>
        output.match(/Build success/g)?.length >= 2 &&
        both(
          (value) =>
            value.source === "initial" &&
            value.dependency === "bundled" &&
            value.config === "first",
        ),
    );
    const completed = output.match(/Build success/g).length;
    await delay(500, undefined, { signal: t.signal });
    assert.equal(
      output.match(/Build success/g).length,
      completed,
      "Build output must not restart its watcher",
    );
    await writeFile(join(cwd, "src/shared.ts"), "export const = ;");
    await until("recoverable build failure", async () => /Build failed/.test(output));
    await writeFile(join(cwd, "src/shared.ts"), shared("changed"));
    await until("source recovery", () => both((value) => value.source === "changed"));

    // A new manifest dependency must be externalized by a fresh builder, not the
    // previous process's cached package.json. Its file is deliberately not watched.
    await writeFile(
      join(cwd, "node_modules/library/index.js"),
      "export const dependency = 'external';",
    );
    pkg.dependencies.library = "1.0.0";
    await json(join(cwd, "package.json"), pkg);
    await until("dependency externalization", async () => {
      const files = await Promise.all(
        ["index", "client"].map((entry) => readFile(join(cwd, `dist/${entry}.js`), "utf8")),
      );
      return (
        files.every((file) => /from ["']library["']/.test(file)) &&
        (await both((value) => value.dependency === "external"))
      );
    });
    await writeFile(
      join(cwd, "node_modules/library/index.js"),
      "export const dependency = 'fresh';",
    );
    delete pkg.dependencies.library;
    await json(join(cwd, "package.json"), pkg);
    await until("dependency removal", () => both((value) => value.dependency === "fresh"));
    await writeFile(join(cwd, "tsup.config.ts"), config("second"));
    await until("builder config reload", () => both((value) => value.config === "second"));
    base.compilerOptions.jsxFactory = "newJsx";
    await json(join(capsule, "tsconfig.base.json"), base);
    await until(
      "inherited compiler config reload",
      async () => (await load("client")).rendered === "new:widget",
    );
    await json(join(cwd, "tsconfig.json"), {
      extends: "../../tsconfig.base.json",
      compilerOptions: { jsxFactory: "ownJsx" },
    });
    await until(
      "package compiler config reload",
      async () => (await load("client")).rendered === "own:widget",
    );
    assert.match(await readFile(join(cwd, "dist/client.js"), "utf8"), /^"use client";/);
    assert.equal(
      await readFile(join(cwd, "dist/index.d.ts"), "utf8"),
      "// retained server declaration\n",
    );
    assert.equal(
      await readFile(join(cwd, "dist/client.d.ts"), "utf8"),
      "// retained client declaration\n",
    );
    await writeFile(join(cwd, "tsup.config.ts"), config("second", true));
    await until("full declaration build", async () => {
      const declarations = await Promise.all(
        ["index", "client"].map((entry) => readFile(join(cwd, `dist/${entry}.d.ts`), "utf8")),
      );
      return (
        declarations.every((value) => /["']changed["']/.test(value)) &&
        output.match(/DTS.*Build success/g)?.length >= 2
      );
    });
    const fullCompleted = output.match(/Build success/g).length;
    await delay(500, undefined, { signal: t.signal });
    assert.equal(
      output.match(/Build success/g).length,
      fullCompleted,
      "Temporary config imports must not restart declaration workers",
    );
  },
);
