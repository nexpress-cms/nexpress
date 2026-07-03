import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildPackageManagerArgs,
  findLocalWorkspacePackageDir,
  inspectLocalWorkspacePackage,
  missingLocalPackageBuildArtifacts,
} from "./package-manager.js";

describe("package manager helpers", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), "nexpress-package-manager-"));
    await mkdir(join(workdir, "packages/plugins/smoke-hook"), { recursive: true });
    await mkdir(join(workdir, "packages/plugins/banner"), { recursive: true });
    await mkdir(join(workdir, "packages/plugins/broken"), { recursive: true });
    await mkdir(join(workdir, "packages/themes/newsroom"), { recursive: true });
    await mkdir(join(workdir, "packages/themes/broken-theme"), { recursive: true });
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
    await writeFile(join(workdir, "packages/themes/broken-theme/package.json"), "{", "utf-8");
    await writeFile(
      join(workdir, "packages/themes/newsroom/package.json"),
      JSON.stringify({
        name: "theme-newsroom",
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
        main: "./dist/index.js",
      }),
    );
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  describe("buildPackageManagerArgs", () => {
    it("adds local pnpm workspace packages through workspace:* at the workspace root", () => {
      expect(
        buildPackageManagerArgs("pnpm", "add", "smoke-hook", {
          localWorkspace: true,
          workspaceRoot: true,
        }),
      ).toEqual(["add", "smoke-hook@workspace:*", "-w"]);
    });

    it("adds remote pnpm packages explicitly to the workspace root", () => {
      expect(
        buildPackageManagerArgs("pnpm", "add", "@acme/plugin-seo", { workspaceRoot: true }),
      ).toEqual(["add", "@acme/plugin-seo", "-w"]);
    });

    it("removes pnpm packages explicitly from the workspace root", () => {
      expect(
        buildPackageManagerArgs("pnpm", "remove", "smoke-hook", { workspaceRoot: true }),
      ).toEqual(["remove", "smoke-hook", "-w"]);
    });

    it("does not apply pnpm workspace options to other package managers", () => {
      expect(buildPackageManagerArgs("npm", "add", "smoke-hook", { localWorkspace: true })).toEqual(
        ["install", "smoke-hook"],
      );
      expect(
        buildPackageManagerArgs("yarn", "add", "smoke-hook", { localWorkspace: true }),
      ).toEqual(["add", "smoke-hook"]);
    });
  });

  describe("findLocalWorkspacePackageDir", () => {
    it("finds local extension packages by package.json name", () => {
      expect(findLocalWorkspacePackageDir(workdir, "smoke-hook", ["packages/plugins"])).toBe(
        join(workdir, "packages/plugins/smoke-hook"),
      );
      expect(findLocalWorkspacePackageDir(workdir, "@acme/banner", ["packages/plugins"])).toBe(
        join(workdir, "packages/plugins/banner"),
      );
      expect(findLocalWorkspacePackageDir(workdir, "theme-newsroom", ["packages/themes"])).toBe(
        join(workdir, "packages/themes/newsroom"),
      );
    });

    it("ignores unrelated malformed local plugin packages", () => {
      expect(findLocalWorkspacePackageDir(workdir, "missing", ["packages/plugins"])).toBeNull();
    });

    it("reports malformed local package candidates instead of falling through to npm", () => {
      expect(inspectLocalWorkspacePackage(workdir, "broken", ["packages/plugins"])).toMatchObject({
        kind: "malformed",
        packageJsonPath: join(workdir, "packages/plugins/broken/package.json"),
      });
      expect(
        inspectLocalWorkspacePackage(workdir, "theme-broken-theme", ["packages/themes"]),
      ).toMatchObject({
        kind: "malformed",
        packageJsonPath: join(workdir, "packages/themes/broken-theme/package.json"),
      });
    });
  });

  describe("missingLocalPackageBuildArtifacts", () => {
    it("reports generated dist entrypoints that have not been built yet", () => {
      expect(
        missingLocalPackageBuildArtifacts(workdir, {
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
        missingLocalPackageBuildArtifacts(packageDir, {
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
