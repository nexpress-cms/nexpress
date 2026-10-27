import { createHash, createHmac } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import {
  npBuildCanonicalDigest,
  npRequireAgentBuildSourceTreeV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import type { NpObservedBuildPackagesV1 } from "./installed-packages.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const previewOwner = "dist/build/preview-key-utils.js";
// Observed shipped source, not a version-string assertion. Unknown owners fail closed.
const owners = {
  "dist/build/preview-key-utils.js":
    "328c8ac551776bc55201dd1d47bd24ec4ef2837b40fe1365539e0dd574899af6",
  "dist/build/generate-build-id.js":
    "c49ce28709205a283fdab91e5cc7d89ef10772b69fc8f4118c72ec01c1a74b54",
  "dist/server/app-render/encryption-utils-server.js":
    "68f72321506168911dfffc9ab3de8ec9634aa59ce1b53cfc7b242591331ccc22",
  "dist/trace/trace.js": "04c46dd2d1f10d40bfe8a9a01d706447559c965bc66262576aed356cf1095a39",
  "dist/trace/shared.js": "a7691a73a9d374f77f2925ce8a062c1b5030817086ef0f105534b9f09b3e9c94",
} as const;
type NextVersion = "16.3.4" | "16.4.2";
const ownerProfiles: Record<NextVersion, Record<string, string>> = {
  "16.4.2": owners,
  "16.3.4": {
    ...owners,
    "dist/build/generate-build-id.js":
      "1ed7da61f3ef90965c7593d1816c8dba1eb85d314bf951987190925b54f3607e",
    "dist/trace/trace.js": "bc735939cd5231beac096725b0ff7eaa5c00d2a477e8994b01e5f73a1610c577",
  },
};
const originalPreviewFunction = `function generateConfig() {
    return {
        previewModeId: _crypto.default.randomBytes(16).toString('hex'),
        previewModeSigningKey: _crypto.default.randomBytes(32).toString('hex'),
        previewModeEncryptionKey: _crypto.default.randomBytes(32).toString('hex')
    };
}`;
const stable = (a: BigIntStats, b: BigIntStats) =>
  ["dev", "ino", "mode", "size", "nlink", "mtimeNs", "ctimeNs"].every(
    (key) => Reflect.get(a, key) === Reflect.get(b, key),
  );
const fail = (): never => {
  throw new SiteBuildError("unavailable");
};
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const prepared = new WeakMap<
  object,
  { project: string; descriptor: string; assertUnchanged: () => Promise<void> }
>();

export interface NpSiteBuildDeterministicNextContextV1 {
  schemaVersion: "np.site-build-deterministic-next-inputs.v1";
  implementation: "np.site-build-deterministic-next.v1";
  sourceProfile: "np.site-build-render-input-sources.v1";
  sourceTreeDigest: string;
  packages: Array<{ name: string; version: string; contentDigest: string }>;
  baseImageId: string;
  nextVersion: NextVersion;
  clock: { now: string; randomSeed: string };
}
interface Artifact {
  path: string;
  bytes: number;
  sha256: string;
}
export interface NpSiteBuildDeterministicNextBuildV1 {
  scope: "private-deterministic-next-build";
  parentDirectory: string;
  directory: string;
  controlStamp: string;
  previewStamp: string;
  files: string[];
  argv: string[];
  resultPath: string;
  runtimeDirectory: ".next/np-build-deterministic-next";
  evidence: {
    schemaVersion: "np.site-build-deterministic-next-build.v1";
    scope: "private-synthetic-build-only";
    context: NpSiteBuildDeterministicNextContextV1;
    contextSha256: string;
    buildId: string;
    actionEncryptionKeySha256: string;
    trace: { id: string; thresholdMs: 900001; buildTimeoutMs: 840000 };
    nextOwner: {
      version: NextVersion;
      contentDigest: string;
      files: Array<{ path: string; sha256: string }>;
    };
    original: Artifact;
    wrapper: Artifact;
    preload: Artifact;
    driver: Artifact;
    previewAdapter: { originalSha256: string; derivedSha256: string; notePath: string };
    restoration: "required-before-source-observation";
    actualCleanBuildComparison: "required-separately";
  };
  assertUnchanged(): Promise<void>;
}

/** Pure finite input identity. It never accepts blueprint/future runtime/environment hashes. */
export async function createSiteBuildDeterministicNextContextV1(input: {
  source: Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
  packages: NpObservedBuildPackagesV1["packages"];
  baseImageId: string;
  clock: { now: string; randomSeed: string };
  nextVersion: NextVersion;
}): Promise<NpSiteBuildDeterministicNextContextV1> {
  const fields = Object.getOwnPropertyDescriptors(input.clock);
  if (
    Object.keys(fields).sort().join(",") !== "now,randomSeed" ||
    !fields.now ||
    !fields.randomSeed ||
    !("value" in fields.now) ||
    !("value" in fields.randomSeed) ||
    typeof fields.now.value !== "string" ||
    !Number.isFinite(Date.parse(fields.now.value)) ||
    new Date(fields.now.value).toISOString() !== fields.now.value ||
    typeof fields.randomSeed.value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(fields.randomSeed.value) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.baseImageId)
  )
    return fail();
  const source = npRequireAgentBuildSourceTreeV1(input.source.manifest);
  if ((await npBuildCanonicalDigest("np.build-source-tree.v1", source)) !== input.source.digest)
    return fail();
  const packages = input.packages
    .map(({ name, version, contentDigest }) => ({ name, version, contentDigest }))
    .sort(
      (a, b) =>
        compare(a.name, b.name) ||
        compare(a.version, b.version) ||
        compare(a.contentDigest, b.contentDigest),
    );
  if (
    packages.length < 1 ||
    packages.length > 4096 ||
    packages.some(
      (item, index) =>
        item.name.length > 214 ||
        item.version.length > 128 ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(item.name) ||
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/u.test(item.version) ||
        !/^npkg1:sha256:[A-Za-z0-9_-]{43}$/u.test(item.contentDigest) ||
        (index > 0 && JSON.stringify(item) === JSON.stringify(packages[index - 1])),
    )
  )
    return fail();
  if (
    !["16.3.4", "16.4.2"].includes(input.nextVersion) ||
    !packages.some((item) => item.name === "next" && item.version === input.nextVersion)
  )
    return fail();
  return {
    schemaVersion: "np.site-build-deterministic-next-inputs.v1",
    implementation: "np.site-build-deterministic-next.v1",
    sourceProfile: "np.site-build-render-input-sources.v1",
    sourceTreeDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", {
      ...source,
      files: source.files.filter((file) => !/^\.nexpress\/site(?:\/|$)/u.test(file.path)),
    }),
    packages,
    baseImageId: input.baseImageId,
    nextVersion: input.nextVersion,
    clock: { now: fields.now.value, randomSeed: fields.randomSeed.value },
  };
}
function entropy(context: NpSiteBuildDeterministicNextContextV1, label: string): Buffer {
  return createHmac("sha256", Buffer.from(context.clock.randomSeed, "hex"))
    .update("np.site-build-deterministic-next-entropy.v1\0")
    .update(JSON.stringify(context))
    .update("\0" + label)
    .digest();
}
const stamp = (bytes: Buffer) => {
  const b = Buffer.from(bytes.subarray(0, 16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Only the normal shipped scaffold form is supported; arbitrary user config hooks are unavailable. */
export function createSiteBuildDeterministicNextConfigV1(source: string, buildId: string): string {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > 1024 * 1024 ||
    source.includes("\0") ||
    Buffer.from(source).toString("utf8") !== source ||
    !/^np-[a-f0-9]{40}$/u.test(buildId)
  )
    return fail();
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
    const file = project.createSourceFile("next.config.ts", source);
    const statements = file.getStatements(),
      imports = file.getImportDeclarations(),
      assignments = file.getExportAssignments();
    if (
      project.getProgram().compilerObject.getSyntacticDiagnostics(file.compilerNode).length ||
      statements.length !== 2 ||
      imports.length !== 1 ||
      assignments.length !== 1 ||
      imports[0].getModuleSpecifierValue() !== "@nexpress/app/config/next-config" ||
      imports[0].getDefaultImport() ||
      imports[0].getNamespaceImport() ||
      imports[0].isTypeOnly() ||
      imports[0].getNamedImports().length !== 1 ||
      imports[0].getNamedImports()[0].getName() !== "createNextConfig" ||
      imports[0].getNamedImports()[0].isTypeOnly() ||
      assignments[0].isExportEquals()
    )
      return fail();
    const name = imports[0].getNamedImports()[0].getAliasNode()?.getText() ?? "createNextConfig";
    const call = assignments[0].getExpressionIfKind(SyntaxKind.CallExpression);
    if (
      !call ||
      call.getExpression().getText() !== name ||
      call.getArguments().length ||
      call.getTypeArguments().length
    )
      return fail();
    const assignment = assignments[0];
    return (
      source.slice(0, assignment.getStart()) +
      `const __npDeterministicNextOriginal = (${call.getText()});\n` +
      `if (!__npDeterministicNextOriginal || typeof __npDeterministicNextOriginal !== "object" || "generateBuildId" in __npDeterministicNextOriginal || "deploymentId" in __npDeterministicNextOriginal) throw new Error("unsupported-private-next-config");\n` +
      `export default { ...__npDeterministicNextOriginal, generateBuildId: () => ${JSON.stringify(buildId)} };` +
      source.slice(assignment.getEnd())
    );
  } catch {
    return fail();
  }
}

/** In-memory derivation of one hash-pinned Next function; no installed file/global crypto mutation. */
export function deriveSiteBuildDeterministicNextPreviewOwnerV1(input: {
  source: string;
  context: NpSiteBuildDeterministicNextContextV1;
  notePath: string;
}): string {
  if (
    sha(input.source) !== owners[previewOwner] ||
    input.source.split(originalPreviewFunction).length !== 2 ||
    !/^\/np\/project\/\.nexpress\/site\/tmp\/linux-build-[a-f0-9-]{36}\/deterministic-next-build\/preview-call\.json$/u.test(
      input.notePath,
    )
  )
    return fail();
  const value = {
    previewModeId: entropy(input.context, "preview-id").subarray(0, 16).toString("hex"),
    previewModeSigningKey: entropy(input.context, "preview-signing-key").toString("hex"),
    previewModeEncryptionKey: entropy(input.context, "preview-encryption-key").toString("hex"),
  };
  return input.source.replace(
    originalPreviewFunction,
    `let __npPreviewCalls = 0;\nfunction generateConfig() {\n` +
      `    if (++__npPreviewCalls !== 1) throw new Error("private-next-preview-call-count");\n` +
      `    require("node:fs").writeFileSync(${JSON.stringify(input.notePath)}, ${JSON.stringify(JSON.stringify({ schemaVersion: "np.site-build-next-preview-entropy-call.v1", contextSha256: sha(JSON.stringify(input.context)), ownerSha256: owners[previewOwner], calls: 1 }) + "\n")}, {flag:"wx",mode:256});\n` +
      `    return ${JSON.stringify(value)};\n}`,
  );
}

async function readStable(
  path: string,
  max: number,
): Promise<{ bytes: Buffer; identity: BigIntStats }> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const identity = await fd.stat({ bigint: true });
    if (
      !identity.isFile() ||
      identity.nlink !== 1n ||
      identity.size < 0n ||
      identity.size > BigInt(max)
    )
      return fail();
    const bytes = Buffer.alloc(Number(identity.size) + 1);
    let n = 0;
    while (n < bytes.length) {
      const r = await fd.read(bytes, n, bytes.length - n, n);
      if (!r.bytesRead) break;
      n += r.bytesRead;
    }
    if (
      n !== Number(identity.size) ||
      !stable(identity, await fd.stat({ bigint: true })) ||
      !stable(identity, await lstat(path, { bigint: true }))
    )
      return fail();
    return { bytes: bytes.subarray(0, n), identity };
  } finally {
    await fd.close();
  }
}

