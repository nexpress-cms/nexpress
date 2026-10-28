import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { Project, SyntaxKind, ts } from "ts-morph";
import {
  npBuildFileDigest,
  npRequireAgentBuildDirectionRendererV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  requirePreparedSiteBuildDeterministicNextV1,
  type NpSiteBuildDeterministicNextBuildV1,
} from "./deterministic-next-build.js";

type ConfigPath = "nexpress.config.ts" | "src/nexpress.config.ts";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const parentDirectoryPattern = new RegExp(
  String.raw`^\.nexpress/site/tmp/(?:linux-build|command-executor)-${uuid}$`,
  "u",
);
const directoryPattern = new RegExp(
  String.raw`^\.nexpress/site/tmp/(?:(?:linux-build|command-executor)-${uuid}/)?preview-config-build-${uuid}$`,
  "u",
);
const sourceLimit = 1024 * 1024;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export interface NpSiteBuildPreviewConfigArtifactV1 {
  path: string;
  bytes: number;
  sha256: string;
  fileDigest: string;
}
export interface NpSiteBuildPreviewConfigBuildV1 {
  scope: "private-build-preview-config";
  directory: string;
  files: string[];
  argv: string[];
  resultPath: string;
  evidence: {
    schemaVersion: "np.site-build-preview-config-derivation.v1";
    scope: "forum-build-preview-analytics-only";
    configPath: ConfigPath;
    originalMode: number;
    original: NpSiteBuildPreviewConfigArtifactV1;
    wrapper: NpSiteBuildPreviewConfigArtifactV1;
    renderer: NpSiteBuildPreviewConfigArtifactV1;
    driver: NpSiteBuildPreviewConfigArtifactV1;
    restoration: "required-before-source-observation";
    requiresPostBuilderSourceObservation: true;
    deterministicNext?: {
      contextSha256: string;
      directory: string;
      argv: string[];
      files: string[];
    };
  };
}

/** Parse bounded source only; project tsconfig/compiler/plugins are never loaded. */
export function createSiteBuildPreviewConfigWrapperV1(input: {
  source: string;
  configPath: ConfigPath;
  directory: string;
}): string {
  if (
    !["nexpress.config.ts", "src/nexpress.config.ts"].includes(input.configPath) ||
    !directoryPattern.test(input.directory) ||
    typeof input.source !== "string" ||
    Buffer.byteLength(input.source) > sourceLimit ||
    input.source.includes("\0") ||
    Buffer.from(input.source).toString("utf8") !== input.source
  )
    throw new SiteBuildError("input");
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      compilerOptions: { noEmit: true },
    });
    const source = project.createSourceFile(input.configPath, input.source);
    if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length)
      throw new SiteBuildError("input");
    const exports = source.getExportAssignments();
    const defaults = source.compilerNode.statements.filter(
      (statement) =>
        ts.isExportAssignment(statement) ||
        (ts.canHaveModifiers(statement) &&
          ts
            .getModifiers(statement)
            ?.some((modifier) => modifier.kind === SyntaxKind.DefaultKeyword)),
    );
    if (
      exports.length !== 1 ||
      defaults.length !== 1 ||
      exports[0].isExportEquals() ||
      source.getExportDeclarations().length
    )
      throw new SiteBuildError("input");
    let count = 0;
    const stack: Array<{ node: ts.Node; depth: number }> = [
      { node: source.compilerNode, depth: 0 },
    ];
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++count > 50_000 || depth > 128) throw new SiteBuildError("input");
      if (ts.isIdentifier(node) && node.text.startsWith("__npBuildPreview"))
        throw new SiteBuildError("input");
      ts.forEachChild(node, (child) => {
        stack.push({ node: child, depth: depth + 1 });
      });
    }
    const assignment = exports[0];
    const body =
      input.source.slice(0, assignment.getStart()) +
      `const __npBuildPreviewOriginalConfig = (${assignment.getExpression().getText()});` +
      input.source.slice(assignment.getEnd());
    let renderer = posix.relative(
      posix.dirname(input.configPath),
      `${input.directory}/renderer.json`,
    );
    if (!renderer.startsWith("./") && !renderer.startsWith("../")) renderer = `./${renderer}`;
    return `${body}\nimport { npDeriveConfiguredBuildPreviewConfigV1 as __npBuildPreviewDerive } from "@nexpress/app/lib/site-build-preview-config";\nimport { npGetDefaultBuildOwnerBindingsV1 as __npBuildPreviewBindings } from "@nexpress/app/config-defaults";\nimport __npBuildPreviewRenderer from ${JSON.stringify(renderer)};\nconst __npBuildPreviewDerived = await __npBuildPreviewDerive(__npBuildPreviewOriginalConfig, __npBuildPreviewRenderer, __npBuildPreviewBindings());\nexport default __npBuildPreviewDerived.config;\n`;
  } catch {
    throw new SiteBuildError("input");
  }
}

