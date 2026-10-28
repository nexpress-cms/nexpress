import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Project, ts } from "ts-morph";
import { npParseBuildJsonV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackagesV1 } from "./installed-packages.js";

const entryPath = ".next/standalone/server.js";
const requiredPath = ".next/required-server-files.json";
const evidenceDirectory = ".next/np-build-next-preview-runtime";
const maximumFileBytes = 4 * 1024 * 1024;
const ownerPaths = [
  "dist/build/utils.js",
  "dist/server/config-schema.js",
  "dist/server/next-server.js",
  "dist/server/lib/incremental-cache/file-system-cache.js",
] as const;
// Explicit observed shipped owners. A version string or lookalike JS is insufficient.
// 16.3.4 is the repository owner; 16.4.2 is the prepared Linux scaffold owner.
const profiles: Record<string, readonly string[]> = {
  "16.3.4": [
    "de18448b9bb78b8b53ddf50caecca755cbc99031ba3609ada337c65fb11ed284",
    "3dbabaa66c33eed945d522e7b44cc300a81264472c23ad70c410901cb90d1101",
    "10cf10253de1a5c5542c78696ec5bdfe9bf00436b670d3ec64b6f27ae0ac4e0c",
    "19e27d9aae8b312a7a020e57c547cbdadbccde0013cf585afac14f9f17caa4f0",
  ],
  "16.4.2": [
    "5fd190db661ac661673b75839156a52657b9ae64b790ad253ee8197a209683c2",
    "21f7f8638d6085db6eda0e2f30a3f62902c06afd33c5faa3e074e69c115c690c",
    "973a8ed699b0295f4751d32fb53043574103f19c5a43d241d99ef9574c099fca",
    "427a5a07865eb68f0335ef701636bc1e065e8809552d243333d22e5eefcaae29",
  ],
};
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new SiteBuildError("unavailable");
  return value as Record<string, unknown>;
};

// Exact shared ESM/CJS server body emitted by both pinned dist/build/utils.js owners.
const commonPrefix = `

const dir = path.join(__dirname)

process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'

let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = `;
const suffix = `

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)

require('next')
const { startServer } = require('next/dist/server/lib/start-server')

if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});`;
const esmPrefix = `performance.mark('next-start');
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import module from 'node:module'
const require = module.createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))
`;

export interface NpSiteBuildNextPreviewRuntimeReceiptV1 {
  schemaVersion: "np.site-build-next-preview-runtime.v1";
  scope: "private-preview-next-isr-flush-to-disk-false";
  status: "written" | "unchanged";
  owner: {
    name: "next";
    version: string;
    contentDigest: string;
    files: Array<{ path: string; sha256: string }>;
  };
  entry: {
    path: typeof entryPath;
    mode: number;
    original: { bytes: number; sha256: string };
    derived: { bytes: number; sha256: string };
  };
  requiredServerFiles: {
    path: typeof requiredPath;
    bytes: number;
    sha256: string;
    generatedDistDir: "./.next";
  };
  setting: { path: "experimental.isrFlushToDisk"; original: boolean | null; derived: false };
  evidence: Array<{ path: string; bytes: number; sha256: string }>;
  nativeVerification: "required-separately";
  originalSource: "unchanged-required-by-caller";
  concurrency: "private-copy-exclusive-lease-required";
}

