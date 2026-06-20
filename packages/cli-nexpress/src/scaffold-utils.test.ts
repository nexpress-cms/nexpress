import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  basePackageJson,
  baseTsconfig,
  resolveScaffoldDependencyRanges,
  resolveTsconfigExtends,
} from "./scaffold-utils.js";

describe("scaffold utils", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-scaffold-utils-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("defaults generated plugin framework deps to workspace links", () => {
    const pkg = JSON.parse(basePackageJson("demo-plugin", "Demo plugin")) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies["@nexpress/blocks"]).toBe("workspace:*");
    expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBe("workspace:*");
  });

  it("lets callers override generated framework dependency ranges", () => {
    const pkg = JSON.parse(
      basePackageJson("demo-plugin", "Demo plugin", {
        dependencyRanges: {
          "@nexpress/blocks": "file:/tmp/nexpress-blocks-0.4.0.tgz",
          "@nexpress/plugin-sdk": "0.4.0",
        },
      }),
    ) as { dependencies: Record<string, string> };

    expect(pkg.dependencies["@nexpress/blocks"]).toBe("file:/tmp/nexpress-blocks-0.4.0.tgz");
    expect(pkg.dependencies["@nexpress/plugin-sdk"]).toBe("0.4.0");
  });

  it("reads installed framework ranges from the nearest parent package.json", async () => {
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@nexpress/blocks": "0.4.1",
        },
        devDependencies: {
          "@nexpress/plugin-sdk": "file:/tmp/nexpress-plugin-sdk-0.4.1.tgz",
        },
      }),
    );
    const nested = join(workdir, "packages", "plugins");
    await mkdir(nested, { recursive: true });

    expect(resolveScaffoldDependencyRanges(nested)).toEqual({
      "@nexpress/blocks": "0.4.1",
      "@nexpress/plugin-sdk": "file:/tmp/nexpress-plugin-sdk-0.4.1.tgz",
    });
  });

  it("returns no overrides when no parent package declares framework deps", async () => {
    await writeFile(join(workdir, "package.json"), JSON.stringify({ name: "outer" }));

    expect(resolveScaffoldDependencyRanges(workdir)).toEqual({});
  });

  it("does not search above a project workspace boundary", async () => {
    await writeFile(
      join(workdir, "package.json"),
      JSON.stringify({
        dependencies: {
          "@nexpress/blocks": "9.9.9",
          "@nexpress/plugin-sdk": "9.9.9",
        },
      }),
    );

    const project = join(workdir, "site");
    await mkdir(join(project, "packages", "plugins"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ name: "site" }));
    await writeFile(join(project, "pnpm-workspace.yaml"), "packages: []\n");

    expect(resolveScaffoldDependencyRanges(join(project, "packages", "plugins"))).toEqual({});
  });

  it("resolves plugin tsconfig extends to a parent tsconfig.base.json", async () => {
    await writeFile(join(workdir, "tsconfig.base.json"), "{}");
    const pluginDir = join(workdir, "packages", "plugins", "demo");
    await mkdir(pluginDir, { recursive: true });

    expect(resolveTsconfigExtends(pluginDir)).toBe("../../../tsconfig.base.json");
  });

  it("does not extend a create-nexpress root app tsconfig.json", async () => {
    await writeFile(join(workdir, "tsconfig.json"), "{}");
    const pluginDir = join(workdir, "packages", "plugins", "demo");
    await mkdir(pluginDir, { recursive: true });

    expect(resolveTsconfigExtends(pluginDir)).toBeUndefined();
  });

  it("emits a self-contained plugin tsconfig when no base config is available", () => {
    const tsconfig = JSON.parse(baseTsconfig()) as {
      extends?: string;
      compilerOptions: Record<string, unknown>;
    };

    expect(tsconfig.extends).toBeUndefined();
    expect(tsconfig.compilerOptions.module).toBe("NodeNext");
    expect(tsconfig.compilerOptions.moduleResolution).toBe("NodeNext");
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });
});
