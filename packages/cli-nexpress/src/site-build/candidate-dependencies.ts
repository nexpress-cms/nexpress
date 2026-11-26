import { constants, type BigIntStats } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { SiteBuildError } from "./artifact-io.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

interface File {
  path: string;
  kind: "file" | "symlink";
  mode: number;
  bytes: number;
  sha256: string;
  target: string | null;
}
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const fail = (): never => {
  throw new SiteBuildError("conflict");
};
const inside = (root: string, path: string) => path === root || path.startsWith(root + "/");

/** Complete closure, including pnpm wiring/shims outside individual package inventories. */
async function observe(root: string) {
  const files: File[] = [],
    directories: string[] = [],
    leases: Array<{ path: string; identity: BigIntStats; target?: string }> = [];
  let count = 0,
    total = 0;
  const visit = async (relative: string, depth: number): Promise<void> => {
    if (++count > 300000 || depth > 64 || relative.length > 2048) return fail();
    const path = join(root, relative),
      before = await lstat(path, { bigint: true });
    if (before.isDirectory()) {
      directories.push(relative);
      leases.push({ path, identity: before });
      for (const name of (await readdir(path)).sort()) {
        if (
          name.includes("\\") ||
          Array.from(name).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
          return fail();
        await visit(relative ? relative + "/" + name : name, depth + 1);
      }
      return;
    }
    if (files.length >= 150000) return fail();
    if (before.isSymbolicLink()) {
      const target = await readlink(path);
      if (
        target.length > 2048 ||
        isAbsolute(target) ||
        !inside(root, resolve(dirname(path), target)) ||
        !inside(root, await realpath(path))
      )
        return fail();
      files.push({
        path: relative,
        kind: "symlink",
        mode: 0,
        bytes: Buffer.byteLength(target),
        sha256: createHash("sha256").update(target).digest("hex"),
        target,
      });
      leases.push({ path, identity: before, target });
      return;
    }
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 0n ||
      before.size > 512n * 1024n * 1024n ||
      (total += Number(before.size)) > 3 * 1024 * 1024 * 1024
    )
      return fail();
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!same(before, await fd.stat({ bigint: true }))) return fail();
      const hash = createHash("sha256"),
        buffer = Buffer.alloc(65536);
      let offset = 0;
      for (;;) {
        const result = await fd.read(buffer, 0, buffer.length, null);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
        if (offset > Number(before.size)) return fail();
        hash.update(buffer.subarray(0, result.bytesRead));
      }
      if (offset !== Number(before.size) || !same(before, await fd.stat({ bigint: true })))
        return fail();
      files.push({
        path: relative,
        kind: "file",
        mode: (before.mode & 0o111n) !== 0n ? 0o555 : 0o444,
        bytes: offset,
        sha256: hash.digest("hex"),
        target: null,
      });
      leases.push({ path, identity: before });
    } finally {
      await fd.close();
    }
  };
  await visit("", 0);
  const assertUnchanged = async () => {
    for (const lease of leases) {
      if (!same(lease.identity, await lstat(lease.path, { bigint: true }))) return fail();
      if (lease.target !== undefined && (await readlink(lease.path)) !== lease.target)
        return fail();
    }
  };
  await assertUnchanged();
  const digest = createHash("sha256")
    .update(
      JSON.stringify({ profile: "np.site-build-candidate-dependencies.v1", directories, files }),
    )
    .digest("hex");
  return { files, directories, digest, assertUnchanged };
}

/**
 * Host-only bridge into a caller-owned disposable edit copy. Caller must hold
 * live prepared-project/dependency provenance; a path or JSON receipt is not it.
 * No install, import, script, provider or original repository write occurs.
 */
export async function materializeSiteBuildCandidateDependenciesV1(input: {
  scope: "private-build-copy";
  project: string;
  dependencies: string;
  assertPreparedUnchanged(): Promise<void>;
}) {
  if (input.scope !== "private-build-copy" || !constants.O_NOFOLLOW)
    throw new SiteBuildError("unavailable");
  const project = await realpath(input.project),
    source = await realpath(input.dependencies);
  if (
    project !== input.project ||
    source !== input.dependencies ||
    !source.endsWith("/node_modules") ||
    source === join(project, "node_modules") ||
    inside(source, project) ||
    inside(project, source)
  )
    throw new SiteBuildError("path");
  await input.assertPreparedUnchanged();
  const before = await readSiteSourceTreeV1(project),
    observed = await observe(source),
    destination = join(project, "node_modules");
  let created: BigIntStats | undefined;
  try {
    await mkdir(destination, { mode: 0o700 });
    created = await lstat(destination, { bigint: true });
    for (const directory of observed.directories) {
      if (directory) await mkdir(join(destination, directory), { recursive: true, mode: 0o700 });
    }
    for (const file of observed.files) {
      const target = join(destination, file.path);
      if (file.kind === "symlink") await symlink(file.target!, target);
      else {
        await copyFile(
          join(source, file.path),
          target,
          constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
        );
        const fd = await open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (!(await fd.stat()).isFile()) return fail();
          await fd.chmod(file.mode);
        } finally {
          await fd.close();
        }
      }
    }
    await observed.assertUnchanged();
    await input.assertPreparedUnchanged();
    const copied = await observe(destination);
    if (
      copied.digest !== observed.digest ||
      (await readSiteSourceTreeV1(project)).digest !== before.digest
    )
      return fail();
    return {
      scope: "private-build-copy" as const,
      dependencies: destination,
      profile: "np.site-build-candidate-dependencies.v1" as const,
      digest: observed.digest,
      files: observed.files.length,
      bytes: observed.files.reduce((n, file) => n + file.bytes, 0),
      async assertUnchanged() {
        await copied.assertUnchanged();
        await input.assertPreparedUnchanged();
      },
    };
  } catch (error) {
    if (created) {
      const current = await lstat(destination, { bigint: true }).catch(() => null);
      if (current?.isDirectory() && current.dev === created.dev && current.ino === created.ino) {
        // Only this exact newly created dependency root may be removed on failure.
        await rm(destination, { recursive: true, force: true });
      }
    }
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("conflict");
  }
}
