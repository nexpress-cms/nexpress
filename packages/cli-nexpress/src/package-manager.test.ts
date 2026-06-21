import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildPackageManagerArgs,
  findLocalPluginWorkspaceDir,
  inspectLocalPluginWorkspace,
  missingLocalPluginBuildArtifacts,
} from "./package-manager.js";

describe("package manager helpers", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-package-manager-"));
    await mkdir(join(workdir, "packages/plugins/smoke-hook"), { recursive: true });
    await mkdir(join(workdir, "packages/plugins/banner"), { recursive: true });
    await mkdir(join(workdir, "packages/plugins/broken"), { recursive: true });
    await writeFile(
      join(workdir, "packages/plugins/smoke-hook/package.json"),
      JSON.stringify({
        name: "smoke-hook",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
        main: "./dist/index.js",
      }),
    );
    await writeFile(
      join(workdir, "packages/plugins/banner/package.json"),
      JSON.stringify({ name: "@acme/banner" }),
    );
    await writeFile(join(workdir, "packages/plugins/broken/package.json"), "{", "utf-8");
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe("buildPackageManagerArgs", () => {
    it("adds local pnpm workspace packages with --workspace", () => {
      expect(
        buildPackageManagerArgs("pnpm", "add", "smoke-hook", { localWorkspace: true }),
      ).toEqual(["add", "smoke-hook", "--workspace"]);
    });

    it("does not apply the workspace flag to pnpm remove or other package managers", () => {
      expect(
        buildPackageManagerArgs("pnpm", "remove", "smoke-hook", { localWorkspace: true }),
      ).toEqual(["remove", "smoke-hook"]);
      expect(buildPackageManagerArgs("npm", "add", "smoke-hook", { localWorkspace: true })).toEqual(
        ["install", "smoke-hook"],
      );
      expect(
        buildPackageManagerArgs("yarn", "add", "smoke-hook", { localWorkspace: true }),
      ).toEqual(["add", "smoke-hook"]);
    });
  });

  describe("findLocalPluginWorkspaceDir", () => {
    it("finds local plugin packages by package.json name", () => {
      expect(findLocalPluginWorkspaceDir(workdir, "smoke-hook")).toBe(
        join(workdir, "packages/plugins/smoke-hook"),
      );
      expect(findLocalPluginWorkspaceDir(workdir, "@acme/banner")).toBe(
        join(workdir, "packages/plugins/banner"),
      );
    });

    it("ignores unrelated malformed local plugin packages", () => {
      expect(findLocalPluginWorkspaceDir(workdir, "missing")).toBeNull();
    });

    it("reports malformed local package candidates instead of falling through to npm", () => {
      expect(inspectLocalPluginWorkspace(workdir, "broken")).toMatchObject({
        kind: "malformed",
        packageJsonPath: join(workdir, "packages/plugins/broken/package.json"),
      });
    });
  });

  describe("missingLocalPluginBuildArtifacts", () => {
    it("reports generated dist entrypoints that have not been built yet", () => {
      expect(
        missingLocalPluginBuildArtifacts(workdir, {
          exports: {
            ".": {
              import: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
          },
          main: "./dist/index.js",
        }),
      ).toEqual(["./dist/index.js"]);
    });

    it("allows local packages once their runtime dist entrypoint exists", async () => {
      const packageDir = join(workdir, "packages/plugins/smoke-hook");
      await mkdir(join(packageDir, "dist"), { recursive: true });
      await writeFile(join(packageDir, "dist/index.js"), "export default {};\n");

      expect(
        missingLocalPluginBuildArtifacts(packageDir, {
          exports: {
            ".": {
              import: "./dist/index.js",
            },
          },
        }),
      ).toEqual([]);
    });
  });
});
