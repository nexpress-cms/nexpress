import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { inspectSiteInstalledPackagesV1 } from "./installed-packages.js";
import {
  siteBuildLinuxWorkspaceBoundsV1 as boundedPreparation,
  rejectSiteBuildLinuxWorkspaceCredentialsV1 as rejectSourceCredentials,
  siteBuildLinuxWorkspaceChangesV1 as changes,
  withSiteBuildLinuxWorkspaceV1,
  type NpSiteBuildLinuxWorkspaceFileV1 as ArtifactFile,
} from "./linux-workspace.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import {
  prepareSiteBuildPreviewConfigBuildV1,
  type NpSiteBuildPreviewConfigArtifactV1,
  type NpSiteBuildPreviewConfigBuildV1,
} from "./preview-config-build.js";
import {
  deriveSiteBuildNextPreviewRuntimeV1,
  type NpSiteBuildNextPreviewRuntimeReceiptV1,
} from "./next-preview-runtime.js";
import {
  prepareSiteBuildDeterministicNextBuildV1,
  type NpSiteBuildDeterministicNextBuildV1,
} from "./deterministic-next-build.js";

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const schemaPaths = new Set(["src/db/generated/collections.ts", "src/db/generated/documents.ts"]);
const generatedMigration = (path: string) =>
  /^drizzle\/(?:[0-9]{4}_[a-z0-9_-]+\.sql|meta\/(?:_journal|[0-9]{4}_snapshot)\.json)$/u.test(path);
