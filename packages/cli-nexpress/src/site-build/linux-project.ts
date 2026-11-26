import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { npBuildCanonicalDigest, npParseBuildJsonV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { siteBuildReadOnlyImageDataArgsV1 } from "./docker-host.js";

const PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
const packageStore = ".nexpress/site/tmp/linux-packages";
const credential = (name: string): boolean =>
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|\.agents|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
    name,
  );
const excluded = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "coverage",
  ".nexpress",
  ".np-build-modules.json",
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
]);
const same = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.size === right.size &&
  left.nlink === right.nlink &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;
const hash = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new SiteBuildError("input");
  return value as Record<string, unknown>;
};

export interface NpSiteBuildLinuxProjectInputV1 {
  projectRoot: string;
  imageId: string;
  dockerEndpoint: string;
  /** Must be an empty caller-owned directory or contain only an empty config.json. */
  dockerConfig: string;
}
export interface NpSiteBuildLinuxProjectReceiptV1 {
  schemaVersion: "np.site-build-linux-project.v1";
  imageId: string;
  architecture: "arm64" | "amd64";
  nodeVersion: "v24.11.1";
  pnpmVersion: "10.33.0";
  sourceManifestSha256: string;
  sourceLockSha256: string;
  preparedManifestSha256: string;
  preparedLockSha256: string;
  sourceTreeDigest: string;
  preparedSourceTreeDigest: string;
  /** Unused override-only artifacts have no lock resolution and therefore null integrity. */
  tarballs: Array<{ reference: string; sha256: string; integrity: string | null; bytes: number }>;
  packages: Awaited<ReturnType<typeof inspectSiteInstalledPackagesV1>>["packages"];
  importProbe: { platform: "linux"; architecture: "arm64" | "x64"; core: true; sharp: string };
}
export interface NpPreparedSiteBuildLinuxProjectV1 {
  root: string;
  project: string;
  receipt: NpSiteBuildLinuxProjectReceiptV1;
  assertSourceUnchanged(): Promise<void>;
  close(): Promise<void>;
}

interface DockerHost {
  endpoint: string;
  config: string;
}
async function docker(
  host: DockerHost,
  args: readonly string[],
  timeout = 30_000,
): Promise<string> {
  return await new Promise((accept, reject) => {
    const child = spawn("docker", ["--host", host.endpoint, ...args], {
      env: { PATH, HOME: host.config, DOCKER_CONFIG: host.config, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const output: Buffer[] = [];
    let bytes = 0,
      failed = false;
    const stop = () => {
      failed = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) stop();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) stop();
    });
    const timer = setTimeout(stop, timeout);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failed || code !== 0 || signal !== null) reject(new SiteBuildError("unavailable"));
      else accept(Buffer.concat(output).toString("utf8"));
    });
  });
}

async function readStable(
  path: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; stat: BigIntStats }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size < 0n || stat.size > BigInt(maxBytes))
      throw new SiteBuildError("input");
    const bytes = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(
        bytes,
        offset,
        Math.min(64 * 1024, bytes.length - offset),
        offset,
      );
      if (!read.bytesRead) throw new SiteBuildError("conflict");
      offset += read.bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead)
      throw new SiteBuildError("conflict");
    if (
      BigInt(bytes.length) !== stat.size ||
      !same(stat, await handle.stat({ bigint: true })) ||
      !same(stat, await lstat(path, { bigint: true }))
    )
      throw new SiteBuildError("conflict");
    return { bytes, stat };
  } finally {
    await handle.close();
  }
}

function filePath(project: string, reference: string): string {
  const path = reference.slice(5);
  if (
    !reference.startsWith("file:") ||
    path.length > 2048 ||
    !/^[A-Za-z0-9_./-]+\.(?:tgz|tar\.gz)$/u.test(path)
  )
    throw new SiteBuildError("input");
  return isAbsolute(path) ? resolve(path) : resolve(project, path);
}

interface CopiedLinuxProjectInputs {
  root: string;
  project: string;
  sourceTree: Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
  preparedTree: Awaited<ReturnType<typeof readSiteSourceTreeV1>> | null;
  manifestInput: Awaited<ReturnType<typeof readStable>>;
  lockInput: Awaited<ReturnType<typeof readStable>>;
  preparedManifest: Buffer;
  lock: string;
  files: Map<string, NpSiteBuildLinuxProjectReceiptV1["tarballs"][number]>;
  assertSourceUnchanged: () => Promise<void>;
  close: () => Promise<void>;
}

