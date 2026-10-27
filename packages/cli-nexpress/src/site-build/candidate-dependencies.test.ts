import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeSiteBuildCandidateDependenciesV1 } from "./candidate-dependencies.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-candidate-dependencies-test-")));
  roots.push(root);
  const project = join(root, "candidate"),
    dependencies = join(root, "prepared/node_modules");
  await mkdir(project);
  await writeFile(join(project, "operator.txt"), "preserved raw source\n");
  await mkdir(join(dependencies, ".pnpm/x@1/node_modules/x"), { recursive: true });
  await mkdir(join(dependencies, ".bin"));
  await mkdir(join(dependencies, "empty"));
  await writeFile(
    join(dependencies, ".pnpm/x@1/node_modules/x/index.js"),
    "export const value=1;\n",
  );
  await writeFile(join(dependencies, ".bin/fixed-tool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await symlink(".pnpm/x@1/node_modules/x", join(dependencies, "x"));
  return {
    scope: "private-build-copy" as const,
    project,
    dependencies,
    assertPreparedUnchanged: vi.fn().mockResolvedValue(undefined),
  };
}
describe("raw candidate dependency bridge", () => {
  it("copies pnpm wiring and shims into the disposable raw tree without changing source membership", async () => {
    const input = await fixture(),
      before = await readSiteSourceTreeV1(input.project);
    const result = await materializeSiteBuildCandidateDependenciesV1(input);
    expect(result.dependencies).toBe(join(input.project, "node_modules"));
    expect(await readlink(join(result.dependencies, "x"))).toBe(".pnpm/x@1/node_modules/x");
    expect(await readFile(join(result.dependencies, "x/index.js"), "utf8")).toBe(
      "export const value=1;\n",
    );
    expect((await lstat(join(result.dependencies, ".bin/fixed-tool"))).mode & 0o777).toBe(0o555);
    expect((await lstat(join(result.dependencies, "empty"))).isDirectory()).toBe(true);
    expect(await readSiteSourceTreeV1(input.project)).toEqual(before);
    await result.assertUnchanged();
    await chmod(join(result.dependencies, ".bin/fixed-tool"), 0o755);
    await writeFile(join(result.dependencies, ".bin/fixed-tool"), "changed executable\n");
    await expect(result.assertUnchanged()).rejects.toThrow();
  });
  it("rejects escaping links before creating a candidate dependency tree", async () => {
    const input = await fixture();
    await writeFile(join(input.project, "private.txt"), "outside dependency closure");
    await symlink("../../candidate/private.txt", join(input.dependencies, "escape"));
    await expect(materializeSiteBuildCandidateDependenciesV1(input)).rejects.toThrow();
    await expect(lstat(join(input.project, "node_modules"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("preserves an existing destination and removes only its own failed partial copy", async () => {
    const existing = await fixture();
    await mkdir(join(existing.project, "node_modules"));
    await writeFile(
      join(existing.project, "node_modules/operator.txt"),
      "operator dependency bytes",
    );
    await expect(materializeSiteBuildCandidateDependenciesV1(existing)).rejects.toThrow();
    expect(await readFile(join(existing.project, "node_modules/operator.txt"), "utf8")).toBe(
      "operator dependency bytes",
    );
    const partial = await fixture();
    partial.assertPreparedUnchanged
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("lease revoked"));
    await expect(materializeSiteBuildCandidateDependenciesV1(partial)).rejects.toMatchObject({
      reason: "conflict",
    });
    await expect(lstat(join(partial.project, "node_modules"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(partial.project, "operator.txt"), "utf8")).toBe(
      "preserved raw source\n",
    );
  });
});
