import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  lchmod,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  npBuildSourceExcludedRootsV1,
  npBuildSourceExcludedDirectoryNamesV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  runSiteBuildDockerV1,
  siteBuildReadOnlyImageDataArgsV1,
  withSiteBuildDockerV1,
  type NpSiteBuildDockerHostV1,
} from "./docker-host.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export type NpSiteBuildLinuxWorkspaceSourceV1 = Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
type SourceTree = NpSiteBuildLinuxWorkspaceSourceV1;
export interface NpSiteBuildLinuxWorkspaceFileV1 {
  path: string;
  kind: "file" | "symlink";
  mode: number;
  bytes: number;
  sha256: string;
  target: string | null;
}
type ArtifactFile = NpSiteBuildLinuxWorkspaceFileV1;
export const siteBuildLinuxWorkspaceBoundsV1 = {
  profile: "np.site-build-linux-build-tmpfs.v1",
  volumeBytes: 4294967296,
  volumeInodes: 131072,
  sourceBytes: 536870912,
  sourceFileBytes: 67108864,
  nextBytes: 2147483648,
  nextFiles: 100000,
  nextFileBytes: 268435456,
  exportChunkBytes: 4194304,
  observation: "after-builder-removal",
} as const;

// Trusted, builtin-only observer. It never imports project code and always runs in
// a new PID namespace after the builder container has been forcibly removed.
const observer = String.raw`import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,dirname,resolve,isAbsolute} from 'node:path';
const root='/np/project', control='/np/control', op=process.argv[2];
const req=JSON.parse(await fs.readFile(join(control,'request.json'),'utf8'));
const fail=()=>{throw new Error('bounded-build-observation')};
const quota=await fs.statfs(root,{bigint:true});
if(quota.type!==16914836n||quota.blocks*quota.bsize>4294967296n||quota.files>131072n||quota.files<=0n)fail();
const safe=p=>typeof p==='string'&&p.length<=2048&&!p.includes('\\')&&!p.includes('\0')&&!isAbsolute(p)&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
const inside=p=>p===root||p.startsWith(root+'/');
const same=(a,b)=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const cache=new Set(['.next/cache','.next/standalone/.next/cache']);
const excludedRoots=${JSON.stringify(npBuildSourceExcludedRootsV1)},excludedNames=new Set(${JSON.stringify(npBuildSourceExcludedDirectoryNamesV1)});
const excluded=(p,directory)=>excludedRoots.some(x=>p===x||p.startsWith(x+'/'))||p.split('/').slice(0,directory?undefined:-1).some(x=>excludedNames.has(x));
async function regular(path,max,consume){
 const h=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const s=await h.stat({bigint:true});if(!s.isFile()||s.nlink!==1n||s.size<0n||s.size>BigInt(max))fail();
 const b=Buffer.alloc(65536);let n=0;const hash=createHash('sha256');
 while(n<Number(s.size)){const r=await h.read(b,0,Math.min(b.length,Number(s.size)-n),n);if(!r.bytesRead)fail();const v=b.subarray(0,r.bytesRead);hash.update(v);await consume?.(v);n+=r.bytesRead;}
 if((await h.read(b,0,1,n)).bytesRead||!same(s,await h.stat({bigint:true}))||!same(s,await fs.lstat(path,{bigint:true})))fail();
 return {bytes:n,sha256:hash.digest('hex'),mode:Number(s.mode&511n)};
 }finally{await h.close();}}
async function scan(prefix,maxBytes,maxFile,maxFiles,links){
 let total=0,entries=0;const rows=[];
 async function visit(p,depth){if(++entries>200000||depth>64||!safe(p))fail();
 const path=join(root,p),s=await fs.lstat(path,{bigint:true});
 if(!prefix&&excluded(p,s.isDirectory()))return;
 if(s.isDirectory()){for(const name of (await fs.readdir(path)).sort())await visit(p+'/'+name,depth+1);return;}
 if(rows.length>=maxFiles)fail();
 if(s.isSymbolicLink()){if(!links)fail();const target=await fs.readlink(path);if(Buffer.byteLength(target)>2048)fail();
 if(!(cache.has(p)&&target==='/np/output/next-cache')){if(isAbsolute(target)||!inside(resolve(dirname(path),target))||!inside(await fs.realpath(path)))fail();}
 rows.push({path:p,kind:'symlink',mode:Number(s.mode&511n),bytes:Buffer.byteLength(target),sha256:createHash('sha256').update(target).digest('hex'),target});return;}
 const row=await regular(path,maxFile);total+=row.bytes;if(total>maxBytes)fail();rows.push({path:p,kind:'file',...row,target:null});}
 if(prefix)await visit(prefix,0);else for(const name of (await fs.readdir(root)).sort())await visit(name,0);
 return rows.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}
if(op==='init'){
 await fs.mkdir(root,{recursive:true});let total=0;
 if(!Array.isArray(req.files)||req.files.length>10000)fail();
 for(const f of req.files){if(!safe(f.path))fail();const path=join(root,f.path);await fs.mkdir(dirname(path),{recursive:true});const out=await fs.open(path,'wx',f.mode==='100755'?493:420);
 try{await regular(join('/np/input',f.path),67108864,async b=>{total+=b.length;if(total>536870912)fail();let n=0;while(n<b.length){const w=await out.write(b,n,b.length-n);if(!w.bytesWritten)fail();n+=w.bytesWritten;}});}finally{await out.close();}}
 for(const name of ['home','tmp'])await fs.mkdir(join(root,req.tmpPath,name),{recursive:true});
 if(!Array.isArray(req.controls)||req.controls.length>32)fail();
 for(const path of req.controls){if(!safe(path)||!path.startsWith(req.tmpPath+'/'))fail();await fs.mkdir(dirname(join(root,path)),{recursive:true});await fs.writeFile(join(root,path),'',{flag:'wx',mode:256});}
}else if(op==='manifest'){
 const source=await scan('',536870912,67108864,10000,false);
 const artifacts=req.artifacts?await scan('.next',2147483648,268435456,100000,true):[];
 const bytes=Buffer.from(JSON.stringify({source,artifacts}));if(bytes.length>16777216)fail();process.stdout.write(bytes);
}else if(op==='export'){
 if(!Array.isArray(req.parts)||req.parts.length>10000)fail();let total=0;
 for(const p of req.parts){if(!safe(p.path)||!Number.isSafeInteger(p.offset)||p.offset<0||!Number.isSafeInteger(p.bytes)||p.bytes<0||(total+=p.bytes)>4194304)fail();
 const path=join(root,p.path);if(!inside(await fs.realpath(dirname(path))))fail();const h=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await h.stat();if(!s.isFile()||s.nlink!==1||p.offset+p.bytes>s.size)fail();const b=Buffer.alloc(p.bytes);let n=0;while(n<b.length){const r=await h.read(b,n,b.length-n,p.offset+n);if(!r.bytesRead)fail();n+=r.bytesRead;}process.stdout.write(b);}finally{await h.close();}}
}else if(op==='finalize'){
 await scan('.next',2147483648,268435456,100000,true);
 const server=await fs.lstat(join(root,'.next/standalone/server.js'));if(!server.isFile()||server.isSymbolicLink())fail();
 await fs.cp(join(root,'public'),join(root,'.next/standalone/public'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
 await fs.cp(join(root,'.next/static'),join(root,'.next/standalone/.next/static'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
 for(const p of cache){const path=join(root,p);try{const s=await fs.lstat(path);if(s.isSymbolicLink()||!s.isDirectory())fail();await fs.rm(path,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}await fs.symlink('/np/output/next-cache',path);}
 await scan('.next',2147483648,268435456,100000,true);
}else fail();`;