/** One local owner for source omissions, FD/ancestor leases, exact tarballs and private rewrites. */
async function copyLinuxProjectInputs(
  projectRoot: string,
  prefix: "np-linux-project-" | "np-linux-project-inputs-",
  options: { tarballProjectRoot?: string } = {},
  prepareOutput = true,
): Promise<CopiedLinuxProjectInputs> {
  if (!constants.O_NOFOLLOW) throw new SiteBuildError("input");
  const original = await realpath(projectRoot);
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const project = join(root, "project");
  const leases: Array<{ path: string; stat: BigIntStats }> = [];
  const ancestors = new Map<string, BigIntStats>();
  const observeAncestors = async (path: string) => {
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      const stat = await lstat(parent, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SiteBuildError("path");
      const previous = ancestors.get(parent);
      if (
        previous &&
        (previous.dev !== stat.dev || previous.ino !== stat.ino || previous.mode !== stat.mode)
      )
        throw new SiteBuildError("conflict");
      ancestors.set(parent, stat);
      if (dirname(parent) === parent) break;
    }
  };
  const assertSourceUnchanged = async () => {
    for (const lease of leases)
      if (!same(lease.stat, await lstat(lease.path, { bigint: true })))
        throw new SiteBuildError("conflict");
    for (const [path, previous] of ancestors) {
      const stat = await lstat(path, { bigint: true });
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        previous.dev !== stat.dev ||
        previous.ino !== stat.ino ||
        previous.mode !== stat.mode
      )
        throw new SiteBuildError("conflict");
    }
  };
  try {
    if (
      root.startsWith(`${original}/`) ||
      [",", "\0", "\r", "\n"].some((value) => root.includes(value))
    )
      throw new SiteBuildError("path");
    await mkdir(project, { mode: 0o700 });
    await observeAncestors(original);
    let entries = 0,
      totalBytes = 0;
    const copy = async (relative: string): Promise<void> => {
      if (++entries > 20_000 || relative.length > 512 || relative.split("/").length > 32)
        throw new SiteBuildError("input");
      const path = relative ? join(original, relative) : original;
      const stat = await lstat(path, { bigint: true });
      if (stat.isSymbolicLink()) throw new SiteBuildError("path");
      if (stat.isDirectory()) {
        leases.push({ path, stat });
        if (relative) await mkdir(join(project, relative), { mode: 0o700 });
        for await (const entry of await opendir(path)) {
          if (!excluded.has(entry.name) && !credential(entry.name))
            await copy(relative ? `${relative}/${entry.name}` : entry.name);
        }
      } else {
        const file = await readStable(path, 64 * 1024 * 1024);
        if ((totalBytes += file.bytes.length) > 512 * 1024 * 1024)
          throw new SiteBuildError("input");
        leases.push({ path, stat: file.stat });
        // Match the canonical source modes used by the bounded builder. The
        // owner-only ancestor directories keep this private copy inaccessible.
        // Explicit chmod also closes a restrictive caller umask before helpers
        // record the exact mode that must be restored inside the builder.
        const mode = (file.stat.mode & 0o111n) === 0n ? 0o644 : 0o755;
        const destination = await open(join(project, relative), "wx", mode);
        try {
          await destination.writeFile(file.bytes);
          await destination.chmod(mode);
        } finally {
          await destination.close();
        }
      }
    };
    await copy("");
    const sourceTree = await readSiteSourceTreeV1(project);
    const manifestInput = await readStable(join(project, "package.json"), 512 * 1024);
    const lockInput = await readStable(join(project, "pnpm-lock.yaml"), 4 * 1024 * 1024);
    let tarballRoot = original;
    if (options.tarballProjectRoot !== undefined) {
      tarballRoot = await realpath(options.tarballProjectRoot);
      if (!isAbsolute(options.tarballProjectRoot) || tarballRoot !== options.tarballProjectRoot)
        throw new SiteBuildError("path");
      // Host-only relocation seam. It changes only relative tarball resolution;
      // candidate source/manifest/lock observations remain actual candidate bytes.
      // Neither a descriptor nor equal package names can authorize a rewrite.
      const manifestPath = join(tarballRoot, "package.json"),
        lockPath = join(tarballRoot, "pnpm-lock.yaml");
      await observeAncestors(manifestPath);
      await observeAncestors(lockPath);
      const baselineManifest = await readStable(manifestPath, 512 * 1024);
      const baselineLock = await readStable(lockPath, 4 * 1024 * 1024);
      if (
        !manifestInput.bytes.equals(baselineManifest.bytes) ||
        !lockInput.bytes.equals(baselineLock.bytes)
      )
        throw new SiteBuildError("conflict");
      leases.push(
        { path: manifestPath, stat: baselineManifest.stat },
        { path: lockPath, stat: baselineLock.stat },
      );
      await assertSourceUnchanged();
    }
    const manifest = record(npParseBuildJsonV1(manifestInput.bytes.toString("utf8")));
    if (
      manifest.packageManager !== "pnpm@10.33.0" ||
      manifest.workspaces !== undefined ||
      manifest.devEngines !== undefined
    )
      throw new SiteBuildError("input");
    const pnpm = manifest.pnpm === undefined ? {} : record(manifest.pnpm);
    if (Object.keys(pnpm).some((key) => key !== "overrides")) throw new SiteBuildError("input");
    const declared = new Map<string, string>();
    const dependencyRecords = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]
      .filter((key) => manifest[key] !== undefined)
      .map((key) => record(manifest[key]));
    const directLocalPaths = new Set(
      dependencyRecords.flatMap((dependencies) =>
        Object.values(dependencies)
          .filter(
            (value): value is string => typeof value === "string" && value.startsWith("file:"),
          )
          .map((reference) => filePath(tarballRoot, reference)),
      ),
    );
    if (pnpm.overrides !== undefined) dependencyRecords.push(record(pnpm.overrides));
    for (const dependencies of dependencyRecords) {
      for (const value of Object.values(dependencies)) {
        if (
          typeof value !== "string" ||
          value.length > 4096 ||
          /^(?:https?|git|git\+[^:]*|ssh|link|workspace|patch|portal):/iu.test(value) ||
          (value.includes(":") && !value.startsWith("npm:") && !value.startsWith("file:"))
        )
          throw new SiteBuildError("input");
        if (value.startsWith("file:")) declared.set(value, filePath(tarballRoot, value));
      }
    }
    let lock = lockInput.bytes.toString("utf8");
    if (
      !/^lockfileVersion: ['"]?9\.0['"]?\r?$/mu.test(lock) ||
      /(?:workspace:|link:|patchedDependencies:|pnpmfileChecksum:)/u.test(lock)
    )
      throw new SiteBuildError("input");
    const resolveLockedReference = (reference: string): string => {
      const direct = filePath(tarballRoot, reference);
      const declaredPaths = [...new Set(declared.values())];
      if (declaredPaths.includes(direct)) return direct;
      const relative = reference.slice(5);
      if (isAbsolute(relative)) throw new SiteBuildError("input");
      const suffix = relative.replace(/^(?:\.\.?\/)+/u, "");
      if (!suffix || suffix.split("/").some((part) => part === "." || part === ".."))
        throw new SiteBuildError("input");
      const candidates = declaredPaths.filter((path) => path.endsWith(`/${suffix}`));
      if (candidates.length !== 1) throw new SiteBuildError("input");
      return candidates[0];
    };
    const lockedIntegrity = new Map<string, Set<string>>();
    for (const line of lock.split(/\r?\n/u)) {
      const resolutionKey = /(?:^|[\s{'"])resolution(?:['"])?\s*:/u.test(line);
      if (!resolutionKey) {
        // pnpm v9 emits URL authority only in its owning resolution map.
        // Deprecation prose is inert. Quoted/flow/merged resolution spellings
        // and URL-shaped dependency ids are unsupported rather than bypasses.
        if (
          !/^ {4}deprecated:/u.test(line) &&
          (/(?:https?|git(?:\+[^: ]+)?|ssh):/iu.test(line) ||
            /(?:^|[\s{'"])tarball(?:['"])?\s*:/u.test(line))
        )
          throw new SiteBuildError("input");
        continue;
      }
      const resolution =
        /^ {4}resolution: \{integrity: (sha(?:256|384|512)-[A-Za-z0-9+/]+=*)(?:, tarball: ([^\s{}]+))?\}$/u.exec(
          line,
        );
      if (!resolution) throw new SiteBuildError("input");
      const tarball = resolution[2];
      if (!tarball) continue;
      if (tarball.startsWith("file:")) {
        const path = resolveLockedReference(tarball);
        const values = lockedIntegrity.get(path) ?? new Set<string>();
        values.add(resolution[1]);
        lockedIntegrity.set(path, values);
      } else {
        const url = new URL(tarball);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "registry.npmjs.org" ||
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash
        )
          throw new SiteBuildError("input");
      }
    }
    if (
      declared.size > 200 ||
      [...lockedIntegrity.keys()].some((path) => ![...declared.values()].includes(path))
    )
      throw new SiteBuildError("input");
    const files = new Map<
      string,
      { reference: string; sha256: string; integrity: string | null; bytes: number }
    >();
    let tarballBytes = 0;
    if (prepareOutput) await mkdir(join(project, packageStore), { recursive: true, mode: 0o700 });
    for (const path of new Set(declared.values())) {
      if ((await realpath(path)) !== path) throw new SiteBuildError("path");
      await observeAncestors(path);
      const contents = await readStable(path, 256 * 1024 * 1024);
      if ((tarballBytes += contents.bytes.length) > 512 * 1024 * 1024)
        throw new SiteBuildError("input");
      const integrities = lockedIntegrity.get(path);
      if (!integrities?.size && directLocalPaths.has(path)) throw new SiteBuildError("input");
      for (const integrity of integrities ?? []) {
        const split = integrity.indexOf("-");
        if (
          `${integrity.slice(0, split)}-${createHash(integrity.slice(0, split)).update(contents.bytes).digest("base64")}` !==
          integrity
        )
          throw new SiteBuildError("conflict");
      }
      leases.push({ path, stat: contents.stat });
      const digest = hash(contents.bytes);
      const reference = `file:${packageStore}/${digest}.tgz`;
      if (prepareOutput && ![...files.values()].some((file) => file.sha256 === digest))
        await writeFile(join(project, packageStore, `${digest}.tgz`), contents.bytes, {
          flag: "wx",
          mode: 0o400,
        });
      files.set(path, {
        reference,
        sha256: digest,
        integrity: integrities?.size ? [...integrities].sort()[0] : null,
        bytes: contents.bytes.length,
      });
    }
    for (const dependencies of dependencyRecords)
      for (const [key, value] of Object.entries(dependencies))
        if (typeof value === "string" && value.startsWith("file:"))
          dependencies[key] = files.get(filePath(tarballRoot, value))!.reference;
    // pnpm v9 file keys are simple portable paths here. Reject all unsupported
    // quoting/escaping instead of attempting a permissive YAML or path rewrite.
    lock = lock.replace(
      /(?<![A-Za-z0-9_])file:[A-Za-z0-9_./-]+\.(?:tgz|tar\.gz)/gu,
      (reference) => {
        const file = files.get(resolveLockedReference(reference));
        if (!file) throw new SiteBuildError("input");
        return file.reference;
      },
    );
    if (
      /(?<![A-Za-z0-9_])file:/u.test(
        lock.replace(/file:\.nexpress\/site\/tmp\/linux-packages\/[a-f0-9]{64}\.tgz/gu, ""),
      )
    )
      throw new SiteBuildError("input");
    const preparedManifest = declared.size
      ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      : manifestInput.bytes;
    // Origin re-observation needs the same input validation and leases, but no
    // normalized output. Avoid writing/re-reading unused normalized files
    // on every runtime lease check; actual provisioning still materializes them.
    let preparedTree: CopiedLinuxProjectInputs["preparedTree"] = null;
    if (prepareOutput) {
      await writeFile(join(project, "package.json"), preparedManifest);
      await writeFile(join(project, "pnpm-lock.yaml"), lock);
      await mkdir(join(project, "node_modules"), { mode: 0o700 });
      preparedTree = await readSiteSourceTreeV1(project);
    }
    await assertSourceUnchanged();
    return {
      root,
      project,
      sourceTree,
      preparedTree,
      manifestInput,
      lockInput,
      preparedManifest,
      lock,
      files,
      assertSourceUnchanged,
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("unavailable");
  }
}

export interface NpSiteBuildLinuxProjectInputsV1 {
  schemaVersion: "np.site-build-linux-project-inputs.v1";
  sourceManifestSha256: string;
  sourceLockSha256: string;
  sourceTreeDigest: string;
  /** Render-copy membership only; this does not change Core V1 source-tree exclusions. */
  renderSourceProfile: "np.site-build-render-input-sources.v1";
  renderSourceTreeDigest: string;
  tarballs: Array<{ reference: string; sha256: string; bytes: number }>;
}

async function describeLinuxProjectInputs(
  copied: CopiedLinuxProjectInputs,
): Promise<NpSiteBuildLinuxProjectInputsV1> {
  return {
    schemaVersion: "np.site-build-linux-project-inputs.v1" as const,
    sourceManifestSha256: hash(copied.manifestInput.bytes),
    sourceLockSha256: hash(copied.lockInput.bytes),
    sourceTreeDigest: copied.sourceTree.digest,
    renderSourceProfile: "np.site-build-render-input-sources.v1" as const,
    renderSourceTreeDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", {
      schemaVersion: "np.agent-build-source-tree.v1",
      files: copied.sourceTree.manifest.files.filter(
        (file) => !/^\.nexpress\/site(?:\/|$)/u.test(file.path),
      ),
    }),
    tarballs: [...new Map([...copied.files.values()].map((file) => [file.sha256, file])).values()]
      .map(({ reference, sha256, bytes }) => ({ reference, sha256, bytes }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.reference), Buffer.from(b.reference))),
  };
}

export interface NpPreparedSiteBuildCandidateRenderSourcesV1 {
  readonly project: string;
  readonly originInputs: NpSiteBuildLinuxProjectInputsV1;
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
}
const renderSourceOwners = new WeakMap<
  NpPreparedSiteBuildCandidateRenderSourcesV1,
  {
    originalProject: string;
    project: string;
    originInputs: NpSiteBuildLinuxProjectInputsV1;
    assertUnchanged(): Promise<void>;
  }
>();

/** Source-only use of the provisioning normalizer; no install, import or build. */
export async function prepareSiteBuildCandidateRenderSourcesV1(
  projectRoot: string,
  options: { tarballProjectRoot?: string } = {},
): Promise<NpPreparedSiteBuildCandidateRenderSourcesV1> {
  const originalProject = await realpath(projectRoot);
  const copied = await copyLinuxProjectInputs(originalProject, "np-linux-project-inputs-", options);
  try {
    const preparedTree = copied.preparedTree;
    if (!preparedTree) throw new SiteBuildError("unavailable");
    const originInputs = await describeLinuxProjectInputs(copied);
    let closed = false;
    const assertUnchanged = async () => {
      if (closed || (await realpath(projectRoot)) !== originalProject)
        throw new SiteBuildError("conflict");
      await copied.assertSourceUnchanged();
      if ((await readSiteSourceTreeV1(copied.project)).digest !== preparedTree.digest)
        throw new SiteBuildError("conflict");
    };
    await assertUnchanged();
    const owner = Object.freeze({
      project: copied.project,
      originInputs,
      assertUnchanged,
      async close() {
        if (closed) return;
        await copied.close();
        closed = true;
      },
    });
    renderSourceOwners.set(owner, {
      originalProject,
      project: copied.project,
      originInputs: structuredClone(originInputs),
      assertUnchanged,
    });
    return owner;
  } catch (error) {
    await copied.close();
    throw error;
  }
}

/** A saved path/descriptor cannot authorize a source/runtime composition. */
export async function requirePreparedSiteBuildCandidateRenderSourcesV1(
  originalProject: string,
  sources: NpPreparedSiteBuildCandidateRenderSourcesV1,
): Promise<{ project: string; originInputs: NpSiteBuildLinuxProjectInputsV1 }> {
  const owner = renderSourceOwners.get(sources);
  if (!owner || owner.originalProject !== originalProject) throw new SiteBuildError("conflict");
  await owner.assertUnchanged();
  return { project: owner.project, originInputs: structuredClone(owner.originInputs) };
}

/** Read-only source observation; no Docker, package-manager, import, build or network calls. */
export async function observeSiteBuildLinuxProjectInputsV1(
  projectRoot: string,
  options: {
    /** Trusted physical origin only; exact package/lock bytes are mandatory. */ tarballProjectRoot?: string;
  } = {},
): Promise<NpSiteBuildLinuxProjectInputsV1> {
  const copied = await copyLinuxProjectInputs(
    projectRoot,
    "np-linux-project-inputs-",
    options,
    false,
  );
  try {
    await copied.assertSourceUnchanged();
    const observed = await describeLinuxProjectInputs(copied);
    await copied.assertSourceUnchanged();
    return observed;
  } finally {
    await copied.close();
  }
}

/** Source-copy provisioning only. Registry access is confined to the explicit frozen pnpm install. */
export async function prepareSiteBuildLinuxProjectV1(
  input: NpSiteBuildLinuxProjectInputV1,
): Promise<NpPreparedSiteBuildLinuxProjectV1> {
  if (
    !constants.O_NOFOLLOW ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.imageId) ||
    !/^unix:\/\/\/[^?%#,]+$/u.test(input.dockerEndpoint) ||
    Array.from(input.dockerEndpoint).some((character) => character.charCodeAt(0) <= 0x20)
  )
    throw new SiteBuildError("input");
  const endpointPath = await realpath(input.dockerEndpoint.slice("unix://".length));
  if (!(await lstat(endpointPath)).isSocket()) throw new SiteBuildError("input");
  const suppliedConfig = await realpath(input.dockerConfig);
  if (!(await lstat(suppliedConfig)).isDirectory()) throw new SiteBuildError("input");
  const configEntries = await readdir(suppliedConfig);
  if (configEntries.some((entry) => entry !== "config.json")) throw new SiteBuildError("input");
  if (
    configEntries.length &&
    Object.keys(
      record(
        npParseBuildJsonV1(
          (await readStable(join(suppliedConfig, "config.json"), 4096)).bytes.toString("utf8"),
        ),
      ),
    ).length
  )
    throw new SiteBuildError("input");
  const copied = await copyLinuxProjectInputs(input.projectRoot, "np-linux-project-");
  const {
    root,
    project,
    sourceTree,
    preparedTree,
    manifestInput,
    lockInput,
    preparedManifest,
    lock,
    files,
    assertSourceUnchanged,
  } = copied;
  try {
    if (!preparedTree) throw new SiteBuildError("unavailable");
    const ownConfig = join(root, "docker-config"),
      store = join(root, "store");
    await mkdir(ownConfig, { mode: 0o700 });
    await mkdir(store, { mode: 0o700 });
    await writeFile(join(ownConfig, "config.json"), "{}\n", { flag: "wx", mode: 0o400 });
    await writeFile(join(ownConfig, "npmrc"), "", { flag: "wx", mode: 0o400 });
    await writeFile(join(ownConfig, "global-npmrc"), "", { flag: "wx", mode: 0o400 });
    const readOnlyData = join(root, "empty-image-data");
    await mkdir(readOnlyData, { mode: 0o500 });
    const host = { endpoint: `unix://${endpointPath}`, config: ownConfig, readOnlyData };
    const inspected = (
      await docker(host, [
        "image",
        "inspect",
        input.imageId,
        "--format",
        "{{.Id}} {{.Os}} {{.Architecture}}",
      ])
    ).trim();
    const architecture =
      inspected === `${input.imageId} linux arm64`
        ? "arm64"
        : inspected === `${input.imageId} linux amd64`
          ? "amd64"
          : null;
    if (!architecture) throw new SiteBuildError("unavailable");
    const run = async (args: readonly string[], network: boolean): Promise<string> => {
      const name = `np-linux-provision-${randomUUID()}`;
      try {
        return await docker(
          host,
          [
            "run",
            "--pull",
            "never",
            "--name",
            name,
            "--network",
            network ? "bridge" : "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "256",
            "--memory",
            "2g",
            "--cpus",
            "2",
            "--user",
            `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777",
            "--mount",
            `type=bind,src=${project},dst=/project,readonly`,
            ...(network
              ? [
                  "--mount",
                  `type=bind,src=${join(project, "node_modules")},dst=/project/node_modules`,
                  "--mount",
                  `type=bind,src=${store},dst=/np-store`,
                ]
              : []),
            "--mount",
            `type=bind,src=${ownConfig},dst=/np-config,readonly`,
            ...siteBuildReadOnlyImageDataArgsV1(host),
            "--workdir",
            "/project",
            "--entrypoint",
            "/usr/bin/env",
            input.imageId,
            "-i",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "HOME=/tmp/np-home",
            "TZ=UTC",
            "CI=1",
            "NO_COLOR=1",
            "NPM_CONFIG_USERCONFIG=/np-config/npmrc",
            "NPM_CONFIG_GLOBALCONFIG=/np-config/global-npmrc",
            ...args,
          ],
          network ? 15 * 60_000 : 60_000,
        );
      } finally {
        await docker(host, ["rm", "--force", "--volumes", name]);
      }
    };
    const versions = JSON.parse(
      await run(
        ["/usr/local/bin/node", "-e", "console.log(JSON.stringify({node:process.version}))"],
        false,
      ),
    ) as { node?: unknown };
    if (versions.node !== "v24.11.1") throw new SiteBuildError("unavailable");
    const pnpmVersion = (
      await run(
        ["/usr/local/bin/node", "/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs", "--version"],
        false,
      )
    ).trim();
    if (pnpmVersion !== "10.33.0") throw new SiteBuildError("unavailable");
    await assertSourceUnchanged();
    await run(
      [
        "/usr/local/bin/node",
        "/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--ignore-workspace",
        "--reporter=silent",
        "--store-dir=/np-store",
        "--package-import-method=copy",
        "--config.registry=https://registry.npmjs.org/",
        "--config.verify-store-integrity=true",
        "--config.node-linker=isolated",
        "--config.manage-package-manager-versions=false",
        "--config.update-notifier=false",
      ],
      true,
    );
    if (
      hash((await readStable(join(project, "package.json"), 512 * 1024)).bytes) !==
        hash(preparedManifest) ||
      hash((await readStable(join(project, "pnpm-lock.yaml"), 4 * 1024 * 1024)).bytes) !==
        hash(lock) ||
      (await readSiteSourceTreeV1(project)).digest !== preparedTree.digest
    )
      throw new SiteBuildError("conflict");
    const importProbe = record(
      npParseBuildJsonV1(
        await run(
          [
            "/usr/local/bin/node",
            "--input-type=module",
            "-e",
            "const core=await import('@nexpress/core'); const sharp=(await import('sharp')).default; if(typeof core.defineConfig!=='function')process.exit(1); console.log(JSON.stringify({platform:process.platform,architecture:process.arch,core:true,sharp:sharp.versions.vips}));",
          ],
          false,
        ),
      ),
    );
    if (
      importProbe.platform !== "linux" ||
      importProbe.architecture !== (architecture === "arm64" ? "arm64" : "x64") ||
      importProbe.core !== true ||
      typeof importProbe.sharp !== "string" ||
      !/^[0-9]+(?:\.[0-9]+){1,3}$/u.test(importProbe.sharp)
    )
      throw new SiteBuildError("unavailable");
    const observed = await inspectSiteInstalledPackagesV1(project);
    await observed.assertUnchanged();
    await assertSourceUnchanged();
    return {
      root,
      project,
      assertSourceUnchanged,
      receipt: {
        schemaVersion: "np.site-build-linux-project.v1",
        imageId: input.imageId,
        architecture,
        nodeVersion: "v24.11.1",
        pnpmVersion: "10.33.0",
        sourceManifestSha256: hash(manifestInput.bytes),
        sourceLockSha256: hash(lockInput.bytes),
        preparedManifestSha256: hash(preparedManifest),
        preparedLockSha256: hash(lock),
        sourceTreeDigest: sourceTree.digest,
        preparedSourceTreeDigest: preparedTree.digest,
        tarballs: [
          ...new Map([...files.values()].map((file) => [file.sha256, file])).values(),
        ].sort((a, b) => a.sha256.localeCompare(b.sha256)),
        packages: observed.packages,
        importProbe: {
          platform: "linux",
          architecture: architecture === "arm64" ? "arm64" : "x64",
          core: true,
          sharp: importProbe.sharp,
        },
      },
      close: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("unavailable");
  }
}
