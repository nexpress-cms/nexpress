import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPackageManagerArgs, findLocalPluginWorkspaceDir } from "./package-manager.js";

describe("package manager helpers", () => {
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
    let workdir: string;

    beforeEach(async () => {
      workdir = await mkdtemp(join(tmpdir(), "nexpress-package-manager-"));
      await mkdir(join(workdir, "packages/plugins/smoke-hook"), { recursive: true });
      await mkdir(join(workdir, "packages/plugins/banner"), { recursive: true });
      await mkdir(join(workdir, "packages/plugins/broken"), { recursive: true });
      await writeFile(
        join(workdir, "packages/plugins/smoke-hook/package.json"),
        JSON.stringify({ name: "smoke-hook" }),
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

    it("finds local plugin packages by package.json name", () => {
      expect(findLocalPluginWorkspaceDir(workdir, "smoke-hook")).toBe(
        join(workdir, "packages/plugins/smoke-hook"),
      );
      expect(findLocalPluginWorkspaceDir(workdir, "@acme/banner")).toBe(
        join(workdir, "packages/plugins/banner"),
      );
    });

    it("ignores missing or malformed local plugin packages", () => {
      expect(findLocalPluginWorkspaceDir(workdir, "missing")).toBeNull();
    });
  });
});