/** Preparation only. The caller must run argv exclusively inside its bounded Linux workspace. */
export async function prepareSiteBuildDeterministicNextBuildV1(input: {
  scope: "private-build-copy";
  project: string;
  dependencies?: string;
  source: Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
  packages: NpObservedBuildPackagesV1;
  baseImageId: string;
  clock: { now: string; randomSeed: string };
}): Promise<NpSiteBuildDeterministicNextBuildV1> {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) return fail();
  const project = await realpath(input.project),
    dependencies = await realpath(input.dependencies ?? join(project, "node_modules"));
  if (
    input.scope !== "private-build-copy" ||
    project !== resolve(input.project) ||
    project === process.cwd() ||
    basename(project) !== "project" ||
    !/^(?:np-linux-project|np-private-edit-plan)-[A-Za-z0-9]+$/u.test(basename(dirname(project))) ||
    project.includes(",")
  )
    return fail();
  await input.packages.assertUnchanged();
  const next = input.packages.rootImports.get("next");
  if (
    !next ||
    (next.version !== "16.4.2" && next.version !== "16.3.4") ||
    next.root !== (await realpath(join(dependencies, "next"))) ||
    !next.root.startsWith(dependencies + "/")
  )
    return fail();
  const nextVersion: NextVersion = next.version;
  const context = await createSiteBuildDeterministicNextContextV1({
    ...input,
    packages: input.packages.packages,
    nextVersion,
  });
  if ((await readSiteSourceTreeV1(project)).digest !== input.source.digest) return fail();
  const nextRelative = relative(dependencies, next.root);
  if (
    nextRelative.split("/").some((part) => !part || part === "." || part === "..") ||
    nextRelative.includes("\\")
  )
    return fail();
  const ownerRows: Array<{ path: string; sha256: string }> = [];
  let previewSource = "";
  for (const [path, expected] of Object.entries(ownerProfiles[nextVersion])) {
    const actual = await readStable(join(next.root, path), 128 * 1024);
    if (
      sha(actual.bytes) !== expected ||
      !next.files.some((row) => row.path === path && row.sha256 === expected)
    )
      return fail();
    ownerRows.push({ path, sha256: expected });
    if (path === previewOwner) previewSource = actual.bytes.toString("utf8");
  }
  const original = await readStable(join(project, "next.config.ts"), 1024 * 1024);
  const controlStamp = stamp(entropy(context, "workspace-control-path")),
    previewStamp = stamp(entropy(context, "preview-config-path"));
  const parentDirectory = `.nexpress/site/tmp/linux-build-${controlStamp}`,
    directory = `${parentDirectory}/deterministic-next-build`;
  const buildId = `np-${entropy(context, "build-id").toString("hex").slice(0, 40)}`,
    contextSha256 = sha(JSON.stringify(context));
  const wrapper = Buffer.from(
    createSiteBuildDeterministicNextConfigV1(original.bytes.toString("utf8"), buildId),
  );
  const notePath = `/np/project/${directory}/preview-call.json`;
  const derived = deriveSiteBuildDeterministicNextPreviewOwnerV1({
    source: previewSource,
    context,
    notePath,
  });
  const adapter = { originalSha256: owners[previewOwner], derivedSha256: sha(derived), notePath };
  const logicalNext = `/np/project/node_modules/${nextRelative}`;
  const trace = {
    id: entropy(context, "trace-id").subarray(0, 8).toString("hex"),
    thresholdMs: 900001 as const,
    buildTimeoutMs: 840000 as const,
  };
  const preload = Buffer.from(
    `const adapter=${JSON.stringify({ entry: `${logicalNext}/dist/bin/next`, path: `${logicalNext}/${previewOwner}`, originalSha256: adapter.originalSha256, derivedSha256: adapter.derivedSha256, derived })};\n${NP_SITE_BUILD_DETERMINISTIC_NEXT_PRELOAD_V1}`,
  );
  const artifact = (name: string, bytes: Buffer): Artifact => ({
    path: `${directory}/${name}`,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  const actionEncryptionKey = entropy(context, "server-actions-encryption-key").toString("base64");
  const partial = {
    schemaVersion: "np.site-build-deterministic-next-build.v1" as const,
    scope: "private-synthetic-build-only" as const,
    context,
    contextSha256,
    buildId,
    actionEncryptionKeySha256: sha(actionEncryptionKey),
    trace,
    nextOwner: { version: nextVersion, contentDigest: next.contentDigest, files: ownerRows },
    original: artifact("original.ts", original.bytes),
    wrapper: artifact("wrapper.ts", wrapper),
    preload: artifact("preload.mjs", preload),
    previewAdapter: adapter,
    restoration: "required-before-source-observation" as const,
    actualCleanBuildComparison: "required-separately" as const,
  };
  const driver = Buffer.from(
    `const plan=${JSON.stringify({ ...partial, actionEncryptionKey, originalMode: Number(original.identity.mode & 511n), nextPath: `${logicalNext}/dist/bin/next`, directory })};\n${NP_SITE_BUILD_DETERMINISTIC_NEXT_DRIVER_V1}`,
  );
  if (driver.length > 128 * 1024 || preload.length > 128 * 1024) return fail();
  const artifacts = [
    { ...partial.original, bytesValue: original.bytes },
    { ...partial.wrapper, bytesValue: wrapper },
    { ...partial.preload, bytesValue: preload },
    { ...artifact("driver.mjs", driver), bytesValue: driver },
  ];
  const directories: Array<{ path: string; fd: FileHandle; stat: BigIntStats }> = [];
  const checkDirectories = async (held: boolean) => {
    for (const entry of directories) {
      const live = await lstat(entry.path, { bigint: true });
      if (
        !live.isDirectory() ||
        ["dev", "ino", "mode"].some(
          (key) => Reflect.get(live, key) !== Reflect.get(entry.stat, key),
        )
      )
        return fail();
      if (held) {
        const current = await entry.fd.stat({ bigint: true });
        if (
          ["dev", "ino", "mode"].some(
            (key) => Reflect.get(current, key) !== Reflect.get(entry.stat, key),
          )
        )
          return fail();
      }
    }
  };
  const leaseDirectory = async (path: string) => {
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await fd.stat({ bigint: true });
      if (!stat.isDirectory()) return fail();
      directories.push({ path, fd, stat });
    } catch (error) {
      await fd.close();
      throw error;
    }
  };
  try {
    for (let path = project; ; path = dirname(path)) {
      await leaseDirectory(path);
      if (path === dirname(path)) break;
    }
    for (const path of [
      ".nexpress",
      ".nexpress/site",
      ".nexpress/site/tmp",
      parentDirectory,
      directory,
    ]) {
      await checkDirectories(true);
      const absolute = join(project, path);
      try {
        await mkdir(absolute, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || path === directory) throw error;
      }
      const stat = await lstat(absolute);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(absolute)) !== absolute)
        return fail();
      await leaseDirectory(absolute);
    }
    for (const record of artifacts) {
      await checkDirectories(true);
      const fd = await open(
        join(project, record.path),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o400,
      );
      try {
        await fd.writeFile(record.bytesValue);
        await fd.sync();
        const actual = await fd.stat({ bigint: true });
        if (
          !actual.isFile() ||
          actual.nlink !== 1n ||
          actual.size !== BigInt(record.bytesValue.length) ||
          !stable(actual, await lstat(join(project, record.path), { bigint: true }))
        )
          return fail();
      } finally {
        await fd.close();
      }
    }
    const assertUnchanged = async () => {
      await checkDirectories(false);
      await input.packages.assertUnchanged();
      if ((await readSiteSourceTreeV1(project)).digest !== input.source.digest) return fail();
      const current = await readStable(join(project, "next.config.ts"), 1024 * 1024);
      if (!current.bytes.equals(original.bytes) || !stable(current.identity, original.identity))
        return fail();
      for (const record of artifacts) {
        const current = await readStable(join(project, record.path), 128 * 1024 + 1024 * 1024);
        if (current.bytes.length !== record.bytes || sha(current.bytes) !== record.sha256)
          return fail();
      }
    };
    await assertUnchanged();
    const result: NpSiteBuildDeterministicNextBuildV1 = {
      scope: "private-deterministic-next-build",
      parentDirectory,
      directory,
      controlStamp,
      previewStamp,
      files: artifacts.map((row) => row.path),
      argv: ["/usr/local/bin/node", `/np/project/${directory}/driver.mjs`],
      resultPath: `${directory}/result.json`,
      runtimeDirectory: ".next/np-build-deterministic-next",
      evidence: { ...partial, driver: artifact("driver.mjs", driver) },
      assertUnchanged,
    };
    prepared.set(result, { project, descriptor: JSON.stringify(result), assertUnchanged });
    return result;
  } catch (error) {
    throw error instanceof SiteBuildError ? error : new SiteBuildError("unavailable");
  } finally {
    await Promise.all(directories.map((entry) => entry.fd.close()));
  }
}

