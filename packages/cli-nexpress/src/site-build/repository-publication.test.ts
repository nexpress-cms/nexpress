import type * as ChildProcessModule from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { npBuildFileDigest, type NpAgentSiteBlueprintV1 } from "@nexpress/core/agent-contract";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import {
  prepareSiteBuildRepositoryPublicationV1,
  type NpSiteBuildRepositoryPublicationInputV1,
  type NpSiteBuildRepositoryPublicationV1,
} from "./repository-publication.js";

const hooks = vi.hoisted(() => ({
  beforeSpawn: vi.fn(),
  spawned: vi.fn(),
  compilerMissing: false,
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcessModule>();
  return {
    ...actual,
    spawn: (executable: string, args: string[], options: SpawnOptions) => {
      hooks.beforeSpawn(executable, args, options);
      const child = actual.spawn(
        hooks.compilerMissing && executable === "/usr/bin/cc" ? "/np-missing-compiler" : executable,
        args,
        options,
      );
      hooks.spawned(child, executable, args, options);
      return child;
    },
  };
});
const roots: string[] = [],
  handles: NpSiteBuildRepositoryPublicationV1[] = [];
beforeEach(() => {
  hooks.beforeSpawn.mockReset();
  hooks.spawned.mockReset();
  hooks.compilerMissing = false;
});
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const oldBytes = "export const page = 'old';\n",
  newBytes = "export const page = 'new';\n";
const hash = (bytes: string) => npBuildFileDigest("np.build-source-file.v1", Buffer.from(bytes));
async function fixture(command = false): Promise<NpSiteBuildRepositoryPublicationInputV1> {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-publication-original-")));
  const candidate = await realpath(await mkdtemp(join(tmpdir(), "np-publication-candidate-")));
  roots.push(project, candidate);
  for (const root of [project, candidate]) {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/dirty.ts"), "operator dirty bytes\n");
  }
  await writeFile(join(project, "src/home.ts"), oldBytes);
  await writeFile(join(candidate, "src/home.ts"), newBytes);
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
    action: "update",
    expectedHash: await hash(oldBytes),
    contentHash: await hash(newBytes),
  };
  if (command) {
    await mkdir(join(candidate, "src/db/generated"), { recursive: true });
    await writeFile(
      join(candidate, "src/db/generated/collections.ts"),
      "// generated owner bytes\n",
    );
    blueprint.filePlan.push({
      path: "src/db/generated/collections.ts",
      action: "create",
      owner: "generated-schema",
      expectedHash: null,
      contentHash: await hash("// generated owner bytes\n"),
      rationale: "Publish the verified schema owner output",
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
  }
  return {
    project,
    blueprint,
    baseline: (await readSiteSourceTreeV1(project)).manifest,
    dirtyPaths: ["src/dirty.ts"],
    candidate: { project: candidate, sourceTree: (await readSiteSourceTreeV1(candidate)).manifest },
  };
}
async function prepare(input: NpSiteBuildRepositoryPublicationInputV1) {
  const handle = await prepareSiteBuildRepositoryPublicationV1(input);
  handles.push(handle);
  return handle;
}

describe("explicit POSIX repository publication of verified candidate bytes", () => {
  it("publishes staged and command rows, preserves unrelated dirty changes and permissions, and reruns idempotently", async () => {
    const input = await fixture(true);
    await chmod(join(input.project, "src/home.ts"), 0o600);
    const handle = await prepare(input);
    await writeFile(join(input.project, "src/dirty.ts"), "operator changed again\n");
    await writeFile(join(input.project, "unrelated.txt"), "new unrelated file\n");
    const inode = (await lstat(join(input.project, "src/home.ts"))).ino;
    expect(handle.receipt.files.map((row) => row.source)).toEqual(["staged", "command"]);
    expect(await handle.publish()).toMatchObject({
      status: "written",
      writtenPaths: ["src/home.ts", "src/db/generated/collections.ts"],
    });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(newBytes);
    expect((await lstat(join(input.project, "src/home.ts"))).ino).toBe(inode);
    expect((await lstat(join(input.project, "src/home.ts"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(input.project, "src/dirty.ts"), "utf8")).toBe(
      "operator changed again\n",
    );
    expect(await readFile(join(input.project, "unrelated.txt"), "utf8")).toBe(
      "new unrelated file\n",
    );
    const createdInode = (await lstat(join(input.project, "src/db/generated/collections.ts"))).ino;
    expect(await handle.publish()).toMatchObject({
      status: "unchanged",
      writtenPaths: [],
      unchangedPaths: ["src/home.ts", "src/db/generated/collections.ts"],
    });
    expect((await lstat(join(input.project, "src/db/generated/collections.ts"))).ino).toBe(
      createdInode,
    );
    await handle.close();
    const rerun = await prepare(input);
    expect(await rerun.publish()).toMatchObject({ status: "unchanged", writtenPaths: [] });
    expect(
      hooks.spawned.mock.calls.every(
        ([, executable]) => executable === "/usr/bin/cc" || String(executable).endsWith("/adapter"),
      ),
    ).toBe(true);
  });

  it("preflights every original row before changing any, retaining a newly conflicting create", async () => {
    const input = await fixture(true),
      handle = await prepare(input);
    await mkdir(join(input.project, "src/db/generated"), { recursive: true });
    await writeFile(
      join(input.project, "src/db/generated/collections.ts"),
      "operator replacement\n",
    );
    await expect(handle.publish()).rejects.toMatchObject({
      reason: "conflict",
      publicationState: "preflight-rejected",
      writtenPaths: [],
    });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(oldBytes);
    expect(await readFile(join(input.project, "src/db/generated/collections.ts"), "utf8")).toBe(
      "operator replacement\n",
    );
    await expect(handle.publish()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("permits dirty overlap only when its current bytes and mode already match the final candidate", async () => {
    const input = await fixture();
    input.dirtyPaths = ["Src"];
    await expect(prepare(input)).rejects.toMatchObject({ reason: "path" });
    input.dirtyPaths = ["src"];
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    await writeFile(join(input.project, "src/home.ts"), newBytes);
    const inode = (await lstat(join(input.project, "src/home.ts"))).ino;
    const handle = await prepare(input);
    expect(await handle.publish()).toMatchObject({ status: "unchanged" });
    expect((await lstat(join(input.project, "src/home.ts"))).ino).toBe(inode);
    await chmod(join(input.project, "src/home.ts"), 0o755);
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
  });

  it.each(["symlink", "hardlink", "same-byte-file", "parent", "parent-case", "mode"] as const)(
    "rejects a late original %s replacement through native FD leases",
    async (kind) => {
      const input = await fixture(),
        handle = await prepare(input);
      const target = join(input.project, "src/home.ts"),
        backup = join(input.project, "src/original-home.ts");
      hooks.beforeSpawn.mockImplementation((executable: string, args: string[]) => {
        if (!executable.endsWith("/adapter") || args[0] !== "publish") return;
        if (kind === "mode") chmodSync(target, 0o755);
        else if (kind === "parent-case")
          renameSync(join(input.project, "src"), join(input.project, "SRC"));
        else if (kind === "parent") {
          renameSync(join(input.project, "src"), join(input.project, "old-src"));
          // Synchronous setup occurs strictly after JS observation and before native openat.
          const parent = join(input.project, "src");
          // mkdirSync is kept separate from the source module's asynchronous filesystem calls.
          mkdirSync(parent);
          writeFileSync(target, oldBytes);
        } else {
          renameSync(target, backup);
          if (kind === "symlink") symlinkSync(backup, target);
          else if (kind === "hardlink") linkSync(backup, target);
          else writeFileSync(target, oldBytes);
        }
      });
      await expect(handle.publish()).rejects.toMatchObject({
        publicationState: "preflight-rejected",
        writtenPaths: [],
      });
      expect(
        await readFile(
          kind === "parent-case" ? join(input.project, "SRC/home.ts") : target,
          "utf8",
        ),
      ).toBe(oldBytes);
      if (kind !== "parent" && kind !== "parent-case" && kind !== "mode")
        expect(await readFile(backup, "utf8")).toBe(oldBytes);
    },
  );

  it.each(["symlink", "hardlink"] as const)(
    "uses no-follow candidate capture against a late %s leaf",
    async (kind) => {
      const input = await fixture(),
        target = join(input.candidate.project, "src/home.ts"),
        backup = `${target}.old`;
      hooks.beforeSpawn.mockImplementation((executable: string, args: string[]) => {
        if (executable.endsWith("/adapter") && args[0] === "capture") {
          renameSync(target, backup);
          if (kind === "symlink") symlinkSync(backup, target);
          else linkSync(backup, target);
        }
      });
      await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
      expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(oldBytes);
      expect(await readFile(backup, "utf8")).toBe(newBytes);
    },
  );

  it("checks candidate content, candidate mode, original expected hash and post-prepare drift", async () => {
    const input = await fixture(),
      blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    const expected = blueprint.filePlan[0].expectedHash;
    blueprint.filePlan[0].expectedHash = await hash("different original\n");
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    blueprint.filePlan[0].expectedHash = expected;
    await chmod(join(input.candidate.project, "src/home.ts"), 0o755);
    input.candidate.sourceTree = (await readSiteSourceTreeV1(input.candidate.project)).manifest;
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    await chmod(join(input.candidate.project, "src/home.ts"), 0o644);
    input.candidate.sourceTree = (await readSiteSourceTreeV1(input.candidate.project)).manifest;
    const handle = await prepare(input);
    await writeFile(join(input.candidate.project, "src/home.ts"), "changed after verification\n");
    await expect(handle.publish()).rejects.toMatchObject({
      publicationState: "preflight-rejected",
      writtenPaths: [],
    });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(oldBytes);
  });

  it("reports late verification failure without deleting published bytes or rolling back an operator replacement", async () => {
    const input = await fixture(true),
      handle = await prepare(input);
    hooks.spawned.mockImplementation(
      (child: ChildProcessModule.ChildProcess, executable: string, args: string[]) => {
        if (executable.endsWith("/adapter") && args[0] === "publish")
          child.once("close", () => {
            const path = join(input.project, "src/db/generated/collections.ts");
            renameSync(path, `${path}.published`);
            writeFileSync(path, "operator replacement retained\n");
          });
      },
    );
    await expect(handle.publish()).rejects.toMatchObject({
      publicationState: "partial-changes-may-remain",
      writtenPaths: expect.arrayContaining(["src/home.ts", "src/db/generated/collections.ts"]),
      uncertainPaths: expect.arrayContaining(["src/db/generated/collections.ts"]),
    });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(newBytes);
    expect(await readFile(join(input.project, "src/db/generated/collections.ts"), "utf8")).toBe(
      "operator replacement retained\n",
    );
    expect(
      await readFile(join(input.project, "src/db/generated/collections.ts.published"), "utf8"),
    ).toBe("// generated owner bytes\n");
  });

  it("rejects an oversized candidate as bounded raw input before writing the original", async () => {
    const input = await fixture();
    const file = await open(join(input.candidate.project, "src/home.ts"), "w");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    input.candidate.sourceTree = (await readSiteSourceTreeV1(input.candidate.project)).manifest;
    const blueprint = input.blueprint as NpAgentSiteBlueprintV1;
    blueprint.filePlan[0].contentHash = input.candidate.sourceTree.files.find(
      (row) => row.path === "src/home.ts",
    )!.digest;
    await expect(prepare(input)).rejects.toMatchObject({ reason: "conflict" });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(oldBytes);
  });

  it("rejects accessors/proxies and unavailable fixed compiler without invoking project code", async () => {
    const input = await fixture();
    let reads = 0;
    const dto = { ...input };
    Object.defineProperty(dto, "candidate", {
      enumerable: true,
      get() {
        reads++;
        return input.candidate;
      },
    });
    await expect(prepare(dto)).rejects.toMatchObject({ reason: "input" });
    await expect(
      prepare(
        new Proxy(input, {
          get() {
            reads++;
            throw new Error("must not read");
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "input" });
    await expect(
      prepare({
        ...input,
        blueprint: new Proxy(input.blueprint as object, {
          getPrototypeOf() {
            reads++;
            throw new Error("must not inspect runtime proxy");
          },
        }),
      }),
    ).rejects.toMatchObject({ reason: "input" });
    expect(reads).toBe(0);
    hooks.compilerMissing = true;
    await expect(prepare(input)).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readFile(join(input.project, "src/home.ts"), "utf8")).toBe(oldBytes);
  });
});
