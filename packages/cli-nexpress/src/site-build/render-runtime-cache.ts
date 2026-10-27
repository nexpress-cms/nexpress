import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  npParseBuildJsonV1,
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";
import {
  observeSiteBuildLinuxProjectInputsV1,
  type NpSiteBuildLinuxProjectInputsV1,
} from "./linux-project.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const maximumInput = 8 * 1024 * 1024;
export const NP_SITE_BUILD_RENDER_ORIGIN_PROFILE = "np.site-build-render-origin.v1";
export const NP_SITE_BUILD_RUNTIME_METADATA = ".np-build-runtime.json";
export const NP_SITE_BUILD_RENDER_INPUT = ".nexpress/site/tmp/render-input.json";
export const NP_SITE_BUILD_RUNTIME_ROOTS = Object.freeze(["."]);
export const NP_SITE_BUILD_RUNTIME_EXCLUDED = Object.freeze([
  NP_SITE_BUILD_RUNTIME_METADATA,
  NP_SITE_BUILD_RENDER_INPUT,
]);
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const inside = (root: string, path: string) => path === root || path.startsWith(`${root}/`);
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.nlink === b.nlink &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Descriptor-only detachment: input getters, custom prototypes and toJSON never execute. */
export function detachSiteBuildRuntimeJsonV1(value: unknown): Record<string, unknown> {
  let bytes = 0,
    nodes = 0;
  const seen = new Set<object>();
  const charge = (count: number) => {
    bytes += count;
    if (bytes > maximumInput) throw new SiteBuildError("input");
  };
  const string = (text: string) => {
    if (text.length > maximumInput) throw new SiteBuildError("input");
    charge(Buffer.byteLength(JSON.stringify(text)));
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 32) throw new SiteBuildError("input");
    if (item === null || typeof item === "boolean") {
      charge(item === null ? 4 : item ? 4 : 5);
      return item;
    }
    if (typeof item === "string") {
      string(item);
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      charge(JSON.stringify(item).length);
      return item;
    }
    if (typeof item !== "object" || item === null || seen.has(item))
      throw new SiteBuildError("input");
    const array = Array.isArray(item);
    if (
      Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) &&
      (array || Object.getPrototypeOf(item) !== null)
    )
      throw new SiteBuildError("input");
    seen.add(item);
    const properties = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length) throw new SiteBuildError("input");
    charge(2);
    let result: unknown;
    if (array) {
      const length = properties.length?.value as unknown;
      if (
        typeof length !== "number" ||
        length > 100_000 ||
        Object.keys(properties).length !== length + 1
      )
        throw new SiteBuildError("input");
      const output: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const property = properties[String(index)];
        if (!property || !("value" in property) || !property.enumerable)
          throw new SiteBuildError("input");
        if (index) charge(1);
        output.push(copy(property.value, depth + 1));
      }
      result = output;
    } else {
      const output: Record<string, unknown> = {};
      let count = 0;
      for (const [key, property] of Object.entries(properties)) {
        if (!("value" in property) || !property.enumerable) throw new SiteBuildError("input");
        if (count++) charge(1);
        string(key);
        charge(1);
        Object.defineProperty(output, key, {
          value: copy(property.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      result = output;
    }
    seen.delete(item);
    return result;
  };
  const output = copy(value, 0);
  if (output === null || typeof output !== "object" || Array.isArray(output))
    throw new SiteBuildError("input");
  return output as Record<string, unknown>;
}

/** Private byte identity only: this hash is neither a signature nor build/approval authority. */
export function siteBuildRuntimeJsonDigestV1(value: unknown): string {
  const detached = detachSiteBuildRuntimeJsonV1({ value });
  const canonical = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    return `{${Object.entries(item)
      .sort(([a], [b]) => compare(a, b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  };
  return hash(canonical(detached.value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort(compare);
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort(compare)))
    throw new SiteBuildError("input");
}
export function requireSiteBuildOriginInputsV1(value: unknown): NpSiteBuildLinuxProjectInputsV1 {
  const input = detachSiteBuildRuntimeJsonV1(value);
  exactKeys(input, [
    "schemaVersion",
    "sourceManifestSha256",
    "sourceLockSha256",
    "sourceTreeDigest",
    "renderSourceProfile",
    "renderSourceTreeDigest",
    "tarballs",
  ]);
  if (
    input.schemaVersion !== "np.site-build-linux-project-inputs.v1" ||
    typeof input.sourceManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.sourceManifestSha256) ||
    typeof input.sourceLockSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.sourceLockSha256) ||
    typeof input.sourceTreeDigest !== "string" ||
    !/^nb1:sha256:[A-Za-z0-9_-]{43}$/u.test(input.sourceTreeDigest) ||
    input.renderSourceProfile !== "np.site-build-render-input-sources.v1" ||
    typeof input.renderSourceTreeDigest !== "string" ||
    !/^nb1:sha256:[A-Za-z0-9_-]{43}$/u.test(input.renderSourceTreeDigest) ||
    !Array.isArray(input.tarballs) ||
    input.tarballs.length > 200
  )
    throw new SiteBuildError("input");
  let previous = "",
    bytes = 0;
  const tarballs = input.tarballs.map((item: unknown) => {
    const file = detachSiteBuildRuntimeJsonV1(item);
    exactKeys(file, ["reference", "sha256", "bytes"]);
    if (
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      file.reference !== `file:.nexpress/site/tmp/linux-packages/${file.sha256}.tgz` ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > 256 * 1024 * 1024 ||
      (bytes += file.bytes) > 512 * 1024 * 1024 ||
      (previous && compare(previous, String(file.reference)) >= 0)
    )
      throw new SiteBuildError("input");
    previous = String(file.reference);
    return { reference: previous, sha256: file.sha256, bytes: file.bytes };
  });
  return {
    schemaVersion: "np.site-build-linux-project-inputs.v1",
    sourceManifestSha256: input.sourceManifestSha256,
    sourceLockSha256: input.sourceLockSha256,
    sourceTreeDigest: input.sourceTreeDigest,
    renderSourceProfile: "np.site-build-render-input-sources.v1",
    renderSourceTreeDigest: input.renderSourceTreeDigest,
    tarballs,
  };
}

/** Source-tree diagnostics are deliberately outside this named render-origin byte profile. */
export function siteBuildRenderOriginInputsDigestV1(value: unknown): string {
  const input = requireSiteBuildOriginInputsV1(value);
  return siteBuildRuntimeJsonDigestV1({
    schemaVersion: NP_SITE_BUILD_RENDER_ORIGIN_PROFILE,
    renderSourceProfile: input.renderSourceProfile,
    renderSourceTreeDigest: input.renderSourceTreeDigest,
    sourceManifestSha256: input.sourceManifestSha256,
    sourceLockSha256: input.sourceLockSha256,
    tarballs: input.tarballs,
  });
}

export interface NpSiteBuildRuntimeFileV1 {
  path: string;
  kind: "file" | "symlink";
  mode: number;
  bytes: number;
  sha256: string;
  target: string | null;
}
export function siteBuildRuntimeFilesDigestV1(
  files: readonly NpSiteBuildRuntimeFileV1[],
  includeMetadata = false,
): string {
  return hash(
    JSON.stringify({
      schemaVersion: "np.site-build-runtime-files.v1",
      roots: NP_SITE_BUILD_RUNTIME_ROOTS,
      excluded: includeMetadata ? [NP_SITE_BUILD_RENDER_INPUT] : NP_SITE_BUILD_RUNTIME_EXCLUDED,
      files: [...files]
        .filter(
          (file) =>
            file.path !== NP_SITE_BUILD_RENDER_INPUT &&
            (includeMetadata || file.path !== NP_SITE_BUILD_RUNTIME_METADATA),
        )
        .sort((a, b) => compare(a.path, b.path)),
    }),
  );
}

/** Same normalized package wiring owner is used when freezing and when reobserving a cache. */
export async function observeSiteBuildRuntimePackagesV1(project: string) {
  const observed = await inspectSiteInstalledPackagesV1(project);
  const byRoot = new Map(observed.instances.map((instance) => [instance.root, instance]));
  const ordered: (typeof observed.instances)[number][] = [],
    ids = new Map<string, number>();
  const register = (path: string): number => {
    const previous = ids.get(path);
    if (previous !== undefined) return previous;
    const instance = byRoot.get(path);
    if (!instance) throw new SiteBuildError("input");
    const id = ordered.length;
    ids.set(path, id);
    ordered.push(instance);
    return id;
  };
  const roots = [...observed.rootImports]
    .sort(([a], [b]) => compare(a, b))
    .map(([specifier, instance]) => ({ specifier, instance: register(instance.root) }));
  const instances = [];
  for (let index = 0; index < ordered.length; index++) {
    const instance = ordered[index];
    instances.push({
      name: instance.name,
      version: instance.version,
      contentDigest: instance.contentDigest,
      dependencies: [...instance.dependencies]
        .sort(([a], [b]) => compare(a, b))
        .map(([specifier, path]) => ({ specifier, instance: register(path) })),
    });
  }
  return {
    observed,
    moduleGraph: { schemaVersion: "np.build-capsule-module-graph.v1", roots, instances },
  };
}

export interface NpSiteBuildRenderRuntimeCacheV1 {
  schemaVersion: "np.site-build-render-runtime-cache.v1";
  project: string;
  runtimeFilesDigest: string;
  runtimeTreeDigest: string;
  originInputsDigest: string;
  originProfile: typeof NP_SITE_BUILD_RENDER_ORIGIN_PROFILE;
  rendererDigest: string;
}
export interface NpObservedSiteBuildRenderRuntimeV1 {
  cache: NpSiteBuildRenderRuntimeCacheV1;
  renderer: NpAgentBuildDirectionRendererV1;
  originInputs: NpSiteBuildLinuxProjectInputsV1;
  installedPackages: Awaited<ReturnType<typeof inspectSiteInstalledPackagesV1>>;
  assertUnchanged(): Promise<void>;
}

async function observeReadonlyRuntime(projectPath: string) {
  if (!constants.O_NOFOLLOW) throw new SiteBuildError("unavailable");
  const project = await realpath(projectPath),
    root = dirname(project);
  const rootInfo = await lstat(root, { bigint: true });
  if (
    project !== projectPath ||
    basename(project) !== "project" ||
    dirname(root) !== (await realpath(tmpdir())) ||
    !/^np-site-render-capsule-[A-Za-z0-9]{6}$/u.test(basename(root)) ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    (rootInfo.mode & 0o777n) !== 0o700n ||
    (process.getuid && rootInfo.uid !== BigInt(process.getuid()))
  )
    throw new SiteBuildError("path");
  const files: NpSiteBuildRuntimeFileV1[] = [],
    leases: Array<{ path: string; identity: BigIntStats; target?: string; resolved?: string }> = [
      { path: root, identity: rootInfo },
    ];
  let entries = 0,
    total = 0n,
    metadataBytes: Buffer | undefined;
  const cachePaths = new Set([".next/cache", ".next/standalone/.next/cache"]);
  let cacheLinks = 0;
  const checkInput = async () => {
    const info = await lstat(join(project, NP_SITE_BUILD_RENDER_INPUT), { bigint: true });
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      (info.mode & 0o777n) !== 0o444n ||
      info.size > BigInt(maximumInput)
    )
      throw new SiteBuildError("conflict");
  };
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (++entries > 300_000 || depth > 64 || Buffer.byteLength(relative) > 2048)
      throw new SiteBuildError("input");
    const path = join(project, relative),
      before = await lstat(path, { bigint: true });
    if (relative === NP_SITE_BUILD_RENDER_INPUT) {
      await checkInput();
      return;
    }
    if (before.isDirectory()) {
      if ((before.mode & 0o777n) !== 0o555n) throw new SiteBuildError("conflict");
      leases.push({ path, identity: before });
      for await (const entry of await opendir(path))
        await walk(relative ? `${relative}/${entry.name}` : entry.name, depth + 1);
    } else {
      if (
        files.length >= 150_000 ||
        before.size < 0n ||
        before.size > 512n * 1024n * 1024n ||
        (total += before.size) > 4n * 1024n * 1024n * 1024n
      )
        throw new SiteBuildError("input");
      if (before.isSymbolicLink()) {
        const target = await readlink(path),
          cache = cachePaths.has(relative) && target === "/np/output/next-cache";
        if (
          Buffer.byteLength(target) > 2048 ||
          (!cache && (isAbsolute(target) || !inside(project, resolve(dirname(path), target))))
        )
          throw new SiteBuildError("path");
        const resolved = cache ? undefined : await realpath(path);
        if (
          resolved !== undefined &&
          (!inside(project, resolved) ||
            resolved === join(project, NP_SITE_BUILD_RUNTIME_METADATA) ||
            inside(join(project, ".nexpress/site"), resolved))
        )
          throw new SiteBuildError("path");
        if (cache) cacheLinks++;
        files.push({
          path: relative,
          kind: "symlink",
          mode: Number(before.mode & 0o777n),
          bytes: Buffer.byteLength(target),
          sha256: hash(target),
          target,
        });
        leases.push({ path, identity: before, target, ...(resolved ? { resolved } : {}) });
      } else {
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          ![0o444n, 0o555n].includes(before.mode & 0o777n)
        )
          throw new SiteBuildError("conflict");
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (!same(before, await handle.stat({ bigint: true })))
            throw new SiteBuildError("conflict");
          const digest = createHash("sha256"),
            buffer = Buffer.alloc(64 * 1024),
            metadata: Buffer[] = [];
          if (
            relative === NP_SITE_BUILD_RUNTIME_METADATA &&
            (before.size > BigInt(maximumInput) || (before.mode & 0o777n) !== 0o444n)
          )
            throw new SiteBuildError("input");
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
            digest.update(chunk);
            if (relative === NP_SITE_BUILD_RUNTIME_METADATA) metadata.push(Buffer.from(chunk));
            offset += read.bytesRead;
          }
          if (
            (await handle.read(buffer, 0, 1, offset)).bytesRead ||
            !same(before, await handle.stat({ bigint: true }))
          )
            throw new SiteBuildError("conflict");
          if (relative === NP_SITE_BUILD_RUNTIME_METADATA) metadataBytes = Buffer.concat(metadata);
          files.push({
            path: relative,
            kind: "file",
            mode: Number(before.mode & 0o777n),
            bytes: Number(before.size),
            sha256: digest.digest("hex"),
            target: null,
          });
          leases.push({ path, identity: before });
        } finally {
          await handle.close();
        }
      }
    }
    if (!same(before, await lstat(path, { bigint: true }))) throw new SiteBuildError("conflict");
  };
  await walk("", 0);
  if (
    !metadataBytes ||
    !files.some((file) => file.path.startsWith(".next/")) ||
    (cacheLinks !== 0 && cacheLinks !== 2)
  )
    throw new SiteBuildError("input");
  const assertUnchanged = async () => {
    if ((await realpath(projectPath)) !== project) throw new SiteBuildError("conflict");
    await checkInput();
    for (const lease of leases)
      if (
        !same(lease.identity, await lstat(lease.path, { bigint: true })) ||
        (lease.target !== undefined && (await readlink(lease.path)) !== lease.target) ||
        (lease.resolved !== undefined && (await realpath(lease.path)) !== lease.resolved)
      )
        throw new SiteBuildError("conflict");
  };
  await assertUnchanged();
  return { project, files, metadataBytes, assertUnchanged };
}

/** Fresh byte observation only; the caller still owns build provenance, approval and sandbox execution. */
export async function createSiteBuildRenderRuntimeCacheV1(options: {
  project: string;
  originalProjectRoot: string;
  /** Host-only physical tarball origin; exact candidate package/lock equality is rechecked. */
  tarballProjectRoot?: string;
}): Promise<NpObservedSiteBuildRenderRuntimeV1> {
  try {
    const tarballProjectRoot = options.tarballProjectRoot;
    const tree = await observeReadonlyRuntime(options.project);
    const metadata = detachSiteBuildRuntimeJsonV1(
      npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(tree.metadataBytes)),
    );
    exactKeys(metadata, [
      "schemaVersion",
      "runtimeRoots",
      "runtimeExcluded",
      "runtimeFilesDigest",
      "moduleGraph",
      "originInputs",
      "originInputsDigest",
      "originProfile",
    ]);
    const originInputs = requireSiteBuildOriginInputsV1(metadata.originInputs),
      originInputsDigest = siteBuildRenderOriginInputsDigestV1(originInputs);
    const current = requireSiteBuildOriginInputsV1(
      await observeSiteBuildLinuxProjectInputsV1(options.originalProjectRoot, {
        tarballProjectRoot,
      }),
    );
    const runtimeFilesDigest = siteBuildRuntimeFilesDigestV1(tree.files);
    if (
      metadata.schemaVersion !== "np.site-build-runtime-reference.v1" ||
      JSON.stringify(metadata.runtimeRoots) !== JSON.stringify(NP_SITE_BUILD_RUNTIME_ROOTS) ||
      JSON.stringify(metadata.runtimeExcluded) !== JSON.stringify(NP_SITE_BUILD_RUNTIME_EXCLUDED) ||
      metadata.runtimeFilesDigest !== runtimeFilesDigest ||
      metadata.originInputsDigest !== originInputsDigest ||
      metadata.originProfile !== NP_SITE_BUILD_RENDER_ORIGIN_PROFILE ||
      siteBuildRenderOriginInputsDigestV1(current) !== originInputsDigest
    )
      throw new SiteBuildError("conflict");
    const { observed: installedPackages, moduleGraph } = await observeSiteBuildRuntimePackagesV1(
      tree.project,
    );
    if (
      siteBuildRuntimeJsonDigestV1(moduleGraph) !==
      siteBuildRuntimeJsonDigestV1(metadata.moduleGraph)
    )
      throw new SiteBuildError("conflict");
    const renderer = npRequireAgentBuildDirectionRendererV1({
      schemaVersion: "np.agent-build-direction-renderer.v1",
      implementation: "np.site-build.v1",
      projectSources: (await readSiteSourceTreeV1(tree.project)).manifest,
      packages: installedPackages.packages,
    });
    const cache: NpSiteBuildRenderRuntimeCacheV1 = {
      schemaVersion: "np.site-build-render-runtime-cache.v1",
      project: tree.project,
      runtimeFilesDigest,
      runtimeTreeDigest: siteBuildRuntimeFilesDigestV1(tree.files, true),
      originInputsDigest,
      originProfile: NP_SITE_BUILD_RENDER_ORIGIN_PROFILE,
      rendererDigest: siteBuildRuntimeJsonDigestV1(renderer),
    };
    const assertUnchanged = async () => {
      await tree.assertUnchanged();
      await installedPackages.assertUnchanged();
      if (
        siteBuildRenderOriginInputsDigestV1(
          requireSiteBuildOriginInputsV1(
            await observeSiteBuildLinuxProjectInputsV1(options.originalProjectRoot, {
              tarballProjectRoot,
            }),
          ),
        ) !== originInputsDigest
      )
        throw new SiteBuildError("conflict");
      await tree.assertUnchanged();
      await installedPackages.assertUnchanged();
    };
    await assertUnchanged();
    return { cache, renderer, originInputs: current, installedPackages, assertUnchanged };
  } catch (error) {
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("input");
  }
}

/** Untrusted cache claims never replace the independently supplied expected/approved renderer. */
export async function reuseSiteBuildRenderRuntimeCacheV1(options: {
  cache: unknown;
  originalProjectRoot: string;
  expectedRenderer: unknown;
  /** In-process relocation input only, never serialized into the cache descriptor. */
  tarballProjectRoot?: string;
}): Promise<NpObservedSiteBuildRenderRuntimeV1> {
  try {
    const cache = detachSiteBuildRuntimeJsonV1(options.cache);
    exactKeys(cache, [
      "schemaVersion",
      "project",
      "runtimeFilesDigest",
      "runtimeTreeDigest",
      "originInputsDigest",
      "originProfile",
      "rendererDigest",
    ]);
    if (
      cache.schemaVersion !== "np.site-build-render-runtime-cache.v1" ||
      cache.originProfile !== NP_SITE_BUILD_RENDER_ORIGIN_PROFILE ||
      typeof cache.project !== "string" ||
      cache.project.length > 2048 ||
      ["runtimeFilesDigest", "runtimeTreeDigest", "originInputsDigest", "rendererDigest"].some(
        (key) => typeof cache[key] !== "string" || !/^[a-f0-9]{64}$/u.test(String(cache[key])),
      )
    )
      throw new SiteBuildError("input");
    const expected = npRequireAgentBuildDirectionRendererV1(
      detachSiteBuildRuntimeJsonV1(options.expectedRenderer),
    );
    if (siteBuildRuntimeJsonDigestV1(expected) !== cache.rendererDigest)
      throw new SiteBuildError("conflict");
    const observed = await createSiteBuildRenderRuntimeCacheV1({
      project: cache.project,
      originalProjectRoot: options.originalProjectRoot,
      tarballProjectRoot: options.tarballProjectRoot,
    });
    if (
      siteBuildRuntimeJsonDigestV1(cache) !== siteBuildRuntimeJsonDigestV1(observed.cache) ||
      siteBuildRuntimeJsonDigestV1(observed.renderer) !== siteBuildRuntimeJsonDigestV1(expected)
    )
      throw new SiteBuildError("conflict");
    return observed;
  } catch (error) {
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("input");
  }
}