/** Live internal handle check. A serialized descriptor cannot authorize another child/program. */
export async function requirePreparedSiteBuildDeterministicNextV1(
  project: string,
  value: NpSiteBuildDeterministicNextBuildV1,
): Promise<void> {
  const entry = prepared.get(value);
  if (!entry || entry.project !== project || JSON.stringify(value) !== entry.descriptor)
    return fail();
  await entry.assertUnchanged();
}

const NP_SITE_BUILD_DETERMINISTIC_NEXT_PRELOAD_V1 = String.raw`
import Module from 'node:module';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const fail=()=>{throw Error('private-next-preview-owner')};
// Node fork may inherit --import. Static/export/TypeScript workers are not the
// build entry and must retain their normal Node options and module behavior.
if(process.argv[1]&&fs.realpathSync(process.argv[1])===adapter.entry){
if(process.env.NODE_OPTIONS||fs.realpathSync(adapter.path)!==adapter.path||Module._cache[adapter.path])fail();
const previous=Module._extensions['.js'];
Module._extensions['.js']=function(module,path){
 if(path!==adapter.path)return previous(module,path);
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>131072n)fail();
 const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),live=fs.lstatSync(path,{bigint:true});
 if(['dev','ino','mode','size','mtimeNs','ctimeNs','nlink'].some(k=>before[k]!==after[k]||before[k]!==live[k])||createHash('sha256').update(bytes).digest('hex')!==adapter.originalSha256||createHash('sha256').update(adapter.derived).digest('hex')!==adapter.derivedSha256)fail();
 module._compile(adapter.derived,path);
 }finally{fs.closeSync(fd);}
};
}
`;

