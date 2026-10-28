import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  lchmod,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import {
  requirePreparedSiteBuildCandidateRenderSourcesV1,
  type NpPreparedSiteBuildCandidateRenderSourcesV1,
} from "./linux-project.js";
import {
  detachSiteBuildRuntimeJsonV1,
  requireSiteBuildOriginInputsV1,
  siteBuildRenderOriginInputsDigestV1,
  siteBuildRuntimeFilesDigestV1,
  observeSiteBuildRuntimePackagesV1,
  NP_SITE_BUILD_RUNTIME_METADATA as runtimeMetadata,
  NP_SITE_BUILD_RENDER_INPUT as renderInput,
  NP_SITE_BUILD_RUNTIME_ROOTS as runtimeRoots,
  NP_SITE_BUILD_RUNTIME_EXCLUDED as runtimeExcluded,
  NP_SITE_BUILD_RENDER_ORIGIN_PROFILE,
  type NpSiteBuildRuntimeFileV1,
} from "./render-runtime-cache.js";

const maximumInput = 8 * 1024 * 1024;
const maximumFile = 512n * 1024n * 1024n;
const maximumTotal = 4n * 1024n * 1024n * 1024n;
const cacheTarget = "/np/output/next-cache";
const cachePaths = new Set([".next/cache", ".next/standalone/.next/cache"]);
const inside = (root: string, path: string) => path === root || path.startsWith(`${root}/`);
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.nlink === b.nlink &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const omitted = (path: string): boolean =>
  path
    .split("/")
    .some((name) =>
      /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|\.agents|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
        name,
      ),
    ) || /^\.nexpress\/site(?:\/|$)/iu.test(path);

interface Lease {
  path: string;
  identity: BigIntStats;
  target?: string;
  resolved?: string;
}
export interface NpFrozenPreparedSiteBuildRenderProjectV1 {
  root: string;
  project: string;
  renderer: NpAgentBuildDirectionRendererV1;
  runtimeFilesDigest: string;
  originInputsDigest?: string;
  assertOriginalUnchanged(): Promise<void>;
  close(): Promise<void>;
}