type SourceTree = Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
export interface NpSiteBuildLinuxPreviewConfigReceiptV1 {
  schemaVersion: "np.site-build-linux-preview-config.v1";
  scope: "forum-build-preview-analytics-only";
  rendererStage: "pre-command-source-and-prepared-linux-packages";
  compiledConfig: "explicit-private-harness-derivation";
  preCommandSourceDigest: string;
  rawPreCommandSourceDigest: string;
  preCommandRendererDigest: string;
  finalSourceDigest: string;
  preparation: NpSiteBuildPreviewConfigBuildV1["evidence"];
  helperArgv: string[];
  carrier: NpSiteBuildPreviewConfigArtifactV1;
  runtimeArtifacts: ArtifactFile[];
  runtimeManifestSha256: string;
  resultSha256: string;
  originalConfigRestored: true;
  observation: "after-builder-removal";
}
export interface NpSiteBuildLinuxBuildReceiptV1 {
  schemaVersion: "np.site-build-linux-build.v1";
  project: string;
  baseImageId: string;
  sourceBefore: SourceTree;
  sourceAfter: SourceTree;
  changedSources: string[];
  migrations: "generated-private-baseline" | "preserved-existing";
  migrationOwner: "@nexpress/app/scripts/generate-migrations-core.generateMigrations";
  runtimeCache: {
    profile: "np.site-build-next-cache.v1";
    mappings: Array<{ path: string; target: "/np/output/next-cache" }>;
  };
  commands: Array<{
    id: "schema-generate" | "migration-generate" | "next-build";
    argv: string[];
    exitCode: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    stdout: { path: string; sha256: string; bytes: number };
    stderr: { path: string; sha256: string; bytes: number };
  }>;
  buildId: string;
  artifacts: ArtifactFile[];
  artifactManifestSha256: string;
  auditPath: string;
  /** Private runtime evidence only; no source/public deployment publication authority. */
  previewConfig?: NpSiteBuildLinuxPreviewConfigReceiptV1;
  /** Explicit private compiled entry only; source Next config is never edited. */
  nextPreviewRuntime?: NpSiteBuildNextPreviewRuntimeReceiptV1;
  deterministicNext?: {
    preparation: NpSiteBuildDeterministicNextBuildV1["evidence"];
    runtimeArtifacts: ArtifactFile[];
  };
  /** Actual preparation profile only; legacy finalization never adds this claim. */
  boundedPreparation?: {
    profile: "np.site-build-linux-build-tmpfs.v1";
    volumeBytes: 4294967296;
    volumeInodes: 131072;
    sourceBytes: 536870912;
    sourceFileBytes: 67108864;
    nextBytes: 2147483648;
    nextFiles: 100000;
    nextFileBytes: 268435456;
    exportChunkBytes: 4194304;
    observation: "after-builder-removal";
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function verifyCommandLogs(
  project: string,
  commands: NpSiteBuildLinuxBuildReceiptV1["commands"],
): Promise<void> {
  if (commands.length > 10) throw new SiteBuildError("input");
  for (const command of commands) {
    if (command.exitCode !== 0) throw new SiteBuildError("input");
    for (const log of [command.stdout, command.stderr]) {
      if (
        !/^\.nexpress\/site\/audit\/linux-build-[a-f0-9-]{36}\/[a-z-]+\.(?:stdout|stderr)\.log$/u.test(
          log.path,
        ) ||
        !Number.isInteger(log.bytes) ||
        log.bytes < 0 ||
        log.bytes > 8 * 1024 * 1024
      )
        throw new SiteBuildError("path");
      const path = join(project, log.path);
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(log.bytes))
          throw new SiteBuildError("conflict");
        const bytes = Buffer.alloc(log.bytes + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(bytes, offset, bytes.length - offset, null);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        const after = await lstat(path, { bigint: true });
        if (
          offset !== log.bytes ||
          digest(bytes.subarray(0, offset)) !== log.sha256 ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        )
          throw new SiteBuildError("conflict");
      } finally {
        await handle.close();
      }
    }
  }
}

async function artifactManifest(root: string): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [];
  let total = 0;
  const visit = async (relativePath: string) => {
    const path = join(root, relativePath);
    const before = await lstat(path, { bigint: true });
    if (before.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(`${relativePath}/${entry}`);
      return;
    }
    if (files.length >= 100_000 || relativePath.length > 2048) throw new SiteBuildError("input");
    if (before.isSymbolicLink()) {
      const target = await readlink(path);
      const cache = cachePaths.has(relativePath) && target === cacheTarget;
      const resolved = cache ? root : await realpath(path);
      if ((!cache && !resolved.startsWith(`${root}/`)) || target.length > 2048)
        throw new SiteBuildError("path");
      files.push({
        path: relativePath,
        kind: "symlink",
        mode: Number(before.mode & 0o777n),
        bytes: Buffer.byteLength(target),
        sha256: digest(target),
        target,
      });
      return;
    }
    if (!before.isFile() || before.size < 0n || before.size > 256n * 1024n * 1024n)
      throw new SiteBuildError("input");
    total += Number(before.size);
    if (total > 2 * 1024 * 1024 * 1024) throw new SiteBuildError("input");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const piece of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      bytes += chunk.length;
      if (bytes > Number(before.size)) throw new SiteBuildError("conflict");
      hash.update(chunk);
    }
    const after = await lstat(path, { bigint: true });
    if (
      bytes !== Number(before.size) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new SiteBuildError("conflict");
    files.push({
      path: relativePath,
      kind: "file",
      mode: Number(before.mode & 0o777n),
      bytes,
      sha256: hash.digest("hex"),
      target: null,
    });
  };
  await visit(".next");
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

async function createDrivers(project: string, config: string, sourceBefore: SourceTree) {
  const stamp = randomUUID();
  const tmpPath = `.nexpress/site/tmp/linux-build-${stamp}`;
  const auditPath = `.nexpress/site/audit/linux-build-${stamp}`;
  await mkdir(join(project, tmpPath), { recursive: true, mode: 0o700 });
  await mkdir(join(project, auditPath), { recursive: true, mode: 0o700 });
  await writeFile(
    join(project, auditPath, "source-before.json"),
    `${JSON.stringify(sourceBefore)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await Promise.all(
    ["home", "tmp"].map((path) => mkdir(join(project, tmpPath, path), { mode: 0o700 })),
  );
  const driver = `${tmpPath}/schema.mjs`;
  await writeFile(
    join(project, driver),
    `import config from ${JSON.stringify(`file:///np/project/${config}`)};\nimport {generateSchema} from "@nexpress/app/scripts/generate-schema";\ngenerateSchema({config,projectRoot:"/np/project"});\n`,
    { flag: "wx", mode: 0o400 },
  );
  await writeFile(
    join(project, tmpPath, "migrations.mjs"),
    'import {generateMigrations} from "@nexpress/app/scripts/generate-migrations-core";\nawait generateMigrations();\n',
    { flag: "wx", mode: 0o400 },
  );
  return { tmpPath, auditPath, driver };
}

const previewRuntime = ".next/np-build-preview-config";
const previewLimits = {
  "original.ts": 1024 * 1024,
  "wrapper.ts": 2 * 1024 * 1024,
  "renderer.json": 4 * 1024 * 1024,
  "driver.mjs": 128 * 1024,
  "carrier.mjs": 128 * 1024,
  "result.json": 32 * 1024,
  "manifest.json": 64 * 1024,
} as const;
type PreviewName = keyof typeof previewLimits;
const maximumPreviewBytes = 8 * 1024 * 1024;
async function readBoundedPreviewFile(
  project: string,
  path: string,
  limit: number,
): Promise<Buffer> {
  const file = await open(
    join(project, path),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(limit))
      throw new SiteBuildError("conflict");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat({ bigint: true }),
      live = await lstat(join(project, path), { bigint: true });
    for (const current of [after, live])
      if (
        before.dev !== current.dev ||
        before.ino !== current.ino ||
        before.size !== current.size ||
        before.mode !== current.mode ||
        before.nlink !== current.nlink ||
        before.mtimeNs !== current.mtimeNs ||
        before.ctimeNs !== current.ctimeNs
      )
        throw new SiteBuildError("conflict");
    if (length !== Number(before.size)) throw new SiteBuildError("conflict");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

interface PreparedPreview {
  helper: NpSiteBuildPreviewConfigBuildV1;
  carrier: NpSiteBuildPreviewConfigArtifactV1;
  source: SourceTree;
  rendererDigest: string;
  renderSourceDigest: string;
  files: Map<PreviewName, Buffer>;
}
const previewResult = (helper: NpSiteBuildPreviewConfigBuildV1) => ({
  schemaVersion: "np.site-build-preview-config-build-result.v1",
  scope: "forum-build-preview-analytics-only",
  status: "built",
  originalRestored: true,
  requiresPostBuilderSourceObservation: true,
  original: helper.evidence.original,
  wrapper: helper.evidence.wrapper,
  renderer: helper.evidence.renderer,
  driver: {
    path: helper.evidence.driver.path,
    bytes: helper.evidence.driver.bytes,
    sha256: helper.evidence.driver.sha256,
  },
});

/** Fixed private runtime carrier; no copied bytes are public static assets or source publication. */
async function preparePreview(
  project: string,
  configPath: "nexpress.config.ts" | "src/nexpress.config.ts",
  parentDirectory: string,
  source: SourceTree,
  packages: Awaited<ReturnType<typeof inspectSiteInstalledPackagesV1>>,
  deterministicNext?: NpSiteBuildDeterministicNextBuildV1,
): Promise<PreparedPreview> {
  const renderer = npRequireAgentBuildDirectionRendererV1({
    schemaVersion: "np.agent-build-direction-renderer.v1",
    implementation: "np.site-build.v1",
    // Planning artifacts may contain the future preview environment hash. The
    // fixed render-source profile omits them; the full raw source remains in
    // the caller's full raw CAS/command receipt.
    projectSources: {
      ...source.manifest,
      files: source.manifest.files.filter((file) => !/^\.nexpress\/site(?:\/|$)/u.test(file.path)),
    },
    packages: packages.packages,
  });
  const renderSourceDigest = await npBuildCanonicalDigest(
    "np.build-source-tree.v1",
    renderer.projectSources,
  );
  const rendererDigest = await npBuildCanonicalDigest("np.build-direction-renderer.v1", renderer);
  const helper = await prepareSiteBuildPreviewConfigBuildV1({
    scope: "private-build-copy",
    project,
    configPath,
    parentDirectory,
    renderer,
    ...(deterministicNext ? { deterministicNext } : {}),
  });
  const original = source.manifest.files.find((file) => file.path === configPath);
  // The bounded workspace transports canonical modes, never silently chmod an input.
  if (
    !original ||
    original.digest !== helper.evidence.original.fileDigest ||
    helper.evidence.originalMode !== (original.mode === "100755" ? 0o755 : 0o644)
  )
    throw new SiteBuildError("input");
  const carrierPath = `${parentDirectory}/preview-build.mjs`;
  const prefix = {
    schemaVersion: "np.site-build-preview-config-runtime.v1",
    scope: "forum-build-preview-analytics-only",
    rendererStage: "pre-command-source-and-prepared-linux-packages",
    compiledConfig: "explicit-private-harness-derivation",
    preCommandSourceDigest: renderSourceDigest,
    preCommandRendererDigest: rendererDigest,
    preparation: helper.evidence,
    helperArgv: helper.argv,
    carrierPath,
  };
  const bytes = Buffer.from(
    `const input=${JSON.stringify({ prefix, expectedResult: previewResult(helper), resultPath: helper.resultPath })};\n${previewCarrierSource}`,
  );
  const carrier = {
    path: carrierPath,
    bytes: bytes.length,
    sha256: digest(bytes),
    fileDigest: await npBuildFileDigest("np.build-verification-artifact.v1", bytes),
  };
  if (bytes.length > previewLimits["carrier.mjs"]) throw new SiteBuildError("input");
  await writeFile(join(project, carrier.path), bytes, { flag: "wx", mode: 0o400 });
  const files = new Map<PreviewName, Buffer>();
  for (const name of ["original.ts", "wrapper.ts", "renderer.json", "driver.mjs"] as const) {
    const record =
      helper.evidence[
        name === "original.ts"
          ? "original"
          : name === "wrapper.ts"
            ? "wrapper"
            : name === "renderer.json"
              ? "renderer"
              : "driver"
      ];
    const contents = await readBoundedPreviewFile(project, record.path, previewLimits[name]);
    if (contents.length !== record.bytes || digest(contents) !== record.sha256)
      throw new SiteBuildError("conflict");
    files.set(name, contents);
  }
  files.set("carrier.mjs", bytes);
  files.set("result.json", Buffer.from(`${JSON.stringify(previewResult(helper))}\n`));
  const rows = [...files].map(([name, value]) => ({
    path: `${previewRuntime}/${name}`,
    bytes: value.length,
    sha256: digest(value),
  }));
  files.set("manifest.json", Buffer.from(`${JSON.stringify({ ...prefix, files: rows })}\n`));
  if (
    files.get("manifest.json")!.length > previewLimits["manifest.json"] ||
    [...files.values()].reduce((sum, value) => sum + value.length, 0) > maximumPreviewBytes
  )
    throw new SiteBuildError("input");
  await packages.assertUnchanged();
  changes(source, await readSiteSourceTreeV1(project), () => false);
  return { helper, carrier, source, rendererDigest, renderSourceDigest, files };
}

async function verifyPreview(
  project: string,
  prepared: PreparedPreview,
  after: SourceTree,
  artifacts: ArtifactFile[],
): Promise<NpSiteBuildLinuxPreviewConfigReceiptV1> {
  const expectedPaths = [...prepared.files.keys()]
    .map((name) => `${previewRuntime}/${name}`)
    .sort();
  const runtimeArtifacts = artifacts.filter((file) => file.path.startsWith(`${previewRuntime}/`));
  if (
    JSON.stringify(runtimeArtifacts.map((file) => file.path).sort()) !==
      JSON.stringify(expectedPaths) ||
    JSON.stringify((await readdir(join(project, previewRuntime))).sort()) !==
      JSON.stringify([...prepared.files.keys()].sort())
  )
    throw new SiteBuildError("conflict");
  for (const [name, expected] of prepared.files) {
    const bytes = await readBoundedPreviewFile(
      project,
      `${previewRuntime}/${name}`,
      previewLimits[name],
    );
    const observed = runtimeArtifacts.find((file) => file.path === `${previewRuntime}/${name}`);
    if (
      !bytes.equals(expected) ||
      observed?.kind !== "file" ||
      observed.target !== null ||
      observed.bytes !== bytes.length ||
      observed.sha256 !== digest(bytes)
    )
      throw new SiteBuildError("conflict");
  }
  for (const item of [
    prepared.helper.evidence.original,
    prepared.helper.evidence.wrapper,
    prepared.helper.evidence.renderer,
    prepared.helper.evidence.driver,
    prepared.carrier,
  ]) {
    const bytes = await readBoundedPreviewFile(project, item.path, item.bytes);
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256)
      throw new SiteBuildError("conflict");
  }
  const configPath = prepared.helper.evidence.configPath;
  const oldConfig = prepared.source.manifest.files.find((file) => file.path === configPath),
    currentConfig = after.manifest.files.find((file) => file.path === configPath);
  if (!oldConfig || JSON.stringify(currentConfig) !== JSON.stringify(oldConfig))
    throw new SiteBuildError("conflict");
  return {
    schemaVersion: "np.site-build-linux-preview-config.v1",
    scope: "forum-build-preview-analytics-only",
    rendererStage: "pre-command-source-and-prepared-linux-packages",
    compiledConfig: "explicit-private-harness-derivation",
    preCommandSourceDigest: prepared.renderSourceDigest,
    rawPreCommandSourceDigest: prepared.source.digest,
    preCommandRendererDigest: prepared.rendererDigest,
    finalSourceDigest: after.digest,
    preparation: prepared.helper.evidence,
    helperArgv: [...prepared.helper.argv],
    carrier: prepared.carrier,
    runtimeArtifacts,
    runtimeManifestSha256: digest(prepared.files.get("manifest.json")!),
    resultSha256: digest(prepared.files.get("result.json")!),
    originalConfigRestored: true,
    observation: "after-builder-removal",
  };
}

const previewCarrierSource = String.raw`
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
const project='/np/project',root='.next/np-build-preview-config';
const hash=b=>createHash('sha256').update(b).digest('hex');
const limits={'original.ts':1048576,'wrapper.ts':2097152,'renderer.json':4194304,'driver.mjs':131072,'carrier.mjs':131072,'result.json':32768,'manifest.json':65536};
const handles=[],leases=[];let total=0;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
async function read(path,max){const fd=await open(join(project,path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);handles.push(fd);const stat=await fd.stat({bigint:true});if(!stat.isFile()||stat.nlink!==1n||stat.size<0n||stat.size>BigInt(max))throw Error();const bytes=Buffer.alloc(Number(stat.size)+1);let n=0;while(n<bytes.length){const v=await fd.read(bytes,n,bytes.length-n,n);if(!v.bytesRead)break;n+=v.bytesRead;}if(n!==Number(stat.size)||!same(stat,await fd.stat({bigint:true}))||!same(stat,await lstat(join(project,path),{bigint:true})))throw Error();leases.push({path,fd,stat});return bytes.subarray(0,n);}
async function stable(){for(const v of leases)if(!same(v.stat,await v.fd.stat({bigint:true}))||!same(v.stat,await lstat(join(project,v.path),{bigint:true})))throw Error();}
async function directory(path){const fd=await open(join(project,path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);handles.push(fd);const stat=await fd.stat({bigint:true});if(!stat.isDirectory())throw Error();return {path,fd,stat};}
async function checkDir(v){const s=await lstat(join(project,v.path),{bigint:true}),held=await v.fd.stat({bigint:true});if(!s.isDirectory()||s.dev!==v.stat.dev||s.ino!==v.stat.ino||s.mode!==v.stat.mode||held.ino!==s.ino||held.dev!==s.dev)throw Error();}
try{
 const assets=new Map();for(const [name,key] of [['original.ts','original'],['wrapper.ts','wrapper'],['renderer.json','renderer'],['driver.mjs','driver']]){const r=input.prefix.preparation[key],b=await read(r.path,limits[name]);if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error();assets.set(name,b);}
 const own=await read(input.prefix.carrierPath,limits['carrier.mjs']);assets.set('carrier.mjs',own);
 const argv=input.prefix.helperArgv;
 const code=await new Promise((resolve,reject)=>{const child=spawn(argv[0],argv.slice(1),{cwd:project,env:process.env,stdio:'inherit'});child.once('error',reject);child.once('close',(code,signal)=>resolve(signal===null?code:null));});
 if(code!==0)throw Error();await stable();
 const result=await read(input.resultPath,limits['result.json']);if(!result.equals(Buffer.from(JSON.stringify(input.expectedResult)+'\n')))throw Error();assets.set('result.json',result);
 const config=await read(input.prefix.preparation.configPath,1048576);if(!config.equals(assets.get('original.ts')))throw Error();
 const base=await directory('.next');await mkdir(join(project,root),{mode:448});const output=await directory(root);
 const rows=[];async function write(name,bytes){if(bytes.length>limits[name]||(total+=bytes.length)>8388608)throw Error();await checkDir(base);await checkDir(output);const path=root+'/'+name;const fd=await open(join(project,path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,256);handles.push(fd);await fd.writeFile(bytes);await fd.sync();const stat=await fd.stat({bigint:true});if(!stat.isFile()||stat.nlink!==1n||stat.size!==BigInt(bytes.length)||!same(stat,await lstat(join(project,path),{bigint:true})))throw Error();rows.push({path,bytes:bytes.length,sha256:hash(bytes)});}
 for(const [name,bytes] of assets)await write(name,bytes);
 await stable();await checkDir(base);await checkDir(output);
 await write('manifest.json',Buffer.from(JSON.stringify({...input.prefix,files:rows})+'\n'));
 await stable();await checkDir(base);await checkDir(output);
}catch{process.exitCode=1;process.stderr.write('Private preview config derivation failed.\n');}
finally{await Promise.all(handles.map(fd=>fd.close()));}
`;

const cacheTarget = "/np/output/next-cache" as const;
const cachePaths = new Set([".next/cache", ".next/standalone/.next/cache"]);
async function installCacheMappings(
  project: string,
): Promise<NpSiteBuildLinuxBuildReceiptV1["runtimeCache"]> {
  for (const path of cachePaths) {
    const absolute = join(project, path);
    if (await exists(absolute)) {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        if ((await readlink(absolute)) === cacheTarget) continue;
        throw new SiteBuildError("path");
      }
      if (!info.isDirectory()) throw new SiteBuildError("path");
      await rm(absolute, { recursive: true, force: false });
    }
    await symlink(cacheTarget, absolute);
  }
  return {
    profile: "np.site-build-next-cache.v1",
    mappings: [...cachePaths].map((path) => ({ path, target: cacheTarget })),
  };
}

function requireDeterministicNextEvidence(
  plan: NpSiteBuildDeterministicNextBuildV1,
  buildId: string,
  artifacts: ArtifactFile[],
): NonNullable<NpSiteBuildLinuxBuildReceiptV1["deterministicNext"]> {
  const preparation = plan.evidence;
  if (buildId !== preparation.buildId) throw new SiteBuildError("conflict");
  const directory = plan.runtimeDirectory;
  const note = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "np.site-build-next-preview-entropy-call.v1",
      contextSha256: preparation.contextSha256,
      ownerSha256: preparation.previewAdapter.originalSha256,
      calls: 1,
    })}\n`,
  );
  const result = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "np.site-build-deterministic-next-result.v1",
      status: "built",
      contextSha256: preparation.contextSha256,
      buildId,
      originalRestored: true,
      previewCalls: 1,
      actualCleanBuildComparison: "required-separately",
    })}\n`,
  );
  const retained = (name: string, asset: { bytes: number; sha256: string }) => ({
    path: `${directory}/${name}`,
    bytes: asset.bytes,
    sha256: asset.sha256,
  });
  const expected = [
    retained("original.ts", preparation.original),
    retained("wrapper.ts", preparation.wrapper),
    retained("preload.mjs", preparation.preload),
    retained("driver.mjs", preparation.driver),
    { path: `${directory}/preview-call.json`, bytes: note.length, sha256: digest(note) },
    { path: `${directory}/result.json`, bytes: result.length, sha256: digest(result) },
  ];
  const manifest = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "np.site-build-deterministic-next-runtime.v1",
      context: preparation.context,
      contextSha256: preparation.contextSha256,
      nextOwner: preparation.nextOwner,
      previewAdapter: preparation.previewAdapter,
      buildId,
      actionEncryptionKeySha256: preparation.actionEncryptionKeySha256,
      trace: preparation.trace,
      files: expected.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      sourceRestoration: "required-before-source-observation",
      actualCleanBuildComparison: "required-separately",
    })}\n`,
  );
  const rows = [
    ...expected,
    { path: `${directory}/manifest.json`, bytes: manifest.length, sha256: digest(manifest) },
  ];
  const actual = artifacts.filter((file) => file.path.startsWith(`${directory}/`));
  if (actual.length !== rows.length || manifest.length > 65536)
    throw new SiteBuildError("conflict");
  for (const row of rows) {
    const found = actual.find((file) => file.path === row.path);
    if (found?.kind !== "file" || found.bytes !== row.bytes || found.sha256 !== row.sha256)
      throw new SiteBuildError("conflict");
  }
  return { preparation, runtimeArtifacts: actual };
}