export function siteBuildLinuxWorkspaceChangesV1(
  before: SourceTree,
  after: SourceTree,
  permitted: (path: string) => boolean,
): string[] {
  const previous = new Map(before.manifest.files.map((file) => [file.path, file]));
  const current = new Map(after.manifest.files.map((file) => [file.path, file]));
  const changed: string[] = [];
  for (const path of new Set([...previous.keys(), ...current.keys()])) {
    const left = previous.get(path),
      right = current.get(path);
    if (left?.digest === right?.digest && left?.mode === right?.mode) continue;
    if (!permitted(path) || !right || right.mode !== "100644") throw new SiteBuildError("conflict");
    changed.push(path);
  }
  return changed.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

export async function rejectSiteBuildLinuxWorkspaceCredentialsV1(project: string): Promise<void> {
  let entries = 0;
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (++entries > 25_000) throw new SiteBuildError("input");
      if (
        /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.git|\.codex|\.claude|\.agents|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
          entry.name,
        )
      )
        throw new SiteBuildError("input");
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      if (entry.isSymbolicLink()) throw new SiteBuildError("path");
      if (entry.isDirectory()) await visit(join(path, entry.name));
      else if (!entry.isFile()) throw new SiteBuildError("path");
    }
  };
  await visit(project);
}

