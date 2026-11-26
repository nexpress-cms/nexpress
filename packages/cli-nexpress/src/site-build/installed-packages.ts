import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  npBuildInstalledPackageContentDigestV1,
  npRequireBuildInstalledPackageContentV1,
  npParseBuildJsonV1,
  type NpAgentBuildDirectionRendererV1,
  type NpBuildInstalledPackageContentV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";

type JsonRecord = Record<string, unknown>;
interface Lease {
  path: string;
  identity: BigIntStats;
}
export interface NpObservedBuildPackageV1 {
  root: string;
  name: string;
  version: string;
  contentDigest: string;
  manifest: JsonRecord;
  files: NpBuildInstalledPackageContentV1["files"];
  dependencies: Map<string, string>;
}
export interface NpObservedBuildPackagesV1 {
  packages: NpAgentBuildDirectionRendererV1["packages"];
  instances: readonly NpObservedBuildPackageV1[];
  rootImports: ReadonlyMap<string, NpObservedBuildPackageV1>;
  assertUnchanged(): Promise<void>;
}
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  a.nlink === b.nlink;
const record = (value: unknown): JsonRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new SiteBuildError("input");
  return value as JsonRecord;
};
const dependencyMap = (value: unknown): JsonRecord => (value === undefined ? {} : record(value));
const inside = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** Read-only installed-file observation. No imports, package manager, lifecycle scripts or registry requests. */
export async function inspectSiteInstalledPackagesV1(
  cwd: string,
): Promise<NpObservedBuildPackagesV1> {
  if (!constants.O_NOFOLLOW) throw new SiteBuildError("unavailable");
  const root = await realpath(cwd),
    modules = await realpath(join(root, "node_modules"));
  if (!inside(root, modules)) throw new SiteBuildError("path");
  const instances = new Map<string, NpObservedBuildPackageV1>();
  const leases: Lease[] = [];
  const rootImports = new Map<string, NpObservedBuildPackageV1>();
  const resolutions: Array<{ path: string; target: string }> = [];
  let filesRead = 0;
  let entriesRead = 0;
  let payloadBytes = 0n;

  async function readManifest(path: string): Promise<JsonRecord> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size < 0n || before.size > 512n * 1024n)
        throw new SiteBuildError("input");
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (
        length !== Number(before.size) ||
        !same(before, await handle.stat({ bigint: true })) ||
        !same(before, await lstat(path, { bigint: true }))
      )
        throw new SiteBuildError("input");
      leases.push({ path, identity: before });
      return record(
        npParseBuildJsonV1(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
        ),
      );
    } finally {
      await handle.close();
    }
  }
  const project = await readManifest(join(root, "package.json"));

  async function resolvePackage(name: string, from: string): Promise<string | null> {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name))
      throw new SiteBuildError("input");
    let current = from;
    while (inside(root, current)) {
      const candidate = join(current, "node_modules", name);
      try {
        const resolved = await realpath(candidate);
        // Workspace/home links need a separate observed source owner; never broaden mounts implicitly.
        if (!inside(modules, resolved)) throw new SiteBuildError("unavailable");
        resolutions.push({ path: candidate, target: resolved });
        return resolved;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (current === root) break;
      current = dirname(current);
    }
    return null;
  }

  async function rawDigest(path: string, expected: BigIntStats): Promise<string> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat({ bigint: true });
      if (
        !before.isFile() ||
        !same(before, expected) ||
        before.size < 0n ||
        before.size > BigInt(Number.MAX_SAFE_INTEGER)
      )
        throw new SiteBuildError("input");
      const hash = createHash("sha256"),
        buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < Number(before.size)) {
        const read = await file.read(
          buffer,
          0,
          Math.min(buffer.length, Number(before.size) - offset),
          offset,
        );
        if (!read.bytesRead) throw new SiteBuildError("input");
        offset += read.bytesRead;
        hash.update(buffer.subarray(0, read.bytesRead));
      }
      if (
        !same(before, await file.stat({ bigint: true })) ||
        !same(before, await lstat(path, { bigint: true }))
      )
        throw new SiteBuildError("input");
      leases.push({ path, identity: before });
      return hash.digest("hex");
    } finally {
      await file.close();
    }
  }

  async function inspect(packageRoot: string): Promise<NpObservedBuildPackageV1> {
    const prior = instances.get(packageRoot);
    if (prior) return prior;
    if (instances.size >= 2000) throw new SiteBuildError("input");
    const json = await readManifest(join(packageRoot, "package.json"));
    const name = typeof json.name === "string" ? json.name : "",
      version = typeof json.version === "string" ? json.version : "";
    const files: Array<{ path: string; mode: "100644" | "100755"; sha256: string }> = [];
    async function walk(subpath: string): Promise<void> {
      const path = subpath ? join(packageRoot, subpath) : packageRoot;
      const before = await lstat(path, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) throw new SiteBuildError("path");
      leases.push({ path, identity: before });
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (++entriesRead > 400_000) throw new SiteBuildError("input");
        // Dependency instances have their own inventories; .git is not package payload.
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const child = subpath ? `${subpath}/${entry.name}` : entry.name;
        if (child.length > 512) throw new SiteBuildError("path");
        const childPath = join(packageRoot, child),
          info = await lstat(childPath, { bigint: true });
        if (info.isSymbolicLink()) throw new SiteBuildError("path");
        if (info.isDirectory()) {
          await walk(child);
          continue;
        }
        if (
          !info.isFile() ||
          ++filesRead > 300_000 ||
          files.length >= 10_000 ||
          info.size > 256n * 1024n * 1024n ||
          (payloadBytes += info.size) > 2n * 1024n * 1024n * 1024n
        )
          throw new SiteBuildError("input");
        const mode = (info.mode & 0o111n) === 0n ? "100644" : "100755";
        // Use the owning path/credential rules before reading file content.
        npRequireBuildInstalledPackageContentV1({
          schemaVersion: "np.installed-package-content.v1",
          name,
          version,
          files:
            child === "package.json"
              ? [{ path: child, mode, sha256: "0".repeat(64) }]
              : [
                  { path: "package.json", mode: "100644", sha256: "0".repeat(64) },
                  { path: child, mode, sha256: "0".repeat(64) },
                ].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))),
        });
        files.push({ path: child, mode, sha256: await rawDigest(childPath, info) });
      }
      if (!same(before, await lstat(path, { bigint: true }))) throw new SiteBuildError("input");
    }
    await walk("");
    files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const contentDigest = await npBuildInstalledPackageContentDigestV1({
      schemaVersion: "np.installed-package-content.v1",
      name,
      version,
      files,
    });
    const observed: NpObservedBuildPackageV1 = {
      root: packageRoot,
      name,
      version,
      contentDigest,
      manifest: json,
      files,
      dependencies: new Map(),
    };
    // Register before descending to support actual dependency cycles.
    instances.set(packageRoot, observed);
    // Export-less CommonJS packages (including Next) resolve their own bare name through
    // the installed parent node_modules directory. Preserve that observed edge too.
    const self = await resolvePackage(name, packageRoot);
    if (self) {
      await inspect(self);
      observed.dependencies.set(name, self);
    }
    const dependencies = dependencyMap(json.dependencies),
      optional = dependencyMap(json.optionalDependencies),
      peers = dependencyMap(json.peerDependencies),
      peerMeta = dependencyMap(json.peerDependenciesMeta);
    for (const dependency of new Set([
      ...Object.keys(dependencies),
      ...Object.keys(optional),
      ...Object.keys(peers),
    ])) {
      const target = await resolvePackage(dependency, packageRoot);
      const optionalPeer =
        Object.hasOwn(peerMeta, dependency) && record(peerMeta[dependency]).optional === true;
      if (!target) {
        if (
          Object.hasOwn(optional, dependency) ||
          (!Object.hasOwn(dependencies, dependency) && optionalPeer)
        )
          continue;
        throw new SiteBuildError("unavailable");
      }
      await inspect(target);
      observed.dependencies.set(dependency, target);
    }
    return observed;
  }

  const required = {
    ...dependencyMap(project.dependencies),
    ...dependencyMap(project.devDependencies),
  };
  const optionalRoot = dependencyMap(project.optionalDependencies);
  for (const name of [
    ...new Set([...Object.keys(required), ...Object.keys(optionalRoot)]),
  ].sort()) {
    const target = await resolvePackage(name, root);
    if (!target) {
      if (!Object.hasOwn(required, name)) continue;
      throw new SiteBuildError("unavailable");
    }
    rootImports.set(name, await inspect(target));
  }
  async function assertUnchanged(): Promise<void> {
    for (const resolution of resolutions)
      if ((await realpath(resolution.path)) !== resolution.target)
        throw new SiteBuildError("input");
    for (const lease of leases)
      if (!same(lease.identity, await lstat(lease.path, { bigint: true })))
        throw new SiteBuildError("input");
  }
  await assertUnchanged();
  const packageByContent = new Map<string, NpAgentBuildDirectionRendererV1["packages"][number]>();
  for (const item of instances.values()) {
    const value = { name: item.name, version: item.version, contentDigest: item.contentDigest };
    packageByContent.set(`${value.name}@${value.version}:${value.contentDigest}`, value);
  }
  const packages = [...packageByContent.values()].sort(
    (a, b) =>
      Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)) ||
      Buffer.compare(Buffer.from(a.version), Buffer.from(b.version)) ||
      Buffer.compare(Buffer.from(a.contentDigest), Buffer.from(b.contentDigest)),
  );
  // Absolute locators and leases stay private and never enter canonical identities.
  return { packages, instances: [...instances.values()], rootImports, assertUnchanged };
}