/** Static parser only. No JS/config/getter evaluation, imports or project compiler. */
export function deriveSiteBuildNextPreviewRuntimeEntryV1(input: {
  serverSource: string;
  requiredServerFilesSource: string;
}): { source: string; originalFlushToDisk: boolean | null } {
  try {
    for (const text of [input.serverSource, input.requiredServerFilesSource])
      if (
        typeof text !== "string" ||
        text.includes("\0") ||
        Buffer.byteLength(text) > maximumFileBytes ||
        Buffer.from(text).toString("utf8") !== text
      )
        throw new SiteBuildError("unavailable");
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
    const source = project.createSourceFile("server.js", input.serverSource);
    if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length)
      throw new SiteBuildError("unavailable");
    let count = 0;
    const stack: Array<{ node: ts.Node; depth: number }> = [
      { node: source.compilerNode, depth: 0 },
    ];
    while (stack.length) {
      const current = stack.pop()!;
      if (++count > 50_000 || current.depth > 128) throw new SiteBuildError("unavailable");
      ts.forEachChild(current.node, (node) => {
        stack.push({ node, depth: current.depth + 1 });
      });
    }
    const declarations = source
      .getVariableDeclarations()
      .filter((item) => item.getName() === "nextConfig");
    if (declarations.length !== 1) throw new SiteBuildError("unavailable");
    const initializer = declarations[0].getInitializer();
    if (!initializer) throw new SiteBuildError("unavailable");
    const literal = initializer.getText();
    const config = record(npParseBuildJsonV1(literal));
    if (literal !== JSON.stringify(config)) throw new SiteBuildError("unavailable");
    if (
      ![esmPrefix, "const path = require('path')"].some(
        (prefix) => input.serverSource === prefix + commonPrefix + literal + suffix,
      )
    )
      throw new SiteBuildError("unavailable");
    const required = record(npParseBuildJsonV1(input.requiredServerFilesSource));
    const requiredConfig = record(required.config);
    if (
      required.version !== 1 ||
      ![".next", "./.next"].includes(String(requiredConfig.distDir)) ||
      JSON.stringify(config) !== JSON.stringify({ ...requiredConfig, distDir: "./.next" })
    )
      throw new SiteBuildError("unavailable");
    const experimental = record(config.experimental);
    const original = experimental.isrFlushToDisk;
    if (original !== undefined && typeof original !== "boolean")
      throw new SiteBuildError("unavailable");
    const derived = { ...config, experimental: { ...experimental, isrFlushToDisk: false } };
    const result =
      input.serverSource.slice(0, initializer.getStart()) +
      JSON.stringify(derived) +
      input.serverSource.slice(initializer.getEnd());
    if (Buffer.byteLength(result) > maximumFileBytes) throw new SiteBuildError("unavailable");
    return { source: result, originalFlushToDisk: original === undefined ? null : original };
  } catch {
    throw new SiteBuildError("unavailable");
  }
}

const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
type DirectoryLease = { path: string; handle: FileHandle; stat: BigIntStats };
async function leaseDirectory(path: string): Promise<DirectoryLease> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isDirectory()) throw new SiteBuildError("unavailable");
    return { path, handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function checkDirectories(leases: DirectoryLease[]): Promise<void> {
  for (const lease of leases) {
    const held = await lease.handle.stat({ bigint: true }),
      live = await lstat(lease.path, { bigint: true });
    for (const current of [held, live])
      if (
        !current.isDirectory() ||
        current.dev !== lease.stat.dev ||
        current.ino !== lease.stat.ino ||
        current.mode !== lease.stat.mode
      )
        throw new SiteBuildError("unavailable");
  }
}
async function readHeld(handle: FileHandle, limit: number): Promise<Buffer> {
  const stat = await handle.stat({ bigint: true });
  if (!stat.isFile() || stat.size < 0n || stat.size > BigInt(limit))
    throw new SiteBuildError("unavailable");
  const bytes = Buffer.alloc(Number(stat.size) + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const read = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!read.bytesRead) break;
    offset += read.bytesRead;
  }
  if (offset !== Number(stat.size) || !same(stat, await handle.stat({ bigint: true })))
    throw new SiteBuildError("unavailable");
  return bytes.subarray(0, offset);
}
async function readFixed(
  path: string,
  limit: number,
  singleLink = true,
): Promise<{ bytes: Buffer; stat: BigIntStats }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat({ bigint: true });
    if (singleLink && stat.nlink !== 1n) throw new SiteBuildError("unavailable");
    const bytes = await readHeld(handle, limit);
    if (!same(stat, await lstat(path, { bigint: true }))) throw new SiteBuildError("unavailable");
    return { bytes, stat };
  } finally {
    await handle.close();
  }
}

/**
 * Host-only derivation in an already owned private Linux project. A pathname is
 * not provenance: the caller must hold live prepared-source/dependency leases and
 * exclusive ownership after builder removal. This is not atomic live-repository
 * CAS. Failure/partial write invalidates the private copy; never roll back over a
 * concurrent edit. Source/config, transport policy and native guards stay intact.
 * The setting has a known shipped Next meaning, but its actual runtime effect and
 * the precise caller of an earlier blocked syscall require separate native proof.
 */