export interface NpSiteBuildLinuxWorkspaceCommandV1<Id extends string = string> {
  id: Id;
  argv: string[];
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdout: { path: string; sha256: string; bytes: number };
  stderr: { path: string; sha256: string; bytes: number };
}
export interface NpSiteBuildLinuxWorkspaceV1 {
  readonly source: SourceTree;
  readonly changedSources: readonly string[];
  run<Id extends string>(input: {
    id: Id;
    argv: readonly string[];
    permitted: (path: string) => boolean;
    /** Trusted exact-output check, run after source diff checks and before any host recovery. */
    validateSource?: (source: SourceTree, exitCode: number) => void | Promise<void>;
    timeoutMs: number;
  }): Promise<NpSiteBuildLinuxWorkspaceCommandV1<Id>>;
  finalizeNextAndExport(): Promise<readonly NpSiteBuildLinuxWorkspaceFileV1[]>;
}
export interface NpSiteBuildLinuxWorkspaceInputV1 {
  /** Caller-owned private raw source. Installation manifest rewrites are not source. */
  project: string;
  source: SourceTree;
  /** Separately prepared Linux node_modules closure, always mounted read-only. */
  dependencies: string;
  baseImageId: string;
  controls: { directory: string; files: readonly string[] };
  auditPath: string;
}
interface BuildExecution {
  project: string;
  dependencies: string;
  baseImageId: string;
  tmpPath: string;
  observerDirectory: string;
  controls: readonly string[];
  auditPath: string;
  previous: SourceTree;
  changedSources: Set<string>;
  volume?: string;
}

const cacheTarget = "/np/output/next-cache" as const;
const cachePaths = new Set([".next/cache", ".next/standalone/.next/cache"]);

async function successfulDocker(
  host: NpSiteBuildDockerHostV1,
  args: string[],
  timeoutMs = 30_000,
  bytes = 64 * 1024,
): Promise<Buffer> {
  const result = await runSiteBuildDockerV1(host, args, { timeoutMs, bytes });
  if (result.code !== 0) throw new SiteBuildError("unavailable");
  return result.stdout;
}

