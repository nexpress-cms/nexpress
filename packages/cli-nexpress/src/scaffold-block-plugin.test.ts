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
    await expect(
      scaffoldBlockPlugin({ slug: "duplicate", outDir: workdir }),
    ).rejects.toThrow(/Refusing to overwrite/);
  });
});
