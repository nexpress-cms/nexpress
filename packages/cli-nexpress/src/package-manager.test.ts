import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPackageManagerArgs,
  inspectLocalWorkspacePackage,
  missingLocalPackageBuildArtifacts,
} from "./package-manager.js";

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
    expect(buildPackageManagerArgs("npm", "add", "smoke-hook", { localWorkspace: true })).toEqual([
      "install",
      "smoke-hook",
    ]);
    expect(buildPackageManagerArgs("yarn", "add", "smoke-hook", { localWorkspace: true })).toEqual([
      "add",
      "smoke-hook",
    ]);
  });
});

describe("inspectLocalWorkspacePackage", () => {
  it("finds packages by manifest name and distinguishes missing from malformed candidates", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "nexpress-package-manager-"));
    try {
      for (const [directory, name] of [
        ["plugins/smoke-hook", "smoke-hook"],
        ["plugins/banner", "@acme/banner"],
        ["themes/newsroom", "theme-newsroom"],
        ["plugins/broken", null],
        ["themes/broken-theme", null],
      ]) {
        const packageDir = join(workdir, `packages/${directory}`);
        await mkdir(packageDir, { recursive: true });
        await writeFile(join(packageDir, "package.json"), name ? JSON.stringify({ name }) : "{");
      }
      for (const [name, root, directory] of [
        ["smoke-hook", "plugins", "smoke-hook"],
        ["@acme/banner", "plugins", "banner"],
        ["theme-newsroom", "themes", "newsroom"],
      ]) {
        expect(
          inspectLocalWorkspacePackage(workdir, name, [`packages/${root}`]),
          name,
        ).toMatchObject({
          kind: "found",
          dir: join(workdir, `packages/${root}/${directory}`),
          packageJson: { name },
        });
      }
      expect(inspectLocalWorkspacePackage(workdir, "missing", ["packages/plugins"])).toEqual({
        kind: "missing",
      });
      for (const [name, root, directory] of [
        ["broken", "plugins", "broken"],
        ["theme-broken-theme", "themes", "broken-theme"],
      ]) {
        expect(
          inspectLocalWorkspacePackage(workdir, name, [`packages/${root}`]),
          name,
        ).toMatchObject({
          kind: "malformed",
          packageJsonPath: join(workdir, `packages/${root}/${directory}/package.json`),
        });
      }
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});

describe("missingLocalPackageBuildArtifacts", () => {
  it("reports runtime entrypoints until they have been built", async () => {
    const packageDir = await mkdtemp(join(tmpdir(), "nexpress-package-artifacts-"));
    const packageJson = {
      exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      main: "./dist/index.js",
    };
    try {
      expect(missingLocalPackageBuildArtifacts(packageDir, packageJson)).toEqual([
        "./dist/index.js",
      ]);
      await mkdir(join(packageDir, "dist"));
      await writeFile(join(packageDir, "dist/index.js"), "export default {};\n");
      expect(missingLocalPackageBuildArtifacts(packageDir, packageJson)).toEqual([]);
    } finally {
      await rm(packageDir, { recursive: true, force: true });
    }
  });
});