/** A completed Docker removal ends the builder's PID namespace before observation. */
async function isolatedContainer(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  role: "builder" | "observer",
  argv: string[],
  limits: { timeoutMs: number; bytes: number },
  writable: boolean,
): Promise<Awaited<ReturnType<typeof runSiteBuildDockerV1>>> {
  if (!context.volume) throw new SiteBuildError("unavailable");
  const name = `np-linux-build-${role}-${randomUUID()}`;
  const { project, dependencies, baseImageId, tmpPath, volume } = context;
  const mounts = [
    "--mount",
    `type=volume,source=${volume},target=/np/project,volume-nocopy${writable ? "" : ",readonly"}`,
    "--mount",
    `type=bind,source=${project},target=/np/input,readonly`,
    "--mount",
    `type=bind,source=${dependencies},target=/np/project/node_modules,readonly`,
  ];
  if (role === "builder") {
    for (const file of context.controls)
      mounts.push(
        "--mount",
        `type=bind,source=${join(project, file)},target=/np/project/${file},readonly`,
      );
  } else {
    mounts.push(
      "--mount",
      `type=bind,source=${join(project, context.observerDirectory)},target=/np/control,readonly`,
    );
  }
  let created = false;
  try {
    created = true;
    await successfulDocker(host, [
      "create",
      "--pull=never",
      "--name",
      name,
      "--network=none",
      "--read-only",
      "--ipc=private",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=512",
      "--cpus=2",
      "--cpuset-cpus=0,1",
      "--memory=4g",
      "--memory-swap=4g",
      ...siteBuildReadOnlyImageDataArgsV1(host),
      ...mounts,
      "--workdir",
      "/np/project",
      "--entrypoint",
      "/usr/bin/env",
      baseImageId,
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      `HOME=/np/project/${tmpPath}/home`,
      `TMPDIR=/np/project/${tmpPath}/tmp`,
      "LANG=C.UTF-8",
      "LC_ALL=C.UTF-8",
      "TZ=UTC",
      ...(role === "builder"
        ? [
            "CI=1",
            "NODE_ENV=production",
            "NEXT_TELEMETRY_DISABLED=1",
            "CIRCLE_NODE_TOTAL=3",
            "RAYON_NUM_THREADS=2",
            "UV_THREADPOOL_SIZE=2",
            "OMP_NUM_THREADS=2",
            "DATABASE_URL=postgres://np_build_fixture:synthetic@127.0.0.1:61001/np_build_fixture",
            "NP_SECRET=np-build-synthetic-preparation-only-secret-v1",
            "SITE_URL=http://127.0.0.1:61000",
            "NP_EMAIL_ADAPTER=noop",
            "NP_STORAGE_ADAPTER=local",
            "NP_JOBS_ENABLED=0",
            "NP_ENABLE_JOBS=0",
            "NP_BUILD_CAPSULE_PROJECT=/np/project",
            "NP_BUILD_CAPSULE_DEPENDENCIES=/np/project/node_modules",
          ]
        : []),
      ...argv,
    ]);
    return await runSiteBuildDockerV1(host, ["start", "--attach", name], limits);
  } finally {
    if (created) await successfulDocker(host, ["rm", "--force", "--volumes", name], 15_000);
  }
}

async function observeBuildVolume(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  operation: "init" | "manifest" | "export" | "finalize",
  request: unknown,
): Promise<Buffer> {
  await writeFile(
    join(context.project, context.observerDirectory, "request.json"),
    JSON.stringify(request),
    { mode: 0o600 },
  );
  const result = await isolatedContainer(
    context,
    host,
    "observer",
    ["/usr/local/bin/node", "/np/control/observer.mjs", operation],
    { timeoutMs: 120_000, bytes: operation === "manifest" ? 16 * 1024 * 1024 : 4 * 1024 * 1024 },
    operation === "init" || operation === "finalize",
  );
  if (result.code !== 0 || result.stderr.length) {
    const failure = `${context.auditPath}/observer-${operation}-${randomUUID()}`;
    await writeFile(join(context.project, `${failure}.stderr.log`), result.stderr, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      join(context.project, `${failure}.json`),
      JSON.stringify({
        operation,
        exitCode: result.code,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
        stderrSha256: digest(result.stderr),
      }),
      { flag: "wx", mode: 0o600 },
    );
    throw new SiteBuildError("input");
  }
  return result.stdout;
}