const sameFile = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
type DirectoryLease = { path: string; handle: FileHandle; stat: BigIntStats };
async function directoryLease(path: string): Promise<DirectoryLease> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isDirectory()) throw new SiteBuildError("path");
    return { path, handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function checkDirectories(leases: DirectoryLease[]): Promise<void> {
  for (const lease of leases) {
    const current = await lstat(lease.path, { bigint: true });
    const held = await lease.handle.stat({ bigint: true });
    if (
      !current.isDirectory() ||
      current.dev !== lease.stat.dev ||
      current.ino !== lease.stat.ino ||
      current.mode !== lease.stat.mode ||
      held.dev !== current.dev ||
      held.ino !== current.ino
    )
      throw new SiteBuildError("conflict");
  }
}
async function readHeld(handle: FileHandle, limit: number): Promise<Buffer> {
  const bytes = Buffer.alloc(limit + 1);
  let length = 0;
  while (length < bytes.length) {
    const result = await handle.read(bytes, length, bytes.length - length, length);
    if (!result.bytesRead) break;
    length += result.bytesRead;
  }
  if (length > limit) throw new SiteBuildError("input");
  return bytes.subarray(0, length);
}

/**
 * Trusted host preparation ONLY for an already owned private Linux source copy.
 * A matching pathname is not provenance: the caller must hold its live prepared
 * source/dependency leases. No config is evaluated and the original is never written here.
 * Retain exact artifacts in build receipts/runtime inventory. Run the fixed driver
 * only inside the bounded builder, remove that builder, then freshly observe source.
 * Only a successful driver, its exact built/restored result and the later source
 * proof permit continuation. Interrupted/partial installation or restoration makes
 * the private copy invalid; this helper never repairs or publishes a live repository.
 * FD checks do not provide atomic live-repository CAS or exclude same-principal races.
 */
export async function prepareSiteBuildPreviewConfigBuildV1(input: {
  scope: "private-build-copy";
  project: string;
  configPath: ConfigPath;
  renderer: unknown;
  /** Existing uniquely owned workspace controls root; never a model-selected path. */
  parentDirectory?: string;
  /** Live trusted preparation handle; a JSON descriptor cannot choose a child. */
  deterministicNext?: NpSiteBuildDeterministicNextBuildV1;
}): Promise<NpSiteBuildPreviewConfigBuildV1> {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) throw new SiteBuildError("unavailable");
  let project: string;
  try {
    project = await realpath(input.project);
  } catch {
    throw new SiteBuildError("path");
  }
  if (
    input.scope !== "private-build-copy" ||
    project !== resolve(input.project) ||
    project === process.cwd() ||
    basename(project) !== "project" ||
    !/^(?:np-linux-project|np-private-edit-plan)-[A-Za-z0-9]+$/u.test(basename(dirname(project))) ||
    project.length > 2048 ||
    project.includes(",") ||
    (input.parentDirectory !== undefined && !parentDirectoryPattern.test(input.parentDirectory)) ||
    !["nexpress.config.ts", "src/nexpress.config.ts"].includes(input.configPath)
  )
    throw new SiteBuildError("path");
  if (input.deterministicNext) {
    await requirePreparedSiteBuildDeterministicNextV1(project, input.deterministicNext);
    if (input.parentDirectory !== input.deterministicNext.parentDirectory)
      throw new SiteBuildError("path");
  }
  const leases: DirectoryLease[] = [];
  let original: FileHandle | undefined;
  try {
    const parents: string[] = [];
    for (let path = project; ; path = dirname(path)) {
      parents.unshift(path);
      if (path === dirname(path)) break;
    }
    for (const parent of parents) leases.push(await directoryLease(parent));
    if (input.configPath.startsWith("src/"))
      leases.push(await directoryLease(join(project, "src")));
    const originalPath = join(project, input.configPath);
    original = await open(
      originalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await original.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(sourceLimit))
      throw new SiteBuildError("input");
    const bytes = await readHeld(original, sourceLimit);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const renderer = Buffer.from(
      `${JSON.stringify(npRequireAgentBuildDirectionRendererV1(input.renderer))}\n`,
    );
    const directory = `${input.parentDirectory ?? ".nexpress/site/tmp"}/preview-config-build-${input.deterministicNext?.previewStamp ?? randomUUID()}`;
    const wrapper = Buffer.from(
      createSiteBuildPreviewConfigWrapperV1({ source, configPath: input.configPath, directory }),
    );
    for (const segment of [
      ".nexpress",
      ".nexpress/site",
      ".nexpress/site/tmp",
      ...(input.parentDirectory ? [input.parentDirectory] : []),
      directory,
    ]) {
      const path = join(project, segment);
      if (segment === input.parentDirectory) {
        leases.push(await directoryLease(path));
        continue;
      }
      try {
        await mkdir(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || segment === directory)
          throw error;
      }
      leases.push(await directoryLease(path));
    }
    const record = async (path: string, value: Buffer, sourceFile = false) => ({
      path,
      bytes: value.length,
      sha256: sha256(value),
      fileDigest: await npBuildFileDigest(
        sourceFile ? "np.build-source-file.v1" : "np.build-verification-artifact.v1",
        value,
      ),
    });
    const evidence = {
      schemaVersion: "np.site-build-preview-config-derivation.v1" as const,
      scope: "forum-build-preview-analytics-only" as const,
      configPath: input.configPath,
      originalMode: Number(before.mode & 0o777n),
      original: await record(`${directory}/original.ts`, bytes, true),
      wrapper: await record(`${directory}/wrapper.ts`, wrapper),
      renderer: await record(`${directory}/renderer.json`, renderer),
      restoration: "required-before-source-observation" as const,
      requiresPostBuilderSourceObservation: true as const,
      ...(input.deterministicNext
        ? {
            deterministicNext: {
              contextSha256: input.deterministicNext.evidence.contextSha256,
              directory: input.deterministicNext.directory,
              argv: [...input.deterministicNext.argv],
              files: [...input.deterministicNext.files],
            },
          }
        : {}),
    };
    const driver = Buffer.from(
      `const plan=${JSON.stringify(evidence)};\n${NP_SITE_BUILD_PREVIEW_CONFIG_DRIVER_SOURCE_V1}`,
    );
    const driverEvidence = await record(`${directory}/driver.mjs`, driver);
    for (const [path, value] of [
      [evidence.original.path, bytes],
      [evidence.wrapper.path, wrapper],
      [evidence.renderer.path, renderer],
      [driverEvidence.path, driver],
    ] as const) {
      await checkDirectories(leases);
      const file = await open(
        join(project, path),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o400,
      );
      try {
        await file.writeFile(value);
        await file.sync();
        const held = await file.stat({ bigint: true });
        if (
          !held.isFile() ||
          held.nlink !== 1n ||
          held.size !== BigInt(value.length) ||
          !sameFile(held, await lstat(join(project, path), { bigint: true }))
        )
          throw new SiteBuildError("conflict");
      } finally {
        await file.close();
      }
    }
    await checkDirectories(leases);
    if (
      !sameFile(before, await original.stat({ bigint: true })) ||
      !sameFile(before, await lstat(originalPath, { bigint: true })) ||
      !bytes.equals(await readHeld(original, sourceLimit))
    )
      throw new SiteBuildError("conflict");
    return {
      scope: "private-build-preview-config",
      directory,
      files: [
        evidence.original.path,
        evidence.wrapper.path,
        evidence.renderer.path,
        driverEvidence.path,
        ...(input.deterministicNext?.files ?? []),
      ],
      argv: ["/usr/local/bin/node", `/np/project/${driverEvidence.path}`],
      resultPath: `${directory}/result.json`,
      evidence: { ...evidence, driver: driverEvidence },
    };
  } catch (error) {
    // Only private preparation artifacts may remain. Never delete or rewrite source on error.
    throw error instanceof SiteBuildError ? error : new SiteBuildError("input");
  } finally {
    await original?.close();
    await Promise.all(leases.map((lease) => lease.handle.close()));
  }
}

