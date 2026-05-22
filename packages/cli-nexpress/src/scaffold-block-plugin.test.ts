import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scaffoldBlockPlugin } from "./scaffold-block-plugin.js";

describe("scaffoldBlockPlugin", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-scaffold-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("writes the expected file set into a fresh directory", async () => {
    const result = await scaffoldBlockPlugin({ slug: "my-callout", outDir: workdir });

    // The files list is what the CLI prints to the operator. Stable so
    // the next-steps message stays accurate.
    expect(result.files.sort()).toEqual([
      "README.md",
      "package.json",
      "src/index.tsx",
      "tsconfig.json",
      "tsup.config.ts",
    ]);
    expect(result.pluginDir.endsWith("my-callout")).toBe(true);
  });

  it("derives package + identifier names from the slug consistently", async () => {
    const result = await scaffoldBlockPlugin({ slug: "my-callout", outDir: workdir });

    const pkg = JSON.parse(await readFile(join(result.pluginDir, "package.json"), "utf-8")) as {
      name: string;
      dependencies: Record<string, string>;
    };
    // Unscoped slug → exactly the slug as the package name.
    expect(pkg.name).toBe("my-callout");
    expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBe("workspace:*");
    expect(pkg.dependencies["@nexpress/blocks"]).toBe("workspace:*");

    const source = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
    // Camel-cased export name + matching block type root.
    expect(source).toMatch(/export const myCalloutPlugin = definePlugin\(/);
    expect(source).toMatch(/type: "myCallout\.example"/);
  });

  it("keeps static block package metadata aligned with the shared plugin baseline", async () => {
    const result = await scaffoldBlockPlugin({ slug: "baseline-block", outDir: workdir });
    const pkg = JSON.parse(await readFile(join(result.pluginDir, "package.json"), "utf-8")) as {
      files: string[];
      engines: Record<string, string>;
      exports: Record<string, { types: string; import: string }>;
      peerDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(pkg.files).toEqual(["dist"]);
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(pkg.peerDependencies.react).toBe("^19.0.0");
    expect(pkg.scripts).toEqual({
      build: "tsup",
      dev: "tsup --watch --no-clean",
      clean: "rm -rf dist",
      typecheck: "tsc --noEmit",
    });
  });

  it("preserves npm scope when the slug already has one", async () => {
    const result = await scaffoldBlockPlugin({
      slug: "@acme/banner",
      outDir: workdir,
    });

    const pkg = JSON.parse(await readFile(join(result.pluginDir, "package.json"), "utf-8")) as {
      name: string;
    };
    expect(pkg.name).toBe("@acme/banner");
    // On-disk dir name strips the scope.
    expect(result.pluginDir.endsWith("banner")).toBe(true);
  });

  it("refuses to overwrite an existing directory", async () => {
    await scaffoldBlockPlugin({ slug: "duplicate", outDir: workdir });
    await expect(scaffoldBlockPlugin({ slug: "duplicate", outDir: workdir })).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });

  it("emits an extra client entry + boundary wiring when interactive", async () => {
    const result = await scaffoldBlockPlugin({
      slug: "mixer",
      outDir: workdir,
      interactive: true,
    });

    expect(result.interactive).toBe(true);
    expect(result.files).toContain("src/client.tsx");

    // package.json gains a `./client` export so the index file can self-
    // import through the package's own subpath.
    const pkg = JSON.parse(await readFile(join(result.pluginDir, "package.json"), "utf-8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./client"]).toBeDefined();

    // tsconfig must include DOM libs for `useState` / event handler types.
    const tsconfig = JSON.parse(
      await readFile(join(result.pluginDir, "tsconfig.json"), "utf-8"),
    ) as { compilerOptions: { lib?: string[] } };
    expect(tsconfig.compilerOptions.lib).toEqual(["ES2022", "DOM", "DOM.Iterable"]);

    // tsup config carries `splitting: false` + the self-import external —
    // both are required to keep the "use client" boundary intact after
    // bundling. Hard-coding the strings here so a future refactor doesn't
    // silently strip the wiring.
    const tsup = await readFile(join(result.pluginDir, "tsup.config.ts"), "utf-8");
    expect(tsup).toContain("splitting: false");
    expect(tsup).toContain("mixer/client");

    // Source: index re-imports the form via the package's own subpath
    // (not a relative path) and `client.tsx` starts with the directive.
    const indexSrc = await readFile(join(result.pluginDir, "src/index.tsx"), "utf-8");
    expect(indexSrc).toMatch(/from "mixer\/client"/);
    const clientSrc = await readFile(join(result.pluginDir, "src/client.tsx"), "utf-8");
    expect(clientSrc.split("\n")[0]).toBe(`"use client";`);
  });

  it("static (default) mode omits the client entry", async () => {
    const result = await scaffoldBlockPlugin({ slug: "static-only", outDir: workdir });
    expect(result.interactive).toBe(false);
    expect(result.files).not.toContain("src/client.tsx");

    const pkg = JSON.parse(await readFile(join(result.pluginDir, "package.json"), "utf-8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./client"]).toBeUndefined();
  });
});
