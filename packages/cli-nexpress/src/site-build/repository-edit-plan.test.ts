import type * as ChildProcessModule from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { linkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import {
  chmod,
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { npBuildFileDigest, type NpAgentSiteBlueprintV1 } from "@nexpress/core/agent-contract";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import {
  prepareSiteBuildRepositoryEditPlanV1,
  type NpSiteBuildPrivateRepositoryEditPlanV1,
  type NpSiteBuildRepositoryEditPlanInputV1,
} from "./repository-edit-plan.js";

const hooks = vi.hoisted(() => ({
  spawned: vi.fn(),
  beforeSpawn: vi.fn(),
  compilerMissing: false,
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcessModule>();
  return {
    ...actual,
    spawn: (executable: string, args: string[], options: SpawnOptions) => {
      hooks.beforeSpawn(executable, args, options);
      const child = actual.spawn(
        hooks.compilerMissing && executable === "/usr/bin/cc" ? "/np-no-compiler" : executable,
        args,
        options,
      );
      hooks.spawned(child, executable, args, options);
      return child;
    },
  };
});
const roots: string[] = [],
  handles: NpSiteBuildPrivateRepositoryEditPlanV1[] = [];
beforeEach(() => {
  hooks.compilerMissing = false;
  hooks.spawned.mockReset();
  hooks.beforeSpawn.mockReset();
});
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (value: string) => npBuildFileDigest("np.build-source-file.v1", Buffer.from(value));
async function fixture(update = false): Promise<NpSiteBuildRepositoryEditPlanInputV1> {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-private-edit-test-")));
  roots.push(project);
  await mkdir(join(project, "src"));
  await mkdir(join(project, ".nexpress/site/files"), { recursive: true });
  await writeFile(join(project, "src/dirty.ts"), "operator dirty source\n");
  await writeFile(join(project, ".nexpress/site/files/home.ts"), "export const page = 'new';\n");
  if (update) await writeFile(join(project, "src/home.ts"), "export const page = 'old';\n");
  const vectors = JSON.parse(
    await readFile(
      new URL("../../../core/src/build-contract/__fixtures__/canonical-v1.json", import.meta.url),
      "utf8",
    ),
  ) as { structured: Array<{ purpose: string; canonical: string }> };
  const blueprint = JSON.parse(
    vectors.structured.find((item) => item.purpose === "np.build-site-blueprint.v1")!.canonical,
  ) as NpAgentSiteBlueprintV1;
  blueprint.filePlan[0] = {
    ...blueprint.filePlan[0],
    action: update ? "update" : "create",
    expectedHash: update ? await hash("export const page = 'old';\n") : null,
    contentHash: await hash("export const page = 'new';\n"),
  };
  return {
    scope: "private-build-copy",
    project,
    blueprint,
    baseline: (await readSiteSourceTreeV1(project)).manifest,
    dirtyPaths: ["src/dirty.ts"],
  };
}
async function prepare(input: NpSiteBuildRepositoryEditPlanInputV1) {
  const result = await prepareSiteBuildRepositoryEditPlanV1(input);
  handles.push(result);
  return result;
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("bounded private repository file-plan owner", () => {
  it("creates an owned copy, preserves unrelated dirty bytes, applies only staged rows and reruns idempotently", async () => {
    const input = await fixture();
    const plan = await prepare(input);
    expect(plan.project).not.toBe(input.project);
    expect(plan.receipt).toMatchObject({
      scope: "private-build-copy",
      preservedDirtyPaths: ["src/dirty.ts"],
      deferredCommandPaths: [],
    });
    expect(await plan.apply()).toMatchObject({
      scope: "private-build-copy",
      status: "written",
      paths: ["src/home.ts"],
    });
    const inode = (await lstat(join(plan.project, "src/home.ts"))).ino;
    expect(await readFile(join(plan.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'new';\n",
    );
    expect(await readFile(join(plan.project, "src/dirty.ts"), "utf8")).toBe(
      "operator dirty source\n",
    );
    expect(await exists(join(input.project, "src/home.ts"))).toBe(false);
    expect(await plan.apply()).toMatchObject({ status: "unchanged" });
    expect((await lstat(join(plan.project, "src/home.ts"))).ino).toBe(inode);
    await plan.assertOriginalUnchanged();
    expect(
      hooks.spawned.mock.calls.every(
        ([, executable]) => executable === "/usr/bin/cc" || String(executable).endsWith("/adapter"),
      ),
    ).toBe(true);
  });

  it("preserves the reviewed executable mode while changing only the private update", async () => {
    const input = await fixture(true);
    await chmod(join(input.project, "src/home.ts"), 0o755);
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const plan = await prepare(input);
    await plan.apply();
    expect((await lstat(join(plan.project, "src/home.ts"))).mode & 0o777).toBe(0o755);
    expect(plan.receipt.files[0].mode).toBe("100755");
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
  });

  it("retains new parent directory leases across successful idempotent applies", async () => {
    const input = await fixture(),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    blueprint.filePlan[0].path = "src/new/home.ts";
    if (blueprint.commands[0].template === "format")
      blueprint.commands[0].files = ["src/new/home.ts"];
    const plan = await prepare(input);
    expect(await plan.apply()).toMatchObject({ status: "written" });
    expect(await plan.apply()).toMatchObject({ status: "unchanged" });
    await rename(join(plan.project, "src/new"), join(plan.project, "src/old-new"));
    await mkdir(join(plan.project, "src/new"));
    await writeFile(join(plan.project, "src/new/home.ts"), "export const page = 'new';\n");
    await expect(plan.apply()).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(plan.project, "src/new/home.ts"), "utf8")).toBe(
      "export const page = 'new';\n",
    );
    expect(await readFile(join(plan.project, "src/old-new/home.ts"), "utf8")).toBe(
      "export const page = 'new';\n",
    );
  });

  it("rejects a stale complete baseline, old hash, staged raw-file hash, and dirty planned overlap", async () => {
    const input = await fixture(true),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    await writeFile(join(input.project, "src/new-dirty.ts"), "unexpected\n");
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const old = blueprint.filePlan[0].expectedHash;
    blueprint.filePlan[0].expectedHash = await hash("wrong old bytes");
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    blueprint.filePlan[0].expectedHash = old;
    const content = blueprint.filePlan[0].contentHash;
    blueprint.filePlan[0].contentHash = await npBuildFileDigest(
      "np.build-staged-artifact.v1",
      Buffer.from("export const page = 'new';\n"),
    );
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    blueprint.filePlan[0].contentHash = content;
    input.dirtyPaths = ["src/home.ts"];
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
  });

  it("accepts already final dirty bytes without rewriting or claiming command execution", async () => {
    const input = await fixture(true);
    await writeFile(join(input.project, "src/home.ts"), "export const page = 'new';\n");
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    input.dirtyPaths = ["src/home.ts", "src/dirty.ts"];
    const plan = await prepare(input);
    expect(await plan.apply()).toMatchObject({ status: "unchanged" });
    await plan.assertOriginalUnchanged();
  });

  it("defers schema command outputs with their exact file-plan paths and never invokes commands", async () => {
    const input = await fixture(),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    blueprint.filePlan.push({
      path: "src/db/generated/collections.ts",
      action: "create",
      owner: "generated-schema",
      expectedHash: null,
      contentHash: await hash("command-owned output\n"),
      rationale: "Use the owning schema generator",
      source: "command",
      stagedArtifactPath: null,
      generatedByCommandId: "schema",
    });
    blueprint.commands.push({
      id: "schema",
      cwd: "project",
      template: "schema-generate",
      prerequisites: [],
      timeoutSeconds: 60,
    });
    blueprint.verification.push(
      {
        id: "schema-exit",
        commandId: "schema",
        expected: "exit-zero",
        required: true,
        artifactPath: null,
      },
      {
        id: "schema-source",
        commandId: "schema",
        expected: "no-diff",
        required: true,
        artifactPath: null,
      },
    );
    const plan = await prepare(input);
    expect(plan.receipt.deferredCommandPaths).toEqual(["src/db/generated/collections.ts"]);
    expect((await plan.apply()).deferredCommandPaths).toEqual(["src/db/generated/collections.ts"]);
    expect(await exists(join(plan.project, "src/db/generated/collections.ts"))).toBe(false);
    expect(
      hooks.spawned.mock.calls.every(
        ([, executable]) => executable === "/usr/bin/cc" || String(executable).endsWith("/adapter"),
      ),
    ).toBe(true);
  });

  it("rejects descriptor/proxy/sparse DTOs without invoking accessors", async () => {
    const input = await fixture();
    let reads = 0;
    const getter = { ...input };
    Object.defineProperty(getter, "project", {
      enumerable: true,
      get: () => {
        reads++;
        return input.project;
      },
    });
    await expect(prepare(getter)).rejects.toMatchObject({ reason: "input" });
    const dirty = ["src/dirty.ts"];
    Object.defineProperty(dirty, "0", {
      enumerable: true,
      get: () => {
        reads++;
        return "src/dirty.ts";
      },
    });
    await expect(prepare({ ...input, dirtyPaths: dirty })).rejects.toMatchObject({
      reason: "input",
    });
    await expect(
      prepare(
        new Proxy(input, {
          get: () => {
            reads++;
            throw new Error("must not read");
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "input" });
    await expect(prepare({ ...input, dirtyPaths: new Array<string>(1) })).rejects.toMatchObject({
      reason: "input",
    });
    expect(reads).toBe(0);
  });

  it("does not copy credential, agent configuration, Git, dependencies or build artifacts", async () => {
    const input = await fixture();
    for (const path of [
      ".env",
      "src/private.key",
      ".codex/config.toml",
      ".agents/settings.json",
      ".npmrc",
      "node_modules/secret.txt",
      ".git/index",
      ".next/cache.txt",
    ]) {
      await mkdir(join(input.project, path, ".."), { recursive: true });
      await writeFile(join(input.project, path), "synthetic-secret-marker");
    }
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const plan = await prepare(input);
    for (const path of [
      ".env",
      "src/private.key",
      ".codex",
      ".agents",
      ".npmrc",
      "node_modules",
      ".git",
      ".next",
      ".nexpress",
    ])
      expect(await exists(join(plan.project, path))).toBe(false);
    expect(plan.receipt.omittedPaths).toEqual(
      expect.arrayContaining([
        ".env",
        ".npmrc",
        "src/private.key",
        ".codex/config.toml",
        ".agents/settings.json",
      ]),
    );
    expect(JSON.stringify(plan.receipt)).not.toContain("synthetic-secret-marker");
    await plan.apply();
    await plan.assertOriginalUnchanged();
  });

  it("retains operator changes in a conflicting private target and does not touch other planned paths", async () => {
    const input = await fixture(true);
    const plan = await prepare(input);
    await writeFile(join(plan.project, "src/home.ts"), "operator replacement\n");
    await expect(plan.apply()).rejects.toMatchObject({
      reason: "conflict",
      scope: "private-build-copy",
      privateCopyState: "partial-changes-may-remain",
    });
    expect(await readFile(join(plan.project, "src/home.ts"), "utf8")).toBe(
      "operator replacement\n",
    );
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
  });

  it("retains applied private bytes and an operator replacement after a late verification failure", async () => {
    const input = await fixture(true),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    await writeFile(
      join(input.project, ".nexpress/site/files/second.ts"),
      "second planned bytes\n",
    );
    blueprint.filePlan.push({
      path: "src/second.ts",
      action: "create",
      owner: "page",
      expectedHash: null,
      contentHash: await hash("second planned bytes\n"),
      rationale: "Second reviewed file",
      source: "staged",
      stagedArtifactPath: ".nexpress/site/files/second.ts",
      generatedByCommandId: null,
    });
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const plan = await prepare(input);
    hooks.spawned.mockImplementation(
      (child: ChildProcessModule.ChildProcess, executable: string, args: string[]) => {
        if (executable.endsWith("/adapter") && args[0] === "apply")
          child.once("close", () => {
            renameSync(
              join(plan.project, "src/second.ts"),
              join(plan.project, "src/old-second.ts"),
            );
            writeFileSync(join(plan.project, "src/second.ts"), "operator replacement retained\n");
          });
      },
    );
    await expect(plan.apply()).rejects.toMatchObject({
      reason: "conflict",
      privateCopyState: "partial-changes-may-remain",
    });
    expect(await readFile(join(plan.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'new';\n",
    );
    expect(await readFile(join(plan.project, "src/old-second.ts"), "utf8")).toBe(
      "second planned bytes\n",
    );
    expect(await readFile(join(plan.project, "src/second.ts"), "utf8")).toBe(
      "operator replacement retained\n",
    );
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
    expect(await exists(join(input.project, "src/second.ts"))).toBe(false);
  });

  it("uses no-follow FD capture for staged leaves changed after the baseline observation", async () => {
    for (const kind of ["symlink", "hardlink"] as const) {
      const input = await fixture(),
        stage = join(input.project, ".nexpress/site/files/home.ts");
      hooks.beforeSpawn.mockImplementation((executable: string, args: string[]) => {
        if (executable.endsWith("/adapter") && args[0] === "capture") {
          renameSync(stage, `${stage}.old`);
          if (kind === "symlink") symlinkSync(`${stage}.old`, stage);
          else linkSync(`${stage}.old`, stage);
        }
      });
      await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
      expect(await readFile(`${stage}.old`, "utf8")).toBe("export const page = 'new';\n");
      expect(await exists(join(input.project, "src/home.ts"))).toBe(false);
      hooks.beforeSpawn.mockReset();
    }
  });

  it("rejects private leaf symlink/hardlink and ancestor replacement without modifying their targets", async () => {
    for (const kind of ["symlink", "hardlink", "parent"] as const) {
      const input = await fixture(true),
        plan = await prepare(input);
      const target = join(input.project, "src/home.ts"),
        privateTarget = join(plan.project, "src/home.ts");
      if (kind === "parent") {
        await rename(join(plan.project, "src"), join(plan.project, "old-src"));
        await mkdir(join(plan.project, "src"));
        await writeFile(privateTarget, "export const page = 'old';\n");
      } else {
        await rm(privateTarget);
        if (kind === "symlink") await symlink(target, privateTarget);
        else await link(target, privateTarget);
      }
      await expect(plan.apply()).rejects.toMatchObject({ reason: "conflict" });
      expect(await readFile(target, "utf8")).toBe("export const page = 'old';\n");
    }
  });

  it("binds original file and ancestor identities after preparation, including same-byte replacements", async () => {
    for (const kind of ["file", "parent"] as const) {
      const input = await fixture(true),
        plan = await prepare(input);
      if (kind === "file") {
        await rename(join(input.project, "src/home.ts"), join(input.project, "src/old-home.ts"));
        await writeFile(join(input.project, "src/home.ts"), "export const page = 'old';\n");
      } else {
        await rename(join(input.project, "src"), join(input.project, "old-src"));
        await mkdir(join(input.project, "src"));
        await writeFile(join(input.project, "src/home.ts"), "export const page = 'old';\n");
        await writeFile(join(input.project, "src/dirty.ts"), "operator dirty source\n");
      }
      await expect(plan.assertOriginalUnchanged()).rejects.toMatchObject({ reason: "conflict" });
      expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(
        "export const page = 'old';\n",
      );
    }
  });

  it("preflights every private path and rejects a changed executable mode before any write", async () => {
    const input = await fixture(true),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    await writeFile(
      join(input.project, ".nexpress/site/files/second.ts"),
      "second planned bytes\n",
    );
    blueprint.filePlan.push({
      path: "src/second.ts",
      action: "create",
      owner: "page",
      expectedHash: null,
      contentHash: await hash("second planned bytes\n"),
      rationale: "Second reviewed file",
      source: "staged",
      stagedArtifactPath: ".nexpress/site/files/second.ts",
      generatedByCommandId: null,
    });
    input.baseline = (await readSiteSourceTreeV1(input.project)).manifest;
    const plan = await prepare(input);
    await writeFile(join(plan.project, "src/second.ts"), "conflicting second path\n");
    await expect(plan.apply()).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(plan.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
    await rm(join(plan.project, "src/second.ts"));
    // A failed copy is invalidated; fixing one leaf cannot silently re-authorize it.
    await expect(plan.apply()).rejects.toMatchObject({ reason: "conflict" });
    const fresh = await prepare(input);
    await chmod(join(fresh.project, "src/home.ts"), 0o755);
    await expect(fresh.apply()).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(fresh.project, "src/home.ts"), "utf8")).toBe(
      "export const page = 'old';\n",
    );
    expect(await exists(join(fresh.project, "src/second.ts"))).toBe(false);
  });

  it("rejects portable ancestor case aliases and credential destinations without writing the original", async () => {
    const input = await fixture();
    const blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    blueprint.filePlan[0].path = "Src/home.ts";
    if (blueprint.commands[0].template === "format") blueprint.commands[0].files = ["Src/home.ts"];
    await expect(prepare(input)).rejects.toMatchObject({ reason: "path" });
    blueprint.filePlan[0].path = ".env";
    if (blueprint.commands[0].template === "format") blueprint.commands[0].files = [".env"];
    await expect(prepare(input)).rejects.toThrow();
    expect(await exists(join(input.project, ".env"))).toBe(false);
    expect(await exists(join(input.project, "src/home.ts"))).toBe(false);
  });

  it("fails closed when the fixed compiler is unavailable, or scope is not the private copy", async () => {
    const input = await fixture();
    hooks.compilerMissing = true;
    await expect(prepare(input)).rejects.toMatchObject({ reason: "unavailable" });
    await expect(
      prepare({ ...input, scope: "live-repository" as "private-build-copy" }),
    ).rejects.toMatchObject({ reason: "input" });
    expect(await exists(join(input.project, "src/home.ts"))).toBe(false);
  });
});