// Builtin-only fixed driver. The builder host supplies no executable, argv, env,
// callback, import target or source switch through the model/DTO/request channel.
const NP_SITE_BUILD_PREVIEW_CONFIG_DRIVER_SOURCE_V1 = String.raw`
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const project = "/np/project";
const executable = "/usr/local/bin/node";
const directory=dirname(plan.wrapper.path);
const leases=[],assets=[];
let config,identity,installed=false,restored=false,built=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const equal=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const parentEqual=(a,b)=>a.isDirectory()&&b.isDirectory()&&a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode;
async function parents(path){
 const paths=[];for(let p=path;;p=dirname(p)){paths.unshift(p);if(p===dirname(p))break;}
 for(const p of paths){if(leases.some(v=>v.path===p))continue;
  const fd=await open(p,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const stat=await fd.stat({bigint:true});if(!stat.isDirectory())throw Error();leases.push({path:p,fd,stat});}
}
async function checkParents(){for(const v of leases){if(!parentEqual(v.stat,await lstat(v.path,{bigint:true}))||!parentEqual(v.stat,await v.fd.stat({bigint:true})))throw Error();}}
async function read(fd,max){const b=Buffer.alloc(max+1);let n=0;while(n<b.length){const v=await fd.read(b,n,b.length-n,n);if(!v.bytesRead)break;n+=v.bytesRead;}if(n>max)throw Error();return b.subarray(0,n);}
async function asset(record){
 const path=join(project,record.path);await parents(dirname(path));
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const stat=await fd.stat({bigint:true});assets.push({path,fd,stat});
 if(!stat.isFile()||stat.nlink!==1n||stat.size<0n||stat.size>4194304n)throw Error();
 const bytes=await read(fd,4194304);if(bytes.length!==record.bytes||hash(bytes)!==record.sha256||!equal(stat,await fd.stat({bigint:true}))||!equal(stat,await lstat(path,{bigint:true})))throw Error();return bytes;
}
async function checkAssets(){for(const a of assets){if(!equal(a.stat,await a.fd.stat({bigint:true}))||!equal(a.stat,await lstat(a.path,{bigint:true})))throw Error();}}
async function checkConfig(expected){
 await checkParents();const held=await config.stat({bigint:true}),live=await lstat(join(project,plan.configPath),{bigint:true});
 if(!held.isFile()||held.nlink!==1n||held.dev!==identity.dev||held.ino!==identity.ino||held.mode!==identity.mode||!equal(held,live))throw Error();
 const bytes=await read(config,2097152);if(!bytes.equals(expected)||!equal(held,await config.stat({bigint:true})))throw Error();
}
async function replace(bytes){await config.truncate(0);let offset=0;while(offset<bytes.length){const result=await config.write(bytes,offset,bytes.length-offset,offset);if(!result.bytesWritten)throw Error();offset+=result.bytesWritten;}await config.sync();}
async function build(){
 const dependencies=await realpath(join(project,'node_modules'));
 const next=await realpath(join(project,'node_modules/next/dist/bin/next'));
 if(dependencies!==join(project,'node_modules')||!next.startsWith(dependencies+'/')||!(await lstat(next)).isFile())throw Error();
 for(const name of ['home','tmp'])await mkdir(join(project,directory,name),{mode:0o700});
 return await new Promise(resolve=>{
  const argv=plan.deterministicNext?plan.deterministicNext.argv:['/usr/local/bin/node','--max-old-space-size=3072',next,'build'];
  if(argv[0]!=='/usr/local/bin/node'||plan.deterministicNext&&(argv.length!==2||argv[1]!==join(project,plan.deterministicNext.directory,'driver.mjs')))throw Error();
  const child=spawn(executable,argv.slice(1),{
   cwd:project,detached:true,stdio:['ignore','pipe','pipe'],env:{
    PATH:'/usr/local/bin:/usr/bin:/bin',HOME:join(project,directory,'home'),TMPDIR:join(project,directory,'tmp'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TZ:'UTC',CI:'1',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',
    CIRCLE_NODE_TOTAL:'3',RAYON_NUM_THREADS:'2',UV_THREADPOOL_SIZE:'2',OMP_NUM_THREADS:'2',
    DATABASE_URL:'postgres://np_build_fixture:synthetic@127.0.0.1:61001/np_build_fixture',NP_SECRET:'np-build-synthetic-preparation-only-secret-v1',SITE_URL:'http://127.0.0.1:61000',NP_EMAIL_ADAPTER:'noop',NP_STORAGE_ADAPTER:'local',NP_JOBS_ENABLED:'0',NP_ENABLE_JOBS:'0',NP_BUILD_CAPSULE_PROJECT:project,NP_BUILD_CAPSULE_DEPENDENCIES:dependencies
   }});
  let stopped=false,bytes=0;
  const kill=()=>{if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')stopped=true;}}};
  const stop=()=>{stopped=true;kill();};
  const handlers=['SIGTERM','SIGINT'].map(signal=>{process.on(signal,stop);return signal;});
  const timer=setTimeout(stop,840000);
  const forward=target=>value=>{bytes+=value.length;if(bytes>8388608)stop();else target.write(value);};
  child.stdout.on('data',forward(process.stdout));child.stderr.on('data',forward(process.stderr));
  child.once('error',stop);
  child.once('close',(code,signal)=>{clearTimeout(timer);kill();for(const s of handlers)process.off(s,stop);resolve(!stopped&&signal===null&&code===0);});
 });
}
let original,wrapper,driver;
try{
 if(process.argv.length!==2||!constants.O_NOFOLLOW||!constants.O_DIRECTORY)throw Error();
 await parents(dirname(join(project,plan.configPath)));
 original=await asset(plan.original);wrapper=await asset(plan.wrapper);await asset(plan.renderer);
 const own=fileURLToPath(import.meta.url);if(own!==join(project,directory,'driver.mjs'))throw Error();
 const ownFd=await open(own,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const ownStat=await ownFd.stat({bigint:true});assets.push({path:own,fd:ownFd,stat:ownStat});
 driver=await read(ownFd,131072);if(!ownStat.isFile()||ownStat.nlink!==1n||!equal(ownStat,await lstat(own,{bigint:true})))throw Error();
 config=await open(join(project,plan.configPath),constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 identity=await config.stat({bigint:true});if(Number(identity.mode&511n)!==plan.originalMode)throw Error();
 await checkAssets();await checkConfig(original);
 installed=true;await replace(wrapper);await checkConfig(wrapper);built=await build();
}catch{built=false;}
finally{
 if(installed){try{await checkAssets();await checkConfig(wrapper);await replace(original);await checkConfig(original);await checkAssets();restored=true;}catch{restored=false;}}
}
try{
 if(!restored)throw Error();await checkParents();await checkAssets();await checkConfig(original);
 const result={schemaVersion:'np.site-build-preview-config-build-result.v1',scope:'forum-build-preview-analytics-only',status:built?'built':'failed',originalRestored:true,requiresPostBuilderSourceObservation:true,original:plan.original,wrapper:plan.wrapper,renderer:plan.renderer,driver:{path:directory+'/driver.mjs',bytes:driver.length,sha256:hash(driver)}};
 const file=await open(join(project,directory,'result.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,256);
 try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}finally{await file.close();}
 await checkParents();await checkAssets();await checkConfig(original);
 if(!built)throw Error();
}catch{process.exitCode=1;process.stderr.write('Build preview private copy is invalid or build failed.\n');}
finally{await config?.close();await Promise.all(assets.map(v=>v.fd.close()));await Promise.all(leases.map(v=>v.fd.close()));}
`;
