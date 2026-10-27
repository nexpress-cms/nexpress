import type { ChildProcess, SpawnOptions } from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import { watch, writeFileSync, renameSync, mkdirSync } from "node:fs";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishSiteBuildDirectionArtifactsV1,
  publishSiteBuildGeneratorAuditV1,
  type NpSiteBuildDirectionArtifactPublicationV1,
} from "./render-artifacts.js";

const hooks = vi.hoisted(() => ({ spawned: vi.fn(), compilerMissing: false }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcessModule>();
  return {
    ...actual,
    spawn: (executable: string, args: string[], options: SpawnOptions) => {
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
const roots: string[] = [];
beforeEach(() => {
  hooks.spawned.mockReset();
  hooks.compilerMissing = false;
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(): Promise<NpSiteBuildDirectionArtifactPublicationV1> {
  const project = await realpath(await mkdtemp(join(tmpdir(), "np-direction-publication-test-")));
  roots.push(project);
  await writeFile(join(project, "operator.txt"), "existing dirty operator source\n");
  return {
    project,
    artifacts: Array.from({ length: 6 }, (_, i) => [
      {
        path: `.nexpress/site/review/directions/${i}.png`,
        bytes: Buffer.from(`caller-validated PNG ${i}`),
      },
      {
        path: `.nexpress/site/review/directions/${i}.receipt.json`,
        bytes: Buffer.from(`{"receipt":${i}}`),
      },
    ]).flat(),
    sealedSet: {
      path: ".nexpress/site/directions.json",
      bytes: Buffer.from('{"callerValidatedSet":true}'),
    },
  };
}
async function present(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
async function expectBytes(path: string, expected: Uint8Array) {
  expect((await readFile(path)).equals(Buffer.from(expected))).toBe(true);
}
async function prepareDirectories(input: NpSiteBuildDirectionArtifactPublicationV1) {
  await mkdir(join(input.project, ".nexpress/site/review/directions"), { recursive: true });
}

describe("direction artifact create-only publisher", () => {
  it("publishes bounded generator audit logs with a fixed manifest last, without widening direction paths", async () => {
    const input = await fixture();
    const prefix = ".nexpress/site/audit/generator-unit-1";
    const publication = {
      project: input.project,
      artifacts: [
        { path: `${prefix}/stdout.log`, bytes: Buffer.alloc(0) },
        { path: `${prefix}/audit.json`, bytes: Buffer.from("{}") },
      ],
      manifest: { path: `${prefix}/manifest.json`, bytes: Buffer.from('{"retentionOnly":true}') },
    };
    const result = await publishSiteBuildGeneratorAuditV1(publication);
    expect(result.paths.at(-1)).toBe(publication.manifest.path);
    expect(await readFile(join(input.project, publication.artifacts[0].path))).toHaveLength(0);
    expect((await publishSiteBuildGeneratorAuditV1(publication)).status).toBe("unchanged");
    const changed = structuredClone(input);
    changed.artifacts[0].path = `${prefix}/wrong.png`;
    await expect(publishSiteBuildDirectionArtifactsV1(changed)).rejects.toMatchObject({
      reason: "path",
    });
  });

  it("rejects foreign audit runs, source paths, unsupported suffixes and audit bounds before compilation", async () => {
    const input = await fixture(),
      prefix = ".nexpress/site/audit/generator-unit-1";
    const base = {
      project: input.project,
      artifacts: [{ path: `${prefix}/audit.json`, bytes: Buffer.from("{}") }],
      manifest: { path: `${prefix}/manifest.json`, bytes: Buffer.from("{}") },
    };
    for (const path of [
      "src/other.json",
      ".nexpress/site/audit/foreign/audit.json",
      `${prefix}/raw.png`,
      ".nexpress/site/audit/generator-other/audit.json",
    ])
      await expect(
        publishSiteBuildGeneratorAuditV1({ ...base, artifacts: [{ ...base.artifacts[0], path }] }),
      ).rejects.toHaveProperty("reason");
    for (const value of [
      {
        ...base,
        artifacts: Array.from({ length: 401 }, (_, i) => ({
          path: `${prefix}/${i}.json`,
          bytes: Buffer.from("{}"),
        })),
      },
      { ...base, manifest: { ...base.manifest, path: `${prefix}/other.json` } },
      { ...base, artifacts: [{ ...base.artifacts[0], bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }] },
    ])
      await expect(publishSiteBuildGeneratorAuditV1(value)).rejects.toHaveProperty("reason");
    expect(hooks.spawned).not.toHaveBeenCalled();
  });
  it("publishes twelve detached byte artifacts, seals last and reruns byte-identically on macOS", async () => {
    const input = await fixture();
    const result = await publishSiteBuildDirectionArtifactsV1(input);
    expect(result.status).toBe("written");
    expect(result.paths.at(-1)).toBe(input.sealedSet.path);
    expect(result.paths).toHaveLength(13);
    for (const item of [...input.artifacts, input.sealedSet])
      expect(await readFile(join(input.project, item.path))).toEqual(Buffer.from(item.bytes));
    expect((await publishSiteBuildDirectionArtifactsV1(input)).status).toBe("unchanged");
    expect(await readFile(join(input.project, "operator.txt"), "utf8")).toBe(
      "existing dirty operator source\n",
    );
    for (const [, executable, args, options] of hooks.spawned.mock.calls) {
      expect(options.shell).toBeUndefined();
      expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
      expect(options.env.HOME).toBe("/nonexistent");
      if (executable === "/usr/bin/cc")
        expect(args.slice(0, 4)).toEqual(["-std=c11", "-O2", "-Wall", "-Werror"]);
      else expect(args[0]).toBe("publish");
    }
  });

  it("preflights every existing artifact and the sealed set before creating any publication file", async () => {
    for (const target of ["artifact", "set"]) {
      const input = await fixture();
      await prepareDirectories(input);
      const path = join(
        input.project,
        target === "artifact" ? input.artifacts[11].path : input.sealedSet.path,
      );
      await writeFile(path, "operator-owned different bytes");
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(await readFile(path, "utf8")).toBe("operator-owned different bytes");
      expect(await present(join(input.project, input.artifacts[0].path))).toBe(false);
    }
  });

  it("rejects leaf/parent/project symlinks and hard-link aliases without changing their targets", async () => {
    for (const kind of ["leaf", "parent", "project", "hardlink"]) {
      const input = await fixture(),
        outside = await fixture();
      await prepareDirectories(input);
      const external = join(outside.project, "operator.txt");
      if (kind === "leaf") await symlink(external, join(input.project, input.artifacts[0].path));
      if (kind === "hardlink") await link(external, join(input.project, input.artifacts[0].path));
      if (kind === "parent") {
        await rm(join(input.project, ".nexpress/site/review/directions"), { recursive: true });
        await symlink(outside.project, join(input.project, ".nexpress/site/review/directions"));
      }
      if (kind === "project") {
        const alias = join(outside.project, "project-alias");
        await symlink(input.project, alias);
        input.project = alias;
      }
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(await readFile(external, "utf8")).toBe("existing dirty operator source\n");
      expect(await present(join(outside.project, "0.png"))).toBe(false);
    }
  });

  it("does not open FIFO bytes or proceed to publication", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    const { spawn } = await vi.importActual<typeof ChildProcessModule>("node:child_process");
    const child = spawn("/usr/bin/mkfifo", [join(input.project, input.artifacts[0].path)], {
      stdio: "ignore",
    });
    await new Promise<void>((accept, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? accept() : reject(new Error("fixture mkfifo failed")),
      );
    });
    await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
      reason: "conflict",
    });
    expect(await present(join(input.project, input.sealedSet.path))).toBe(false);
  });

  it("rejects escaping, credential, alias, sparse and over-limit inputs before compiling", async () => {
    const input = await fixture();
    for (const path of [
      "/tmp/escape.png",
      ".nexpress/site/review/directions/../escape.png",
      ".nexpress/site/review/directions/.env.local",
      ".nexpress/site/review/directions/private.key",
      ".nexpress/site/review/directions/CON.png",
    ]) {
      const changed = structuredClone(input);
      changed.artifacts[0].path = path;
      await expect(publishSiteBuildDirectionArtifactsV1(changed)).rejects.toMatchObject({
        reason: "path",
      });
    }
    const variants = [
      { ...input, artifacts: input.artifacts.slice(1) },
      {
        ...input,
        artifacts: input.artifacts.map((entry, i) => (i === 2 ? input.artifacts[0] : entry)),
      },
      {
        ...input,
        artifacts: input.artifacts.map((entry, i) =>
          i === 0 ? { ...entry, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) } : entry,
        ),
      },
      { ...input, sealedSet: { ...input.sealedSet, path: ".nexpress/site/files/set.json" } },
      { ...input, sealedSet: { ...input.sealedSet, bytes: Buffer.alloc(4 * 1024 * 1024 + 1) } },
    ];
    for (const value of variants)
      await expect(publishSiteBuildDirectionArtifactsV1(value)).rejects.toHaveProperty("reason");
    expect(hooks.spawned).not.toHaveBeenCalled();
  });

  it("fails closed when the fixed compiler is unavailable", async () => {
    const input = await fixture();
    hooks.compilerMissing = true;
    await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(await present(join(input.project, ".nexpress"))).toBe(false);
  });

  it("publishes captured bytes when caller buffers change during compilation", async () => {
    const input = await fixture();
    const expected = Buffer.from(input.artifacts[0].bytes),
      expectedSet = Buffer.from(input.sealedSet.bytes);
    const pending = publishSiteBuildDirectionArtifactsV1(input);
    input.artifacts[0].bytes.fill(0);
    input.sealedSet.bytes.fill(0);
    await pending;
    expect(await readFile(join(input.project, input.artifacts[0].path))).toEqual(expected);
    expect(await readFile(join(input.project, input.sealedSet.path))).toEqual(expectedSet);
  });

  it("retains partial artifacts and an operator sealed set after a mocked late conflict", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    input.artifacts[0].bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    input.artifacts[2].bytes = input.artifacts[0].bytes;
    let child: ChildProcess | undefined,
      injected = false;
    hooks.spawned.mockImplementation(
      (process: ChildProcess, executable: string, args: string[]) => {
        if (executable !== "/usr/bin/cc" && args[0] === "publish") child = process;
      },
    );
    const watcher = watch(
      join(input.project, ".nexpress/site/review/directions"),
      (_event, name) => {
        if (injected || String(name) !== "0.png" || !child) return;
        injected = true;
        child.kill("SIGSTOP");
        writeFileSync(join(input.project, input.sealedSet.path), "operator late sealed set");
        child.kill("SIGCONT");
      },
    );
    try {
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
        publicationState: "partial-artifacts-may-remain",
        sealedSetState: "unconfirmed",
      });
      expect(injected).toBe(true);
      expect(await readFile(join(input.project, input.sealedSet.path), "utf8")).toBe(
        "operator late sealed set",
      );
      for (const file of input.artifacts)
        await expectBytes(join(input.project, file.path), file.bytes);
    } finally {
      watcher.close();
      child?.kill("SIGCONT");
    }
  });

  it("preserves an operator replacement inode and any other published artifacts", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    input.artifacts[0].bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    input.artifacts[2].bytes = input.artifacts[0].bytes;
    let child: ChildProcess | undefined,
      injected = false;
    hooks.spawned.mockImplementation(
      (process: ChildProcess, executable: string, args: string[]) => {
        if (executable !== "/usr/bin/cc" && args[0] === "publish") child = process;
      },
    );
    const watcher = watch(
      join(input.project, ".nexpress/site/review/directions"),
      (_event, name) => {
        if (injected || String(name) !== "0.png" || !child) return;
        injected = true;
        child.kill("SIGSTOP");
        const replacement = join(input.project, "replacement");
        writeFileSync(replacement, "operator replacement");
        renameSync(replacement, join(input.project, input.artifacts[0].path));
        child.kill("SIGCONT");
      },
    );
    try {
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(injected).toBe(true);
      expect(await readFile(join(input.project, input.artifacts[0].path), "utf8")).toBe(
        "operator replacement",
      );
      expect(await present(join(input.project, input.sealedSet.path))).toBe(false);
      for (const file of input.artifacts.slice(1))
        if (await present(join(input.project, file.path)))
          await expectBytes(join(input.project, file.path), file.bytes);
    } finally {
      watcher.close();
      child?.kill("SIGCONT");
    }
  });

  it("detects project reparenting and retains artifacts without touching replacement source", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    input.artifacts[0].bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    input.artifacts[2].bytes = input.artifacts[0].bytes;
    const moved = `${input.project}-operator-moved`;
    roots.push(moved);
    let child: ChildProcess | undefined,
      injected = false;
    hooks.spawned.mockImplementation(
      (process: ChildProcess, executable: string, args: string[]) => {
        if (executable !== "/usr/bin/cc" && args[0] === "publish") child = process;
      },
    );
    const watcher = watch(
      join(input.project, ".nexpress/site/review/directions"),
      (_event, name) => {
        if (injected || String(name) !== "0.png" || !child) return;
        injected = true;
        child.kill("SIGSTOP");
        renameSync(input.project, moved);
        mkdirSync(input.project);
        writeFileSync(join(input.project, "operator.txt"), "replacement project source");
        child.kill("SIGCONT");
      },
    );
    try {
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(injected).toBe(true);
      expect(await readFile(join(input.project, "operator.txt"), "utf8")).toBe(
        "replacement project source",
      );
      expect(await readFile(join(moved, "operator.txt"), "utf8")).toBe(
        "existing dirty operator source\n",
      );
      await expectBytes(join(moved, input.artifacts[0].path), input.artifacts[0].bytes);
      expect(await present(join(moved, input.sealedSet.path))).toBe(false);
      expect(await present(join(input.project, ".nexpress"))).toBe(false);
      for (const file of input.artifacts.slice(1))
        if (await present(join(moved, file.path)))
          await expectBytes(join(moved, file.path), file.bytes);
    } finally {
      watcher.close();
      child?.kill("SIGCONT");
    }
  });

  it("preserves changed operator bytes even when the newly created inode stays the same", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    input.artifacts[0].bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    input.artifacts[2].bytes = input.artifacts[0].bytes;
    let child: ChildProcess | undefined,
      injected = false;
    hooks.spawned.mockImplementation(
      (process: ChildProcess, executable: string, args: string[]) => {
        if (executable !== "/usr/bin/cc" && args[0] === "publish") child = process;
      },
    );
    const watcher = watch(
      join(input.project, ".nexpress/site/review/directions"),
      (_event, name) => {
        if (injected || String(name) !== "0.png" || !child) return;
        injected = true;
        child.kill("SIGSTOP");
        writeFileSync(join(input.project, input.artifacts[0].path), "operator edited same inode");
        child.kill("SIGCONT");
      },
    );
    try {
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "conflict",
      });
      expect(injected).toBe(true);
      expect(await readFile(join(input.project, input.artifacts[0].path), "utf8")).toBe(
        "operator edited same inode",
      );
      expect(await present(join(input.project, input.sealedSet.path))).toBe(false);
      for (const file of input.artifacts.slice(1))
        if (await present(join(input.project, file.path)))
          await expectBytes(join(input.project, file.path), file.bytes);
    } finally {
      watcher.close();
      child?.kill("SIGCONT");
    }
  });

  it("retains incomplete unsealed publication after native death and resumes identical bytes", async () => {
    const input = await fixture();
    await prepareDirectories(input);
    input.artifacts[0].bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    input.artifacts[2].bytes = input.artifacts[0].bytes;
    let child: ChildProcess | undefined,
      injected = false;
    hooks.spawned.mockImplementation(
      (process: ChildProcess, executable: string, args: string[]) => {
        if (executable !== "/usr/bin/cc" && args[0] === "publish") child = process;
      },
    );
    const watcher = watch(
      join(input.project, ".nexpress/site/review/directions"),
      (_event, name) => {
        if (injected || String(name) !== "0.png" || !child) return;
        injected = true;
        child.kill("SIGKILL");
      },
    );
    try {
      await expect(publishSiteBuildDirectionArtifactsV1(input)).rejects.toMatchObject({
        reason: "unavailable",
        publicationState: "partial-artifacts-may-remain",
        sealedSetState: "unconfirmed",
      });
      expect(injected).toBe(true);
      const first = join(input.project, input.artifacts[0].path),
        identity = await lstat(first);
      await expectBytes(first, input.artifacts[0].bytes);
      expect(await present(join(input.project, input.sealedSet.path))).toBe(false);
      expect(
        hooks.spawned.mock.calls.some(
          ([, exe, args]) => exe !== "/usr/bin/cc" && args[0] === "cleanup",
        ),
      ).toBe(false);
      expect((await publishSiteBuildDirectionArtifactsV1(input)).status).toBe("written");
      expect((await lstat(first)).ino).toBe(identity.ino);
      for (const file of [...input.artifacts, input.sealedSet])
        await expectBytes(join(input.project, file.path), file.bytes);
    } finally {
      watcher.close();
    }
  });
});