function requireFiles(value: unknown, artifact: boolean): ArtifactFile[] {
  if (!Array.isArray(value) || value.length > (artifact ? 100_000 : 10_000))
    throw new SiteBuildError("input");
  let total = 0;
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      throw new SiteBuildError("input");
    const row = item as ArtifactFile;
    if (
      Object.keys(row).sort().join(",") !== "bytes,kind,mode,path,sha256,target" ||
      typeof row.path !== "string" ||
      row.path.length > 2048 ||
      row.path.includes("\\") ||
      row.path.includes("\0") ||
      row.path.split("/").some((part) => !part || part === "." || part === "..") ||
      (artifact && !row.path.startsWith(".next/")) ||
      seen.has(row.path) ||
      !Number.isSafeInteger(row.mode) ||
      row.mode < 0 ||
      row.mode > 0o777 ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0 ||
      row.bytes > (artifact ? 256 : 64) * 1024 * 1024 ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(row.sha256) ||
      !["file", "symlink"].includes(row.kind) ||
      (row.kind === "file" ? row.target !== null : !artifact || typeof row.target !== "string")
    )
      throw new SiteBuildError("input");
    if (row.kind === "symlink") {
      if (
        row.target === null ||
        Buffer.byteLength(row.target) > 2048 ||
        row.bytes !== Buffer.byteLength(row.target) ||
        row.sha256 !== digest(row.target) ||
        (row.target.startsWith("/")
          ? !cachePaths.has(row.path) || row.target !== cacheTarget
          : !resolve("/np/project", dirname(row.path), row.target).startsWith("/np/project/"))
      )
        throw new SiteBuildError("path");
    } else total += row.bytes;
    if (total > (artifact ? 2 * 1024 : 512) * 1024 * 1024) throw new SiteBuildError("input");
    seen.add(row.path);
    return {
      path: row.path,
      kind: row.kind,
      mode: row.mode,
      bytes: row.bytes,
      sha256: row.sha256,
      target: row.target,
    };
  });
}

async function exportFiles(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  files: ArtifactFile[],
  destination: string,
): Promise<void> {
  // At most one file descriptor is open while consuming fixed 4MiB binary batches.
  let current: { row: ArtifactFile; file: Awaited<ReturnType<typeof open>> } | undefined;
  const regulars = files.filter((row) => row.kind === "file");
  const byPath = new Map(regulars.map((row) => [row.path, row]));
  const hashes = new Map(regulars.map((row) => [row.path, createHash("sha256")]));
  try {
    let index = 0,
      offset = 0;
    while (index < regulars.length) {
      const parts: Array<{ path: string; offset: number; bytes: number }> = [];
      let bytes = 0;
      while (index < regulars.length && bytes < 4 * 1024 * 1024) {
        const row = regulars[index];
        const count = Math.min(row.bytes - offset, 4 * 1024 * 1024 - bytes);
        parts.push({ path: row.path, offset, bytes: count });
        bytes += count;
        offset += count;
        if (offset === row.bytes) {
          index++;
          offset = 0;
        }
        if (parts.length === 10_000) break;
      }
      const output = await observeBuildVolume(context, host, "export", { parts });
      if (output.length !== bytes) throw new SiteBuildError("conflict");
      let position = 0;
      for (const part of parts) {
        if (current?.row.path !== part.path) {
          if (current) await current.file.close();
          const row = byPath.get(part.path);
          if (!row) throw new SiteBuildError("input");
          const path = join(destination, part.path);
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          current = { row, file: await open(path, "wx", row.mode) };
        }
        const chunk = output.subarray(position, position + part.bytes);
        position += part.bytes;
        hashes.get(part.path)?.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const result = await current.file.write(
            chunk,
            written,
            chunk.length - written,
            part.offset + written,
          );
          if (!result.bytesWritten) throw new SiteBuildError("unavailable");
          written += result.bytesWritten;
        }
      }
    }
    if (current) {
      await current.file.close();
      current = undefined;
    }
    for (const row of regulars) {
      if (hashes.get(row.path)?.digest("hex") !== row.sha256) throw new SiteBuildError("conflict");
      await chmod(join(destination, row.path), row.mode);
    }
    for (const row of files.filter((file) => file.kind === "symlink")) {
      if (row.target === null) throw new SiteBuildError("input");
      await mkdir(dirname(join(destination, row.path)), { recursive: true, mode: 0o700 });
      const path = join(destination, row.path);
      await symlink(row.target, path);
      // Darwin applies umask to link permissions; Linux reports 0777. Preserve
      // the observed link's mode without following it into readonly dependencies
      // or the deliberately absent output cache target.
      if (((await lstat(path)).mode & 0o777) !== row.mode) {
        if (typeof lchmod !== "function") throw new SiteBuildError("unavailable");
        await lchmod(path, row.mode);
      }
      const copied = await lstat(path);
      if (!copied.isSymbolicLink() || (copied.mode & 0o777) !== row.mode)
        throw new SiteBuildError("conflict");
    }
  } finally {
    await current?.file.close();
  }
}