/** Copy only; this neither executes the project nor proves the outer renderer sandbox. */
export async function freezePreparedSiteBuildRenderProjectV1(options: {
  project: string;
  input: unknown;
  /** Exact original inputs observed by the provisioning owner, not an authorization assertion. */
  originInputs?: unknown;
  fixtures?: Array<{ path: string; bytes: Uint8Array }>;
  /** Live provisioning-normalized sources; runtime bytes still come from project. */
  sourceInputs?: NpPreparedSiteBuildCandidateRenderSourcesV1;
}): Promise<NpFrozenPreparedSiteBuildRenderProjectV1> {
  if (!constants.O_NOFOLLOW) throw new SiteBuildError("unavailable");
  const input = detachSiteBuildRuntimeJsonV1(options.input);
  if (Object.hasOwn(input, "renderer")) throw new SiteBuildError("input");
  let originInputs =
    options.originInputs === undefined
      ? undefined
      : requireSiteBuildOriginInputsV1(options.originInputs);
  const suppliedFixtures = options.fixtures ?? [];
  if (suppliedFixtures.length > 200) throw new SiteBuildError("input");
  let fixtureBytes = 0n;
  const fixtures = suppliedFixtures.map((fixture) => {
    if (
      !/^\.nexpress\/site\/fixtures\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(fixture.path) ||
      !(fixture.bytes instanceof Uint8Array) ||
      BigInt(fixture.bytes.byteLength) > maximumFile ||
      (fixtureBytes += BigInt(fixture.bytes.byteLength)) > maximumTotal
    )
      throw new SiteBuildError("input");
    return { path: fixture.path, bytes: Buffer.from(fixture.bytes) };
  });
  const original = await realpath(options.project);
  const sourceInputs = options.sourceInputs;
  const preparedSources = sourceInputs
    ? await requirePreparedSiteBuildCandidateRenderSourcesV1(original, sourceInputs)
    : undefined;
  if (preparedSources) {
    if (
      originInputs &&
      siteBuildRenderOriginInputsDigestV1(originInputs) !==
        siteBuildRenderOriginInputsDigestV1(preparedSources.originInputs)
    )
      throw new SiteBuildError("conflict");
    originInputs = preparedSources.originInputs;
  }
  const originInputsDigest =
    originInputs === undefined ? undefined : siteBuildRenderOriginInputsDigestV1(originInputs);
  const sourceProject = preparedSources?.project ?? original;
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-site-render-capsule-")));
  const project = join(root, "project");
  const leases: Lease[] = [];
  const links: Array<{ path: string; target: string; resolved: string | null }> = [];
  const runtimeFiles: NpSiteBuildRuntimeFileV1[] = [];
  let files = 0,
    entries = 0,
    total = 0n,
    closed = false;

  // chmod only directory entries reached without following links, within this owned root.
  const restoreDirectories = async (path: string): Promise<void> => {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    await chmod(path, 0o700);
    for (const name of await readdir(path)) await restoreDirectories(join(path, name));
  };
  const close = async () => {
    if (closed) return;
    await restoreDirectories(root);
    await rm(root, { recursive: true, force: true });
    closed = true;
  };
  const countFile = (size: bigint) => {
    if (++files > 150_000 || size < 0n || size > maximumFile || (total += size) > maximumTotal)
      throw new SiteBuildError("input");
  };
  try {
    await chmod(root, 0o700);
    const visit = async (subpath: string, depth: number): Promise<void> => {
      if (++entries > 300_000 || depth > 64 || Buffer.byteLength(subpath) > 2048)
        throw new SiteBuildError("input");
      if (subpath && omitted(subpath)) return;
      if (subpath === runtimeMetadata) throw new SiteBuildError("conflict");
      const sourceRoot =
        preparedSources && !/^(?:\.next|node_modules)(?:\/|$)/u.test(subpath)
          ? sourceProject
          : original;
      const source = join(sourceRoot, subpath),
        destination = join(project, subpath),
        before = await lstat(source, { bigint: true });
      if (before.isDirectory()) {
        leases.push({ path: source, identity: before });
        await mkdir(destination, { mode: 0o700 });
        const directory = await opendir(source);
        for await (const entry of directory) {
          if (preparedSources && !subpath && [".next", "node_modules"].includes(entry.name))
            continue;
          await visit(subpath ? `${subpath}/${entry.name}` : entry.name, depth + 1);
        }
        if (preparedSources && !subpath)
          for (const runtime of [".next", "node_modules"]) await visit(runtime, depth + 1);
      } else if (before.isSymbolicLink()) {
        const target = await readlink(source);
        if (Buffer.byteLength(target) > 2048) throw new SiteBuildError("path");
        const cache = cachePaths.has(subpath) && target === cacheTarget;
        if (!cache && (isAbsolute(target) || !inside(sourceRoot, resolve(dirname(source), target))))
          throw new SiteBuildError("path");
        const resolved = cache ? null : await realpath(source);
        if (
          resolved !== null &&
          (!inside(sourceRoot, resolved) || omitted(relative(sourceRoot, resolved)))
        )
          throw new SiteBuildError("path");
        countFile(BigInt(Buffer.byteLength(target)));
        leases.push({ path: source, identity: before, target, ...(resolved ? { resolved } : {}) });
        links.push({ path: subpath, target, resolved });
        await symlink(target, destination);
        if (((await lstat(destination)).mode & 0o777) !== Number(before.mode & 0o777n)) {
          if (typeof lchmod !== "function") throw new SiteBuildError("unavailable");
          await lchmod(destination, Number(before.mode & 0o777n));
        }
        const copied = await lstat(destination);
        if (!copied.isSymbolicLink() || (copied.mode & 0o777) !== Number(before.mode & 0o777n))
          throw new SiteBuildError("conflict");
        runtimeFiles.push({
          path: subpath,
          kind: "symlink",
          mode: Number(before.mode & 0o777n),
          bytes: Buffer.byteLength(target),
          sha256: createHash("sha256").update(target).digest("hex"),
          target,
        });
      } else {
        if (!before.isFile() || before.nlink !== 1n) throw new SiteBuildError("path");
        countFile(before.size);
        const handle = await open(
          source,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (!same(before, await handle.stat({ bigint: true })))
            throw new SiteBuildError("conflict");
          const mode = (before.mode & 0o111n) === 0n ? 0o444 : 0o555;
          const output = await open(destination, "wx", mode);
          const hash = createHash("sha256"),
            buffer = Buffer.alloc(64 * 1024);
          try {
            let offset = 0;
            while (offset < Number(before.size)) {
              const read = await handle.read(
                buffer,
                0,
                Math.min(buffer.length, Number(before.size) - offset),
                offset,
              );
              if (!read.bytesRead) throw new SiteBuildError("conflict");
              const chunk = buffer.subarray(0, read.bytesRead);
              hash.update(chunk);
              await output.writeFile(chunk);
              offset += read.bytesRead;
            }
          } finally {
            await output.close();
          }
          if (!same(before, await handle.stat({ bigint: true })))
            throw new SiteBuildError("conflict");
          leases.push({ path: source, identity: before });
          runtimeFiles.push({
            path: subpath,
            kind: "file",
            mode,
            bytes: Number(before.size),
            sha256: hash.digest("hex"),
            target: null,
          });
        } finally {
          await handle.close();
        }
      }
      if (!same(before, await lstat(source, { bigint: true })))
        throw new SiteBuildError("conflict");
    };
    await visit("", 0);
    if (!runtimeFiles.some((file) => file.path.startsWith(".next/")))
      throw new SiteBuildError("input");
    const cacheLinks = links.filter((link) => cachePaths.has(link.path));
    if (cacheLinks.length && cacheLinks.length !== cachePaths.size)
      throw new SiteBuildError("path");
    for (const link of links) {
      if (link.resolved === null) continue;
      const copiedTarget = await realpath(join(project, link.path));
      if (copiedTarget !== join(project, relative(original, link.resolved)))
        throw new SiteBuildError("path");
    }
    const ensureDirectory = async (subpath: string) => {
      let path = project;
      for (const part of subpath.split("/")) {
        path = join(path, part);
        try {
          await mkdir(path, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new SiteBuildError("path");
      }
    };
    for (const fixture of fixtures) {
      const target = join(project, fixture.path);
      await ensureDirectory(".nexpress/site/fixtures");
      let handle;
      try {
        handle = await open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (handle) {
        try {
          const info = await handle.stat({ bigint: true });
          if (!info.isFile() || info.nlink !== 1n || info.size !== BigInt(fixture.bytes.length))
            throw new SiteBuildError("conflict");
          if (!(await handle.readFile()).equals(fixture.bytes))
            throw new SiteBuildError("conflict");
        } finally {
          await handle.close();
        }
      } else {
        countFile(BigInt(fixture.bytes.length));
        await writeFile(target, fixture.bytes, { flag: "wx", mode: 0o444 });
        runtimeFiles.push({
          path: fixture.path,
          kind: "file",
          mode: 0o444,
          bytes: fixture.bytes.length,
          sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
          target: null,
        });
      }
    }
    const { observed, moduleGraph } = await observeSiteBuildRuntimePackagesV1(project);
    const runtimeFilesDigest = siteBuildRuntimeFilesDigestV1(runtimeFiles);
    await writeFile(
      join(project, runtimeMetadata),
      JSON.stringify({
        schemaVersion: "np.site-build-runtime-reference.v1",
        runtimeRoots,
        runtimeExcluded,
        runtimeFilesDigest,
        moduleGraph,
        ...(originInputs === undefined
          ? {}
          : {
              originInputs,
              originInputsDigest,
              originProfile: NP_SITE_BUILD_RENDER_ORIGIN_PROFILE,
            }),
      }),
      { flag: "wx", mode: 0o444 },
    );
    const renderer = npRequireAgentBuildDirectionRendererV1({
      schemaVersion: "np.agent-build-direction-renderer.v1",
      implementation: "np.site-build.v1",
      projectSources: (await readSiteSourceTreeV1(project)).manifest,
      packages: observed.packages,
    });
    const encoded = JSON.stringify({ ...input, renderer });
    if (Buffer.byteLength(encoded) > maximumInput) throw new SiteBuildError("input");
    const inputPath = join(project, renderInput);
    await ensureDirectory(".nexpress/site/tmp");
    await writeFile(inputPath, encoded, { flag: "wx", mode: 0o444 });
    await observed.assertUnchanged();
    const assertOriginalUnchanged = async () => {
      if ((await realpath(options.project)) !== original) throw new SiteBuildError("conflict");
      if (sourceInputs)
        await requirePreparedSiteBuildCandidateRenderSourcesV1(original, sourceInputs);
      for (const lease of leases) {
        if (
          !same(lease.identity, await lstat(lease.path, { bigint: true })) ||
          (lease.target !== undefined && (await readlink(lease.path)) !== lease.target) ||
          (lease.resolved !== undefined && (await realpath(lease.path)) !== lease.resolved)
        )
          throw new SiteBuildError("conflict");
      }
    };
    await assertOriginalUnchanged();
    // Also freeze directories created by fixture/input staging, not only copied directories.
    const freezeDirectories = async (path: string): Promise<void> => {
      for (const name of await readdir(path)) {
        const child = join(path, name),
          info = await lstat(child);
        if (info.isDirectory() && !info.isSymbolicLink()) await freezeDirectories(child);
        else if (info.isFile()) await chmod(child, (info.mode & 0o111) === 0 ? 0o444 : 0o555);
      }
      await chmod(path, 0o555);
    };
    await freezeDirectories(project);
    return {
      root,
      project,
      renderer,
      runtimeFilesDigest,
      ...(originInputsDigest === undefined ? {} : { originInputsDigest }),
      assertOriginalUnchanged,
      close,
    };
  } catch (error) {
    await close();
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("input");
  }
}