// Internal host owners shared with the fixed repository command executor. These
// exports accept no model command or execution grant; the executor must retain
// the actual bounded-workspace command, export and removal provenance.
export {
  artifactManifest as observeSiteBuildNextArtifactsV1,
  preparePreview as prepareSiteBuildNextPreviewControlsV1,
  verifyPreview as verifySiteBuildNextPreviewControlsV1,
  installCacheMappings as installSiteBuildNextCacheMappingsV1,
  requireDeterministicNextEvidence as requireSiteBuildDeterministicNextEvidenceV1,
};

/** Explicit private Linux preparation only: no package scripts, production migration apply or render claim. */
export async function prepareSiteBuildLinuxBuildV1(input: {
  project: string;
  baseImageId: string;
  /** Fixed host preparation option, never forwarded from a model/request artifact. */
  previewConfig?: "forum-build-preview-analytics-only";
  /** Observed selected comparison clock. Never a blueprint/future runtime hash. */
  deterministicNextClock?: { now: string; randomSeed: string };
}): Promise<NpSiteBuildLinuxBuildReceiptV1> {
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.baseImageId) ||
    (input.previewConfig !== undefined &&
      input.previewConfig !== "forum-build-preview-analytics-only") ||
    (input.deterministicNextClock !== undefined && input.previewConfig === undefined)
  )
    throw new SiteBuildError("input");
  const project = await realpath(input.project);
  if (
    project !== resolve(input.project) ||
    basename(project) !== "project" ||
    !/^np-linux-project-[A-Za-z0-9]+$/u.test(basename(dirname(project))) ||
    project.includes(",") ||
    project === process.cwd()
  )
    throw new SiteBuildError("path");
  if (await exists(join(project, ".next"))) throw new SiteBuildError("conflict");
  await rejectSourceCredentials(project);
  const sourceBefore = await readSiteSourceTreeV1(project);
  const configPath = (["nexpress.config.ts", "src/nexpress.config.ts"] as const).filter((path) =>
    sourceBefore.manifest.files.some((file) => file.path === path),
  );
  if (
    configPath.length !== 1 ||
    !sourceBefore.manifest.files.some((file) => file.path === "drizzle.config.ts")
  )
    throw new SiteBuildError("input");
  const dependencies = await realpath(join(project, "node_modules"));
  const cli = await realpath(join(dependencies, "@nexpress/cli"));
  if (
    !cli.startsWith(`${dependencies}/`) ||
    !(await lstat(join(cli, "dist/site-build-loader.js"))).isFile()
  )
    throw new SiteBuildError("path");
  for (const path of ["next/dist/bin/next", "drizzle-kit/bin.cjs"])
    if (!(await realpath(join(dependencies, path))).startsWith(`${dependencies}/`))
      throw new SiteBuildError("path");
  const { tmpPath, auditPath, driver } = await createDrivers(project, configPath[0], sourceBefore);
  // Observe the installed Linux closure, rather than reuse the original host graph.
  const packages = input.previewConfig ? await inspectSiteInstalledPackagesV1(project) : undefined;
  let preview =
    packages && !input.deterministicNextClock
      ? await preparePreview(project, configPath[0], tmpPath, sourceBefore, packages)
      : undefined;
  let deterministicNext: NpSiteBuildDeterministicNextBuildV1 | undefined;
  const commands: NpSiteBuildLinuxBuildReceiptV1["commands"] = [];
  let previous = sourceBefore;
  const changedSources = new Set<string>();
  const existingMigrations = sourceBefore.manifest.files.filter((file) =>
    file.path.startsWith("drizzle/"),
  );
  if (
    existingMigrations.some((file) => !generatedMigration(file.path)) ||
    (existingMigrations.length > 0 &&
      (!existingMigrations.some((file) => file.path.endsWith(".sql")) ||
        !existingMigrations.some((file) => file.path === "drizzle/meta/_journal.json")))
  )
    throw new SiteBuildError("input");
  await withSiteBuildLinuxWorkspaceV1(
    {
      project,
      dependencies,
      baseImageId: input.baseImageId,
      source: previous,
      controls: {
        directory: tmpPath,
        files: [
          driver,
          `${tmpPath}/migrations.mjs`,
          ...(preview ? [...preview.helper.files, preview.carrier.path] : []),
        ],
      },
      auditPath,
    },
    async (workspace) => {
      const step = async (
        id: NpSiteBuildLinuxBuildReceiptV1["commands"][number]["id"],
        argv: string[],
        permitted: (path: string) => boolean,
        timeoutMs: number,
      ) => {
        commands.push(await workspace.run({ id, argv, permitted, timeoutMs }));
      };
      const loader = `/np/project/${relative(project, join(cli, "dist/site-build-loader.js"))}`;
      await step(
        "schema-generate",
        ["/usr/local/bin/node", "--no-warnings", "--loader", loader, `/np/project/${driver}`],
        (path) => schemaPaths.has(path),
        60_000,
      );
      await step(
        "migration-generate",
        ["/usr/local/bin/node", `/np/project/${tmpPath}/migrations.mjs`],
        generatedMigration,
        180_000,
      );
      if (!input.deterministicNextClock) {
        await step(
          "next-build",
          preview
            ? ["/usr/local/bin/node", `/np/project/${preview.carrier.path}`]
            : [
                "/usr/local/bin/node",
                "--max-old-space-size=3072",
                "/np/project/node_modules/next/dist/bin/next",
                "build",
              ],
          (path) => path === "next-env.d.ts" || path === "tsconfig.json",
          15 * 60_000,
        );
        const artifacts = await workspace.finalizeNextAndExport();
        if (
          digest(JSON.stringify(await artifactManifest(project))) !==
          digest(JSON.stringify(artifacts))
        )
          throw new SiteBuildError("conflict");
      }
      previous = workspace.source;
      for (const path of workspace.changedSources) changedSources.add(path);
    },
  );
  if (input.deterministicNextClock) {
    if (!packages) throw new SiteBuildError("input");
    // Generated source is now freshly observed after the first builder was
    // removed. The second builder receives stable controls derived from those
    // actual bytes, never from a future blueprint or runtime identity.
    deterministicNext = await prepareSiteBuildDeterministicNextBuildV1({
      scope: "private-build-copy",
      project,
      dependencies,
      source: previous,
      packages,
      baseImageId: input.baseImageId,
      clock: input.deterministicNextClock,
    });
    preview = await preparePreview(
      project,
      configPath[0],
      deterministicNext.parentDirectory,
      previous,
      packages,
      deterministicNext,
    );
    const preparedPreview = preview;
    await deterministicNext.assertUnchanged();
    await withSiteBuildLinuxWorkspaceV1(
      {
        project,
        dependencies,
        baseImageId: input.baseImageId,
        source: previous,
        controls: {
          directory: deterministicNext.parentDirectory,
          files: [...new Set([...preparedPreview.helper.files, preparedPreview.carrier.path])],
        },
        auditPath,
      },
      async (workspace) => {
        commands.push(
          await workspace.run({
            id: "next-build",
            argv: ["/usr/local/bin/node", `/np/project/${preparedPreview.carrier.path}`],
            permitted: (path) => path === "next-env.d.ts" || path === "tsconfig.json",
            timeoutMs: 15 * 60_000,
          }),
        );
        const exported = await workspace.finalizeNextAndExport();
        if (
          digest(JSON.stringify(await artifactManifest(project))) !==
          digest(JSON.stringify(exported))
        )
          throw new SiteBuildError("conflict");
        previous = workspace.source;
        for (const path of workspace.changedSources) changedSources.add(path);
      },
    );
  }
  for (const path of schemaPaths)
    if (!(await exists(join(project, path)))) throw new SiteBuildError("input");
  const generated = previous.manifest.files.filter((file) => file.path.startsWith("drizzle/"));
  if (
    !generated.some((file) => file.path.endsWith(".sql")) ||
    !generated.some((file) => file.path === "drizzle/meta/_journal.json")
  )
    throw new SiteBuildError("input");
  const standalone = join(project, ".next/standalone");
  if (!(await lstat(join(standalone, "server.js"))).isFile()) throw new SiteBuildError("input");
  const buildId = (await readFile(join(project, ".next/BUILD_ID"), "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(buildId)) throw new SiteBuildError("input");
  const runtimeCache = await installCacheMappings(project);
  const nextPreviewRuntime = packages
    ? await deriveSiteBuildNextPreviewRuntimeV1({ scope: "private-build-copy", project, packages })
    : undefined;
  const artifacts = await artifactManifest(project);
  if (nextPreviewRuntime) {
    for (const file of [
      { path: nextPreviewRuntime.entry.path, ...nextPreviewRuntime.entry.derived },
      nextPreviewRuntime.requiredServerFiles,
      ...nextPreviewRuntime.evidence,
    ]) {
      const observed = artifacts.find((item) => item.path === file.path);
      if (
        observed?.kind !== "file" ||
        observed.bytes !== file.bytes ||
        observed.sha256 !== file.sha256
      )
        throw new SiteBuildError("conflict");
    }
  }
  const sourceAfter = await readSiteSourceTreeV1(project);
  changes(previous, sourceAfter, () => false);
  await packages?.assertUnchanged();
  const previewConfig = preview
    ? await verifyPreview(project, preview, sourceAfter, artifacts)
    : undefined;
  const deterministicReceipt = deterministicNext
    ? requireDeterministicNextEvidence(deterministicNext, buildId, artifacts)
    : undefined;
  await verifyCommandLogs(project, commands);
  const receipt: NpSiteBuildLinuxBuildReceiptV1 = {
    schemaVersion: "np.site-build-linux-build.v1",
    project,
    baseImageId: input.baseImageId,
    sourceBefore,
    sourceAfter,
    changedSources: [...changedSources].sort(),
    migrations: [...changedSources].some((path) => generatedMigration(path))
      ? "generated-private-baseline"
      : "preserved-existing",
    migrationOwner: "@nexpress/app/scripts/generate-migrations-core.generateMigrations",
    runtimeCache,
    commands,
    buildId,
    artifacts,
    artifactManifestSha256: digest(JSON.stringify(artifacts)),
    auditPath,
    boundedPreparation,
    ...(previewConfig ? { previewConfig } : {}),
    ...(nextPreviewRuntime ? { nextPreviewRuntime } : {}),
    ...(deterministicReceipt ? { deterministicNext: deterministicReceipt } : {}),
  };
  await writeFile(join(project, auditPath, "receipt.json"), `${JSON.stringify(receipt)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return receipt;
}

/** Complete an earlier owned preparation receipt without repeating its successful Next build.
 * Structure alone never proves prior execution: current source, artifacts and log bytes are rechecked.
 */
export async function finalizeSiteBuildLinuxBuildV1(
  receipt: Omit<NpSiteBuildLinuxBuildReceiptV1, "runtimeCache" | "migrationOwner"> &
    Partial<Pick<NpSiteBuildLinuxBuildReceiptV1, "runtimeCache" | "migrationOwner">>,
): Promise<NpSiteBuildLinuxBuildReceiptV1> {
  if (
    // A compiled preview harness cannot be rebound by a legacy migration-only finalizer.
    // Prepare a fresh candidate, which rebuilds and rechecks its explicit derivation.
    receipt.previewConfig !== undefined ||
    receipt.nextPreviewRuntime !== undefined ||
    receipt.deterministicNext !== undefined ||
    receipt.schemaVersion !== "np.site-build-linux-build.v1" ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.baseImageId)
  )
    throw new SiteBuildError("input");
  const project = await realpath(receipt.project);
  if (
    project !== receipt.project ||
    basename(project) !== "project" ||
    !/^np-linux-project-[A-Za-z0-9]+$/u.test(basename(dirname(project)))
  )
    throw new SiteBuildError("path");
  const before = await readSiteSourceTreeV1(project);
  if (
    before.digest !== receipt.sourceAfter.digest ||
    digest(JSON.stringify(await artifactManifest(project))) !== receipt.artifactManifestSha256
  )
    throw new SiteBuildError("conflict");
  if (
    (await readFile(join(project, ".next/BUILD_ID"), "utf8")).trim() !== receipt.buildId ||
    receipt.commands.length > 10
  )
    throw new SiteBuildError("conflict");
  await verifyCommandLogs(project, receipt.commands);
  await rejectSourceCredentials(project);
  const configs = before.manifest.files.filter((file) =>
    ["nexpress.config.ts", "src/nexpress.config.ts"].includes(file.path),
  );
  if (configs.length !== 1) throw new SiteBuildError("input");
  const paths = await createDrivers(project, configs[0].path, before);
  const commands = [...receipt.commands];
  let previous = before;
  const changedSources = new Set(receipt.changedSources);
  await withSiteBuildLinuxWorkspaceV1(
    {
      project,
      dependencies: await realpath(join(project, "node_modules")),
      baseImageId: receipt.baseImageId,
      source: before,
      controls: {
        directory: paths.tmpPath,
        files: [paths.driver, `${paths.tmpPath}/migrations.mjs`],
      },
      auditPath: paths.auditPath,
    },
    async (workspace) => {
      commands.push(
        await workspace.run({
          id: "migration-generate",
          argv: ["/usr/local/bin/node", `/np/project/${paths.tmpPath}/migrations.mjs`],
          permitted: generatedMigration,
          timeoutMs: 180_000,
        }),
      );
      previous = workspace.source;
      for (const path of workspace.changedSources) changedSources.add(path);
    },
  );
  const runtimeCache = await installCacheMappings(project);
  const artifacts = await artifactManifest(project);
  const sourceAfter = await readSiteSourceTreeV1(project);
  changes(previous, sourceAfter, () => false);
  await verifyCommandLogs(project, commands);
  const updated: NpSiteBuildLinuxBuildReceiptV1 = {
    ...receipt,
    boundedPreparation: undefined,
    migrationOwner: "@nexpress/app/scripts/generate-migrations-core.generateMigrations",
    runtimeCache,
    commands,
    sourceAfter,
    changedSources: [...changedSources].sort(),
    migrations:
      changes(before, previous, generatedMigration).length > 0
        ? "generated-private-baseline"
        : receipt.migrations,
    artifacts,
    artifactManifestSha256: digest(JSON.stringify(artifacts)),
    auditPath: paths.auditPath,
  };
  await writeFile(join(project, paths.auditPath, "receipt.json"), JSON.stringify(updated) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return updated;
}