export async function deriveSiteBuildNextPreviewRuntimeV1(input: {
  scope: "private-build-copy";
  project: string;
  packages: NpObservedBuildPackagesV1;
}): Promise<NpSiteBuildNextPreviewRuntimeReceiptV1> {
  const leases: DirectoryLease[] = [];
  let entry: FileHandle | undefined;
  try {
    if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) throw new SiteBuildError("unavailable");
    const project = await realpath(input.project);
    if (
      input.scope !== "private-build-copy" ||
      project !== resolve(input.project) ||
      project === process.cwd() ||
      basename(project) !== "project" ||
      !/^(?:np-linux-project|np-private-edit-plan)-[A-Za-z0-9]+$/u.test(
        basename(dirname(project)),
      ) ||
      project.length > 2048 ||
      /[,\0]/u.test(project)
    )
      throw new SiteBuildError("unavailable");
    const parents: string[] = [];
    for (let path = project; ; path = dirname(path)) {
      parents.unshift(path);
      if (path === dirname(path)) break;
    }
    for (const path of [...parents, join(project, ".next"), join(project, ".next/standalone")])
      leases.push(await leaseDirectory(path));
    const next = input.packages.rootImports.get("next");
    if (
      !next ||
      next.name !== "next" ||
      !Object.hasOwn(profiles, next.version) ||
      !next.root.startsWith(`${project}/node_modules/`)
    )
      throw new SiteBuildError("unavailable");
    await input.packages.assertUnchanged();
    const ownerFiles: Array<{ path: string; sha256: string }> = [];
    for (const [index, path] of ["package.json", ...ownerPaths].entries()) {
      const fullPath = join(next.root, path);
      if ((await realpath(fullPath)) !== fullPath) throw new SiteBuildError("unavailable");
      const file = await readFixed(fullPath, 1024 * 1024, false);
      const hash = sha256(file.bytes);
      if (
        next.files.find((item) => item.path === path)?.sha256 !== hash ||
        (index > 0 && hash !== profiles[next.version][index - 1])
      )
        throw new SiteBuildError("unavailable");
      if (index === 0) {
        const manifest = record(npParseBuildJsonV1(file.bytes.toString("utf8")));
        if (manifest.name !== "next" || manifest.version !== next.version)
          throw new SiteBuildError("unavailable");
      }
      ownerFiles.push({ path, sha256: hash });
    }
    const path = join(project, entryPath);
    entry = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await entry.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      ![0o644n, 0o755n].includes(before.mode & 0o7777n)
    )
      throw new SiteBuildError("unavailable");
    const original = await readHeld(entry, maximumFileBytes);
    const required = await readFixed(join(project, requiredPath), maximumFileBytes);
    const projected = deriveSiteBuildNextPreviewRuntimeEntryV1({
      serverSource: new TextDecoder("utf-8", { fatal: true }).decode(original),
      requiredServerFilesSource: new TextDecoder("utf-8", { fatal: true }).decode(required.bytes),
    });
    const derived = Buffer.from(projected.source);
    const fileRecord = (bytes: Buffer) => ({ bytes: bytes.length, sha256: sha256(bytes) });
    const runtime = join(project, evidenceDirectory);
    await checkDirectories(leases);
    if (
      !same(before, await lstat(path, { bigint: true })) ||
      !same(required.stat, await lstat(join(project, requiredPath), { bigint: true }))
    )
      throw new SiteBuildError("unavailable");
    await mkdir(runtime, { mode: 0o700 });
    leases.push(await leaseDirectory(runtime));
    const evidence: NpSiteBuildNextPreviewRuntimeReceiptV1["evidence"] = [];
    for (const [name, bytes] of [
      ["original-server.js", original],
      ["derived-server.js", derived],
      ["required-server-files.json", required.bytes],
    ] as const) {
      await checkDirectories(leases);
      const target = join(runtime, name),
        handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o400,
        );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        const stat = await handle.stat({ bigint: true });
        if (
          !stat.isFile() ||
          stat.nlink !== 1n ||
          !same(stat, await lstat(target, { bigint: true }))
        )
          throw new SiteBuildError("unavailable");
      } finally {
        await handle.close();
      }
      evidence.push({ path: `${evidenceDirectory}/${name}`, ...fileRecord(bytes) });
    }
    await checkDirectories(leases);
    await input.packages.assertUnchanged();
    if (
      !same(before, await entry.stat({ bigint: true })) ||
      !same(before, await lstat(path, { bigint: true }))
    )
      throw new SiteBuildError("unavailable");
    if (!derived.equals(original)) {
      let offset = 0;
      while (offset < derived.length) {
        const written = await entry.write(derived, offset, derived.length - offset, offset);
        if (!written.bytesWritten) throw new SiteBuildError("unavailable");
        offset += written.bytesWritten;
      }
      await entry.truncate(derived.length);
      await entry.sync();
    }
    const after = await entry.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mode !== before.mode ||
      after.nlink !== 1n ||
      !same(after, await lstat(path, { bigint: true })) ||
      !(await readHeld(entry, maximumFileBytes)).equals(derived)
    )
      throw new SiteBuildError("unavailable");
    await checkDirectories(leases);
    await input.packages.assertUnchanged();
    if (
      !(await readFixed(join(project, requiredPath), maximumFileBytes)).bytes.equals(required.bytes)
    )
      throw new SiteBuildError("unavailable");
    await checkDirectories(leases);
    if (
      !same(after, await lstat(path, { bigint: true })) ||
      !(await readHeld(entry, maximumFileBytes)).equals(derived)
    )
      throw new SiteBuildError("unavailable");
    const receipt: NpSiteBuildNextPreviewRuntimeReceiptV1 = {
      schemaVersion: "np.site-build-next-preview-runtime.v1",
      scope: "private-preview-next-isr-flush-to-disk-false",
      status: derived.equals(original) ? "unchanged" : "written",
      owner: {
        name: "next",
        version: next.version,
        contentDigest: next.contentDigest,
        files: ownerFiles,
      },
      entry: {
        path: entryPath,
        mode: Number(before.mode & 0o777n),
        original: fileRecord(original),
        derived: fileRecord(derived),
      },
      requiredServerFiles: {
        path: requiredPath,
        ...fileRecord(required.bytes),
        generatedDistDir: "./.next",
      },
      setting: {
        path: "experimental.isrFlushToDisk",
        original: projected.originalFlushToDisk,
        derived: false,
      },
      evidence,
      nativeVerification: "required-separately",
      originalSource: "unchanged-required-by-caller",
      concurrency: "private-copy-exclusive-lease-required",
    };
    const manifest = Buffer.from(`${JSON.stringify(receipt)}\n`);
    if (manifest.length > 64 * 1024) throw new SiteBuildError("unavailable");
    const manifestPath = join(runtime, "manifest.json"),
      handle = await open(
        manifestPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o400,
      );
    try {
      await handle.writeFile(manifest);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await checkDirectories(leases);
    for (const file of [
      ...evidence,
      { path: `${evidenceDirectory}/manifest.json`, ...fileRecord(manifest) },
    ])
      if (
        sha256((await readFixed(join(project, file.path), maximumFileBytes)).bytes) !== file.sha256
      )
        throw new SiteBuildError("unavailable");
    if (
      JSON.stringify((await readdir(runtime)).sort()) !==
      JSON.stringify([
        "derived-server.js",
        "manifest.json",
        "original-server.js",
        "required-server-files.json",
      ])
    )
      throw new SiteBuildError("unavailable");
    if (
      !same(after, await lstat(path, { bigint: true })) ||
      !(await readHeld(entry, maximumFileBytes)).equals(derived)
    )
      throw new SiteBuildError("unavailable");
    return {
      ...receipt,
      evidence: [
        ...evidence,
        { path: `${evidenceDirectory}/manifest.json`, ...fileRecord(manifest) },
      ],
    };
  } catch {
    throw new SiteBuildError("unavailable");
  } finally {
    await entry?.close();
    await Promise.all(leases.map((lease) => lease.handle.close()));
  }
}