async function recoverSource(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  permitted: (path: string) => boolean,
  validate?: (source: SourceTree) => void | Promise<void>,
): Promise<void> {
  const raw: unknown = JSON.parse(
    (await observeBuildVolume(context, host, "manifest", {})).toString("utf8"),
  );
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new SiteBuildError("input");
  const rows = requireFiles((raw as { source: unknown }).source, false);
  const staging = join(context.project, context.tmpPath, `source-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    await exportFiles(context, host, rows, staging);
    const current = await readSiteSourceTreeV1(staging);
    // The observer cannot smuggle files through the Core source exclusions.
    if (current.manifest.files.length !== rows.length) throw new SiteBuildError("conflict");
    const changed = siteBuildLinuxWorkspaceChangesV1(context.previous, current, permitted);
    await validate?.(structuredClone(current));
    const hostBefore = await readSiteSourceTreeV1(context.project);
    if (hostBefore.digest !== context.previous.digest) throw new SiteBuildError("conflict");
    for (const path of changed) {
      const destination = join(context.project, path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await cp(join(staging, path), destination, { force: true });
      context.changedSources.add(path);
    }
    const observed = await readSiteSourceTreeV1(context.project);
    if (observed.digest !== current.digest) throw new SiteBuildError("conflict");
    context.previous = observed;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function withBuildVolume<T>(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  run: () => Promise<T>,
): Promise<T> {
  const volume = `np-linux-build-${randomUUID()}`;
  const holder = `${volume}-holder`;
  let volumeCreated = false,
    holderCreated = false;
  let outcome: { value: T } | undefined;
  let failure: Error | undefined;
  try {
    volumeCreated = true;
    await successfulDocker(host, [
      "volume",
      "create",
      "--driver",
      "local",
      "--opt",
      "type=tmpfs",
      "--opt",
      "device=tmpfs",
      "--opt",
      "o=size=4294967296,nr_inodes=131072,mode=0700",
      volume,
    ]);
    context.volume = volume;
    holderCreated = true;
    await successfulDocker(host, [
      "create",
      "--name",
      holder,
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=16",
      "--memory=4g",
      ...siteBuildReadOnlyImageDataArgsV1(host),
      "--mount",
      `type=volume,source=${volume},target=/np/project,volume-nocopy`,
      "--entrypoint",
      "/usr/bin/env",
      context.baseImageId,
      "-i",
      "/usr/local/bin/node",
      "-e",
      "setInterval(()=>{},3600000)",
    ]);
    await successfulDocker(host, ["start", holder]);
    await observeBuildVolume(context, host, "init", {
      files: context.previous.manifest.files,
      tmpPath: context.tmpPath,
      controls: context.controls,
    });
    await recoverSource(context, host, () => false);
    outcome = { value: await run() };
  } catch (error) {
    failure = error instanceof Error ? error : new SiteBuildError("unavailable");
  }
  let failed = false;
  if (holderCreated) {
    try {
      await successfulDocker(host, ["rm", "--force", "--volumes", holder]);
    } catch {
      failed = true;
    }
  }
  if (volumeCreated) {
    try {
      await successfulDocker(host, ["volume", "rm", volume]);
    } catch {
      failed = true;
    }
  }
  context.volume = undefined;
  if (failed) throw new SiteBuildError("unavailable");
  if (failure) throw failure;
  if (!outcome) throw new SiteBuildError("unavailable");
  return outcome.value;
}
async function runWorkspaceStep<Id extends string>(
  context: BuildExecution,
  host: NpSiteBuildDockerHostV1,
  id: Id,
  argv: string[],
  permitted: (path: string) => boolean,
  timeoutMs: number,
  validateSource?: (source: SourceTree, exitCode: number) => void | Promise<void>,
): Promise<NpSiteBuildLinuxWorkspaceCommandV1<Id>> {
  const { project, auditPath } = context;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const result = await isolatedContainer(
    context,
    host,
    "builder",
    argv,
    { timeoutMs, bytes: 8 * 1024 * 1024 },
    true,
  );
  const finished = Date.now();
  const stdoutPath = `${auditPath}/${id}.stdout.log`,
    stderrPath = `${auditPath}/${id}.stderr.log`;
  await Promise.all([
    writeFile(join(project, stdoutPath), result.stdout, { flag: "wx", mode: 0o600 }),
    writeFile(join(project, stderrPath), result.stderr, { flag: "wx", mode: 0o600 }),
  ]);
  const command = {
    id,
    argv,
    exitCode: result.code,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    stdout: { path: stdoutPath, sha256: digest(result.stdout), bytes: result.stdout.length },
    stderr: { path: stderrPath, sha256: digest(result.stderr), bytes: result.stderr.length },
  };
  await writeFile(join(project, auditPath, `${id}.json`), `${JSON.stringify(command)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await recoverSource(
    context,
    host,
    permitted,
    validateSource ? (source) => validateSource(source, result.code) : undefined,
  );
  await writeFile(
    join(project, auditPath, `${id}.source-after.json`),
    `${JSON.stringify(context.previous)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  if (result.code !== 0) throw new SiteBuildError("input");
  return command;
}

/**
 * Internal trusted-module primitive, not a JSON transport or an execution grant.
 * Callers supply module-fixed argv/control files and the reviewed source allowlist;
 * model data must never select argv, callbacks, environment, mounts or this API.
 * Source recovery updates only the caller-owned private project, never a repository.
 */
export async function withSiteBuildLinuxWorkspaceV1<T>(
  input: NpSiteBuildLinuxWorkspaceInputV1,
  run: (workspace: NpSiteBuildLinuxWorkspaceV1) => Promise<T>,
): Promise<T> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.baseImageId)) throw new SiteBuildError("input");
  const project = await realpath(input.project),
    dependencies = await realpath(input.dependencies);
  if (
    project !== resolve(input.project) ||
    dependencies !== resolve(input.dependencies) ||
    [project, dependencies].some((path) => path.includes(",") || path.includes("\0")) ||
    !(await lstat(project)).isDirectory() ||
    !(await lstat(dependencies)).isDirectory()
  )
    throw new SiteBuildError("path");
  const safe = (path: string) =>
    path.length <= 2048 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
  const tmpPath = input.controls.directory,
    auditPath = input.auditPath;
  if (
    !safe(tmpPath) ||
    !tmpPath.startsWith(".nexpress/site/tmp/") ||
    !safe(auditPath) ||
    !auditPath.startsWith(".nexpress/site/audit/") ||
    input.controls.files.length > 32 ||
    new Set(input.controls.files).size !== input.controls.files.length
  )
    throw new SiteBuildError("path");
  for (const path of [tmpPath, auditPath]) {
    const absolute = join(project, path);
    if ((await realpath(absolute)) !== absolute || !(await lstat(absolute)).isDirectory())
      throw new SiteBuildError("path");
  }
  const controls = [...input.controls.files];
  for (const file of controls) {
    if (
      !safe(file) ||
      !file.startsWith(`${tmpPath}/`) ||
      file === `${tmpPath}/observer.mjs` ||
      file === `${tmpPath}/request.json` ||
      file.startsWith(`${tmpPath}/home/`) ||
      file.startsWith(`${tmpPath}/tmp/`)
    )
      throw new SiteBuildError("path");
    const info = await lstat(join(project, file));
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > siteBuildLinuxWorkspaceBoundsV1.sourceFileBytes ||
      (await realpath(join(project, file))) !== join(project, file)
    )
      throw new SiteBuildError("path");
  }
  await rejectSiteBuildLinuxWorkspaceCredentialsV1(project);
  const source = await readSiteSourceTreeV1(project);
  if (
    source.digest !== input.source.digest ||
    JSON.stringify(source.manifest) !== JSON.stringify(input.source.manifest)
  )
    throw new SiteBuildError("conflict");
  let sourceBytes = 0;
  for (const file of source.manifest.files) {
    const info = await lstat(join(project, file.path));
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > siteBuildLinuxWorkspaceBoundsV1.sourceFileBytes ||
      (sourceBytes += info.size) > siteBuildLinuxWorkspaceBoundsV1.sourceBytes
    )
      throw new SiteBuildError("input");
  }
  // Commands may reuse their pinned driver directory across fresh workspaces.
  // Keep each workspace's trusted observer and request separate from caller files;
  // the private-copy owner retains cleanup authority over this excluded directory.
  const observerDirectory = `${tmpPath}/workspace-observer-${randomUUID()}`;
  await mkdir(join(project, observerDirectory), { mode: 0o700 });
  await writeFile(join(project, observerDirectory, "observer.mjs"), observer, {
    flag: "wx",
    mode: 0o400,
  });
  const context: BuildExecution = {
    project,
    dependencies,
    baseImageId: input.baseImageId,
    tmpPath,
    observerDirectory,
    controls,
    auditPath,
    previous: source,
    changedSources: new Set(),
  };
  return withSiteBuildDockerV1((host) =>
    withBuildVolume(context, host, async () => {
      let active = true;
      let pending: Promise<unknown> | undefined;
      let operationFailure: Error | undefined;
      const ids = new Set<string>();
      const exclusive = <R>(operation: () => Promise<R>): Promise<R> => {
        if (!active || pending || operationFailure)
          return Promise.reject(new SiteBuildError("unavailable"));
        const task = operation();
        pending = task;
        void task.then(
          () => {
            pending = undefined;
          },
          (error: unknown) => {
            operationFailure = error instanceof Error ? error : new SiteBuildError("unavailable");
            pending = undefined;
          },
        );
        return task;
      };
      const workspace: NpSiteBuildLinuxWorkspaceV1 = {
        get source() {
          return structuredClone(context.previous);
        },
        get changedSources() {
          return [...context.changedSources].sort();
        },
        run: (step) =>
          exclusive(async () => {
            if (
              !/^[a-z][a-z0-9-]{0,63}$/u.test(step.id) ||
              ids.has(step.id) ||
              !Number.isSafeInteger(step.timeoutMs) ||
              step.timeoutMs < 1 ||
              step.timeoutMs > 15 * 60_000 ||
              !step.argv.length ||
              step.argv.length > 256 ||
              !step.argv[0].startsWith("/") ||
              step.argv.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
              step.argv.reduce((bytes, arg) => bytes + Buffer.byteLength(arg), 0) > 64 * 1024
            )
              throw new SiteBuildError("input");
            ids.add(step.id);
            return runWorkspaceStep(
              context,
              host,
              step.id,
              [...step.argv],
              step.permitted,
              step.timeoutMs,
              step.validateSource,
            );
          }),
        finalizeNextAndExport: () =>
          exclusive(async () => {
            await observeBuildVolume(context, host, "finalize", {});
            const observed: unknown = JSON.parse(
              (await observeBuildVolume(context, host, "manifest", { artifacts: true })).toString(
                "utf8",
              ),
            );
            if (observed === null || typeof observed !== "object" || Array.isArray(observed))
              throw new SiteBuildError("input");
            const artifacts = requireFiles((observed as { artifacts: unknown }).artifacts, true);
            await writeFile(
              join(project, auditPath, "next-artifacts.json"),
              `${JSON.stringify(artifacts)}\n`,
              { flag: "wx", mode: 0o600 },
            );
            await exportFiles(context, host, artifacts, project);
            return artifacts;
          }),
      };
      let outcome: { value: T } | undefined;
      let failure: Error | undefined;
      try {
        outcome = { value: await run(workspace) };
      } catch (error) {
        failure = error instanceof Error ? error : new SiteBuildError("unavailable");
      }
      active = false;
      if (pending) {
        try {
          await pending;
        } catch (error) {
          failure ??= error instanceof Error ? error : new SiteBuildError("unavailable");
        }
        // A callback must await each owned operation before returning its result.
        failure ??= new SiteBuildError("unavailable");
      }
      if (failure || operationFailure)
        throw failure ?? operationFailure ?? new SiteBuildError("unavailable");
      if (!outcome) throw new SiteBuildError("unavailable");
      siteBuildLinuxWorkspaceChangesV1(
        context.previous,
        await readSiteSourceTreeV1(project),
        () => false,
      );
      return outcome.value;
    }),
  );
}