const NP_SITE_BUILD_DETERMINISTIC_NEXT_DRIVER_V1 = String.raw`
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project='/np/project',executable='/usr/local/bin/node';
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>['dev','ino','mode','size','nlink','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const held=[],dirs=[];let config,identity,installed=false,restored=false,built=false;
const fail=()=>{throw Error('private-next-build')};
async function parents(path){for(let p=path;;p=dirname(p)){if(!dirs.some(x=>x.path===p)){const fd=await fs.open(p,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),stat=await fd.stat({bigint:true});if(!stat.isDirectory())fail();dirs.push({path:p,fd,stat});}if(p===dirname(p))break;}}
async function check(){for(const v of dirs){const s=await fs.lstat(v.path,{bigint:true}),h=await v.fd.stat({bigint:true});if(!s.isDirectory()||['dev','ino','mode'].some(k=>s[k]!==v.stat[k]||s[k]!==h[k]))fail();}for(const v of held)if(!same(v.stat,await v.fd.stat({bigint:true}))||!same(v.stat,await fs.lstat(v.path,{bigint:true})))fail();}
async function read(fd,max){const b=Buffer.alloc(max+1);let n=0;while(n<b.length){const r=await fd.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}if(n>max)fail();return b.subarray(0,n);}
async function asset(record,max){const path=join(project,record.path);await parents(dirname(path));const fd=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),stat=await fd.stat({bigint:true});held.push({path,fd,stat});if(!stat.isFile()||stat.nlink!==1n||stat.size>BigInt(max))fail();const bytes=await read(fd,max);if(bytes.length!==record.bytes||hash(bytes)!==record.sha256)fail();return bytes;}
async function checkConfig(expected){await check();const s=await config.stat({bigint:true}),live=await fs.lstat(join(project,'next.config.ts'),{bigint:true});if(!s.isFile()||s.nlink!==1n||['dev','ino','mode'].some(k=>s[k]!==identity[k])||!same(s,live)||!(await read(config,2097152)).equals(expected)||!same(s,await config.stat({bigint:true})))fail();}
async function replace(bytes){await config.truncate(0);for(let n=0;n<bytes.length;){const r=await config.write(bytes,n,bytes.length-n,n);if(!r.bytesWritten)fail();n+=r.bytesWritten;}await config.sync();}
async function build(){
 for(const name of ['home','tmp'])await fs.mkdir(join(project,plan.directory,name),{mode:448});
 return await new Promise(resolve=>{
  const child=spawn(executable,['--max-old-space-size=3072','--import',join(project,plan.preload.path),plan.nextPath,'build'],{cwd:project,detached:true,stdio:['ignore','pipe','pipe'],env:{
   PATH:'/usr/local/bin:/usr/bin:/bin',HOME:join(project,plan.directory,'home'),TMPDIR:join(project,plan.directory,'tmp'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'1',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',CIRCLE_NODE_TOTAL:'3',RAYON_NUM_THREADS:'2',UV_THREADPOOL_SIZE:'2',OMP_NUM_THREADS:'2',
   NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:plan.actionEncryptionKey,TRACE_ID:plan.trace.id,NEXT_TRACE_SPAN_THRESHOLD_MS:String(plan.trace.thresholdMs),
   DATABASE_URL:'postgres://np_build_fixture:synthetic@127.0.0.1:61001/np_build_fixture',NP_SECRET:'np-build-synthetic-preparation-only-secret-v1',SITE_URL:'http://127.0.0.1:61000',NP_EMAIL_ADAPTER:'noop',NP_STORAGE_ADAPTER:'local',NP_JOBS_ENABLED:'0',NP_ENABLE_JOBS:'0',NP_BUILD_CAPSULE_PROJECT:project,NP_BUILD_CAPSULE_DEPENDENCIES:join(project,'node_modules')
  }});
  let stopped=false,total=0;const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')stopped=true;}};
  const stop=()=>{stopped=true;kill();};const signals=['SIGTERM','SIGINT'];for(const signal of signals)process.on(signal,stop);
  const timer=setTimeout(stop,plan.trace.buildTimeoutMs),forward=output=>bytes=>{if((total+=bytes.length)>8388608)stop();else output.write(bytes);};
  child.stdout.on('data',forward(process.stdout));child.stderr.on('data',forward(process.stderr));child.once('error',stop);child.once('close',(code,signal)=>{clearTimeout(timer);kill();for(const s of signals)process.off(s,stop);resolve(!stopped&&signal===null&&code===0);});
 });
}
let original,wrapper,preload,driver;
try{
 if(process.argv.length!==2||!constants.O_NOFOLLOW||!constants.O_DIRECTORY)fail();
 try{await fs.lstat(join(project,'.next'));fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 await parents(project);original=await asset(plan.original,1048576);wrapper=await asset(plan.wrapper,2097152);preload=await asset(plan.preload,131072);
 const own=fileURLToPath(import.meta.url);if(own!==join(project,plan.directory,'driver.mjs'))fail();
 const fd=await fs.open(own,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),stat=await fd.stat({bigint:true});held.push({path:own,fd,stat});driver=await read(fd,131072);if(!stat.isFile()||stat.nlink!==1n)fail();
 for(const owner of plan.nextOwner.files){const path=join(dirname(dirname(dirname(plan.nextPath))),owner.path);const fd=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),stat=await fd.stat({bigint:true});held.push({path,fd,stat});if(!stat.isFile()||stat.nlink!==1n||hash(await read(fd,131072))!==owner.sha256)fail();}
 config=await fs.open(join(project,'next.config.ts'),constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);identity=await config.stat({bigint:true});if(Number(identity.mode&511n)!==plan.originalMode)fail();await checkConfig(original);
 installed=true;await replace(wrapper);await checkConfig(wrapper);built=await build();
}catch{built=false;}
finally{if(installed)try{await checkConfig(wrapper);await replace(original);await checkConfig(original);restored=true;}catch{restored=false;}}
try{
 if(!restored)fail();await checkConfig(original);
 const note=await fs.readFile(plan.previewAdapter.notePath);const expected=Buffer.from(JSON.stringify({schemaVersion:'np.site-build-next-preview-entropy-call.v1',contextSha256:plan.contextSha256,ownerSha256:plan.previewAdapter.originalSha256,calls:1})+'\n');if(!note.equals(expected))fail();
 const result={schemaVersion:'np.site-build-deterministic-next-result.v1',status:built?'built':'failed',contextSha256:plan.contextSha256,buildId:plan.buildId,originalRestored:true,previewCalls:1,actualCleanBuildComparison:'required-separately'};
 const resultBytes=Buffer.from(JSON.stringify(result)+'\n');
 const file=await fs.open(join(project,plan.directory,'result.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,256);try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}finally{await file.close();}
 if(!built)fail();
 const output=join(project,'.next/np-build-deterministic-next');await parents(join(project,'.next'));await fs.mkdir(output,{mode:448});await parents(output);
 const assets=[['original.ts',original],['wrapper.ts',wrapper],['preload.mjs',preload],['driver.mjs',driver],['preview-call.json',note],['result.json',resultBytes]],rows=[];let total=0;
 for(const [name,bytes] of assets){if((total+=bytes.length)>4194304)fail();await check();const path=join(output,name),fd=await fs.open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,256);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}rows.push({path:'.next/np-build-deterministic-next/'+name,bytes:bytes.length,sha256:hash(bytes)});}
 const manifest=Buffer.from(JSON.stringify({schemaVersion:'np.site-build-deterministic-next-runtime.v1',context:plan.context,contextSha256:plan.contextSha256,nextOwner:plan.nextOwner,previewAdapter:plan.previewAdapter,buildId:plan.buildId,actionEncryptionKeySha256:plan.actionEncryptionKeySha256,trace:plan.trace,files:rows,sourceRestoration:'required-before-source-observation',actualCleanBuildComparison:'required-separately'})+'\n');
 if(manifest.length>65536)fail();await check();const mf=await fs.open(join(output,'manifest.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,256);try{await mf.writeFile(manifest);await mf.sync();}finally{await mf.close();}await checkConfig(original);
}catch{process.exitCode=1;process.stderr.write('Private deterministic Next build failed or source restoration is unconfirmed.\n');}
finally{await config?.close();await Promise.all(held.map(v=>v.fd.close()));await Promise.all(dirs.map(v=>v.fd.close()));}
`;
