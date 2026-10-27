import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { types } from "node:util";
import { SiteBuildError } from "./artifact-io.js";

interface DirectionArtifactBytes {
  path: string;
  bytes: Uint8Array;
}
export interface NpSiteBuildDirectionArtifactPublicationV1 {
  project: string;
  artifacts: DirectionArtifactBytes[];
  sealedSet: DirectionArtifactBytes;
}
export interface NpSiteBuildFinalArtifactPublicationV1 {
  project: string;
  artifacts: DirectionArtifactBytes[];
  /** Last create-only file; its bytes must be freshly verified by the caller. */
  manifest: DirectionArtifactBytes;
}
export interface NpSiteBuildGeneratorAuditPublicationV1 {
  project: string;
  artifacts: DirectionArtifactBytes[];
  /** Fixed manifest.json under the same generator run; linked last. */
  manifest: DirectionArtifactBytes;
}

/** A failed attempt is not a rollback or confirmation that the sealed set is absent. */
export class NpSiteBuildDirectionArtifactPublicationErrorV1 extends SiteBuildError {
  readonly publicationState = "partial-artifacts-may-remain";
  readonly sealedSetState = "unconfirmed";
}
export class NpSiteBuildFinalArtifactPublicationErrorV1 extends SiteBuildError {
  readonly publicationState = "partial-artifacts-may-remain";
  readonly manifestState = "unconfirmed";
}
export class NpSiteBuildGeneratorAuditPublicationErrorV1 extends SiteBuildError {
  readonly publicationState = "partial-artifacts-may-remain";
  readonly manifestState = "unconfirmed";
}

// Node has no openat API, and macOS /dev/fd does not support directory-relative
// children. This fixed helper owns every repository operation through directory FDs.
const publisherSource = String.raw`
#define _GNU_SOURCE
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <dirent.h>
#include <strings.h>
#ifndef O_NOFOLLOW
#error O_NOFOLLOW required
#endif
#ifndef AT_SYMLINK_NOFOLLOW
#error AT_SYMLINK_NOFOLLOW required
#endif
#define ND 8192
#define NF 403
typedef struct {int fd,parent;char name[129];struct stat identity;} Dir;
typedef struct {int fd,parent,payload;char name[129];struct stat identity,payloadIdentity;} File;
static Dir dirs[ND];static int nd=0;static File files[NF];static int nf=0;static int changed=0;
static int equalid(const struct stat *a,const struct stat *b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_mode==b->st_mode&&a->st_nlink==b->st_nlink;}
static int dirid(const struct stat *a,const struct stat *b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_mode==b->st_mode;}
static int same(const struct stat *a,const struct stat *b){
#ifdef __APPLE__
 return equalid(a,b)&&a->st_size==b->st_size&&a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec&&a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec&&a->st_ctimespec.tv_sec==b->st_ctimespec.tv_sec&&a->st_ctimespec.tv_nsec==b->st_ctimespec.tv_nsec;
#else
 return equalid(a,b)&&a->st_size==b->st_size&&a->st_mtim.tv_sec==b->st_mtim.tv_sec&&a->st_mtim.tv_nsec==b->st_mtim.tv_nsec&&a->st_ctim.tv_sec==b->st_ctim.tv_sec&&a->st_ctim.tv_nsec==b->st_ctim.tv_nsec;
#endif
}
static int checkdirs(void){for(int i=0;i<nd;i++){struct stat s;if(fstat(dirs[i].fd,&s)||!dirid(&s,&dirs[i].identity)){errno=EINVAL;return -1;}if(dirs[i].parent>=0&&(fstatat(dirs[dirs[i].parent].fd,dirs[i].name,&s,AT_SYMLINK_NOFOLLOW)||!dirid(&s,&dirs[i].identity))){errno=EINVAL;return -1;}}return 0;}
static int exactname(int parent,const char *name){int fd=openat(dirs[parent].fd,".",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)return -1;DIR *d=fdopendir(fd);if(!d){close(fd);return -1;}int result=0;errno=0;struct dirent *entry;while((entry=readdir(d))){if(!strcasecmp(entry->d_name,name)&&strcmp(entry->d_name,name)){result=-1;break;}}if(errno)result=-1;if(closedir(d))result=-1;return result;}
static int enter(int parent,const char *name,int create){
 for(int i=0;i<nd;i++)if(dirs[i].parent==parent&&!strcmp(dirs[i].name,name))return checkdirs()? -1:i;
 if(nd>=ND||strlen(name)>128||checkdirs()||exactname(parent,name))return -1;
 int fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);
 if(fd<0&&errno==ENOENT&&create){if(mkdirat(dirs[parent].fd,name,0700)&&errno!=EEXIST)return -1;if(fsync(dirs[parent].fd))return -1;fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);}
 if(fd<0)return -1;struct stat s,at;if(fstat(fd,&s)||!S_ISDIR(s.st_mode)||fstatat(dirs[parent].fd,name,&at,AT_SYMLINK_NOFOLLOW)||!dirid(&s,&at)){close(fd);return -1;}
 int id=nd++;dirs[id].fd=fd;dirs[id].parent=parent;strcpy(dirs[id].name,name);dirs[id].identity=s;return checkdirs()? -1:id;
}
static int absolute(const char *path){
 if(path[0]!='/'||strlen(path)>=PATH_MAX)return -1;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0||nd>=ND)return -1;
 int id=nd++;dirs[id].fd=fd;dirs[id].parent=-1;dirs[id].name[0]=0;if(fstat(fd,&dirs[id].identity))return -1;
 char copy[PATH_MAX];strcpy(copy,path);char *save=NULL,*part=strtok_r(copy,"/",&save);
 while(part){if(!strcmp(part,".")||!strcmp(part,".."))return -1;id=enter(id,part,0);if(id<0)return -1;part=strtok_r(NULL,"/",&save);}return id;
}
static int parentof(int root,const char *path,char *leaf,int create){
 char copy[513];if(strlen(path)>=sizeof(copy))return -1;strcpy(copy,path);char *last=strrchr(copy,'/');if(!last||strlen(last+1)>128)return -1;strcpy(leaf,last+1);*last=0;
 char *save=NULL,*part=strtok_r(copy,"/",&save);int id=root;
 while(part){int next=enter(id,part,create);if(next<0){if(errno==ENOENT&&!create)return -2;return -1;}id=next;part=strtok_r(NULL,"/",&save);}return id;
}
static int regular(int fd,struct stat *s){return fstat(fd,s)||!S_ISREG(s->st_mode)||s->st_nlink!=1||s->st_size<0? -1:0;}
static int bytesame(int a,int b,off_t size){char x[65536],y[65536];for(off_t p=0;p<size;){size_t n=(size-p)>(off_t)sizeof(x)?sizeof(x):(size_t)(size-p);ssize_t nx=pread(a,x,n,p),ny=pread(b,y,n,p);if(nx!=(ssize_t)n||ny!=(ssize_t)n||memcmp(x,y,n))return -1;p+=n;}return 0;}
static int checkfile(File *f){struct stat s,at;if(regular(f->payload,&s)||!same(&s,&f->payloadIdentity))return -1;if(f->fd<0)return 0;if(regular(f->fd,&s)||!same(&s,&f->identity)||fstatat(dirs[f->parent].fd,f->name,&at,AT_SYMLINK_NOFOLLOW)||!same(&s,&at)||s.st_size!=f->payloadIdentity.st_size||bytesame(f->fd,f->payload,s.st_size))return -1;return 0;}
static int preflight(int root,int payloadRoot,int index,const char *path){
 File *f=&files[nf++];memset(f,0,sizeof(*f));f->fd=-1;f->parent=-1;f->payload=-1;
 char number[16];snprintf(number,sizeof(number),"%d",index);f->payload=openat(dirs[payloadRoot].fd,number,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
 if(f->payload<0||regular(f->payload,&f->payloadIdentity))return -1;
 f->parent=parentof(root,path,f->name,0);if(f->parent==-2){f->parent=-1;return 0;}if(f->parent<0)return -1;
 if(exactname(f->parent,f->name))return -1;
 f->fd=openat(dirs[f->parent].fd,f->name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
 if(f->fd<0)return errno==ENOENT?0:-1;
 if(regular(f->fd,&f->identity))return -1;return checkfile(f);
}
static int existingcheck(void){if(checkdirs())return -1;for(int i=0;i<nf;i++)if(checkfile(&files[i]))return -1;return 0;}
static int createfile(int root,int payloadRoot,int index,const char *path){
 File *f=&files[index];if(existingcheck())return -1;if(f->fd>=0)return 0;
 int parent=parentof(root,path,f->name,1);if(parent<0||checkdirs()||exactname(parent,f->name))return -1;f->parent=parent;
 char name[32];snprintf(name,sizeof(name),"new-%d",index);int stage=openat(dirs[payloadRoot].fd,name,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(stage<0)return -1;struct stat s;char buffer[65536];off_t offset=0;
 while(offset<f->payloadIdentity.st_size){size_t n=(f->payloadIdentity.st_size-offset)>(off_t)sizeof(buffer)?sizeof(buffer):(size_t)(f->payloadIdentity.st_size-offset);if(pread(f->payload,buffer,n,offset)!=(ssize_t)n||write(stage,buffer,n)!=(ssize_t)n)return -1;offset+=n;}
 if(fsync(stage)||regular(stage,&s)||s.st_size!=f->payloadIdentity.st_size||bytesame(stage,f->payload,s.st_size)||existingcheck())return -1;
 if(linkat(dirs[payloadRoot].fd,name,dirs[parent].fd,f->name,0))return -1;
 f->fd=stage;changed=1;
 if(unlinkat(dirs[payloadRoot].fd,name,0)||fstat(stage,&f->identity)||fsync(dirs[parent].fd)||existingcheck())return -1;return 0;
}
int main(int argc,char **argv){
 for(int i=0;i<NF;i++){files[i].fd=-1;files[i].payload=-1;files[i].parent=-1;}
 if(argc<5||argc>NF+4||strcmp(argv[1],"publish")!=0)return 3;
 struct rlimit limit;if(getrlimit(RLIMIT_NOFILE,&limit))return 3;
 if(limit.rlim_cur<8192){rlim_t wanted=limit.rlim_max<8192?limit.rlim_max:8192;limit.rlim_cur=wanted;if(setrlimit(RLIMIT_NOFILE,&limit))return 3;}
 int count=argc-4;int result=2;int root=absolute(argv[2]),payloadRoot=absolute(argv[3]);if(root<0||payloadRoot<0)goto done;
 for(int i=0;i<count;i++)if(preflight(root,payloadRoot,i,argv[i+4]))goto done;
 for(int i=0;i<count;i++)if(createfile(root,payloadRoot,i,argv[i+4])){if(errno==EXDEV)result=3;goto done;}
 if(existingcheck())goto done;result=0;
done:
 for(int i=0;i<nf;i++){if(files[i].fd>=0)close(files[i].fd);if(files[i].payload>=0)close(files[i].payload);}for(int i=nd-1;i>=0;i--)close(dirs[i].fd);
 if(!result&&!strcmp(argv[1],"publish"))puts(changed?"written":"unchanged");return result;
}
`;

function detach(
  input:
    | NpSiteBuildDirectionArtifactPublicationV1
    | NpSiteBuildFinalArtifactPublicationV1
    | NpSiteBuildGeneratorAuditPublicationV1,
  mode: "direction" | "final" | "audit" = "direction",
): {
  project: string;
  files: Array<{ path: string; bytes: Buffer }>;
} {
  const final = mode === "final",
    audit = mode === "audit";
  const fail = (reason: "input" | "path" = "input"): never => {
    throw new SiteBuildError(reason);
  };
  const record = (value: unknown, keys: string[]) => {
    if (
      !value ||
      typeof value !== "object" ||
      types.isProxy(value) ||
      Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length
    )
      return fail();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
      result[key] = descriptor.value;
    }
    return result;
  };
  const root = record(input, ["project", "artifacts", final || audit ? "manifest" : "sealedSet"]);
  if (
    typeof root.project !== "string" ||
    !root.project.startsWith("/") ||
    root.project !== resolve(root.project) ||
    root.project === "/" ||
    root.project.length > 4096
  )
    return fail("path");
  const path = (value: unknown, sealed: boolean) => {
    if (typeof value !== "string" || value.length > 512 || !value.startsWith(".nexpress/site/"))
      return fail("path");
    const parts = value.split("/");
    if (
      parts.length > 12 ||
      parts.some((part, index) =>
        index === 0
          ? part !== ".nexpress"
          : !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(part) ||
            part.endsWith(".") ||
            /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part) ||
            /^(?:id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(part),
      )
    )
      return fail("path");
    if (audit) {
      if (
        parts.length !== 5 ||
        parts[2] !== "audit" ||
        !/^generator-[A-Za-z0-9-]{1,80}$/u.test(parts[3]) ||
        !(sealed ? parts[4] === "manifest.json" : /\.(?:json|log)$/u.test(parts[4]))
      )
        return fail("path");
    } else if (final) {
      if (
        !value.startsWith(".nexpress/site/review/final/") ||
        !(sealed ? value.endsWith(".json") : /\.(?:png|json)$/u.test(value))
      )
        return fail("path");
    } else if (
      sealed
        ? parts.length !== 3 || !value.endsWith(".json")
        : !value.startsWith(".nexpress/site/review/directions/") ||
          !/\.(?:png|receipt\.json)$/u.test(value)
    )
      return fail("path");
    return value;
  };
  const bytes = (value: unknown, max: number): Buffer => {
    if (!value || types.isProxy(value) || !(value instanceof Uint8Array)) return fail();
    const proto = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(
      value,
    ) as ArrayBuffer;
    const offset = Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(value) as number;
    const length = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value) as number;
    if (types.isSharedArrayBuffer(buffer) || length < (audit ? 0 : 1) || length > max)
      return fail();
    return Buffer.from(new Uint8Array(buffer, offset, length));
  };
  if (
    !Array.isArray(root.artifacts) ||
    types.isProxy(root.artifacts) ||
    (audit
      ? root.artifacts.length < 1 || root.artifacts.length > 400
      : final
        ? root.artifacts.length > 402
        : root.artifacts.length !== 12)
  )
    return fail();
  if (Reflect.ownKeys(root.artifacts).length !== root.artifacts.length + 1) return fail();
  const files: Array<{ path: string; bytes: Buffer }> = [];
  let totalBytes = 0;
  for (let i = 0; i < root.artifacts.length; i++) {
    const item = Object.getOwnPropertyDescriptor(root.artifacts, String(i));
    if (!item?.enumerable || !("value" in item)) return fail();
    const entry = record(item.value, ["path", "bytes"]),
      name = path(entry.path, false);
    files.push({
      path: name,
      bytes: bytes(
        entry.bytes,
        audit
          ? 8 * 1024 * 1024
          : name.endsWith(".png")
            ? 10 * 1024 * 1024
            : final
              ? 512 * 1024
              : 32 * 1024,
      ),
    });
    if ((totalBytes += files.at(-1)!.bytes.length) > (audit ? 256 : 512) * 1024 * 1024)
      return fail();
  }
  if (!final && !audit && files.filter((file) => file.path.endsWith(".png")).length !== 6)
    return fail();
  // The only extra leaf beyond the 200-route preview is its observed command
  // record. Keep the preview inventory and all byte limits unchanged.
  if (
    final &&
    files.length === 402 &&
    (files.filter((file) => file.path.endsWith(".png")).length !== 400 ||
      files.filter((file) => file.path.endsWith(".json")).length !== 2 ||
      files.filter((file) =>
        /^\.nexpress\/site\/review\/final\/observations-[A-Za-z0-9-]+\.json$/u.test(file.path),
      ).length !== 1)
  )
    return fail();
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const sealed = record(final || audit ? root.manifest : root.sealedSet, ["path", "bytes"]);
  files.push({ path: path(sealed.path, true), bytes: bytes(sealed.bytes, 4 * 1024 * 1024) });
  if (
    audit &&
    (files.at(-1)!.bytes.length === 0 ||
      totalBytes + files.at(-1)!.bytes.length > 256 * 1024 * 1024 ||
      files.some((file) => file.path.split("/")[3] !== files.at(-1)!.path.split("/")[3]))
  )
    return fail("path");
  const all = new Set(files.map((file) => file.path.toLowerCase()));
  const prefixes = new Map<string, string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join("/"),
        folded = prefix.toLowerCase();
      const previous = prefixes.get(folded);
      if (previous !== undefined && previous !== prefix) return fail("path");
      prefixes.set(folded, prefix);
    }
  }
  if (
    all.size !== files.length ||
    files.some((file) =>
      file.path
        .split("/")
        .slice(0, -1)
        .some((_part, i) =>
          all.has(
            file.path
              .split("/")
              .slice(0, i + 1)
              .join("/")
              .toLowerCase(),
          ),
        ),
    )
  )
    return fail("path");
  return { project: root.project, files };
}

async function runFixed(
  executable: string,
  args: string[],
  timeoutMs: number,
  temporaryRoot: string,
): Promise<{ code: number; stdout: string }> {
  return new Promise((accept, reject) => {
    const child = spawn(executable, args, {
      cwd: "/",
      env: {
        PATH: "/usr/bin:/bin",
        HOME: "/nonexistent",
        LANG: "C",
        LC_ALL: "C",
        TMPDIR: temporaryRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let total = 0,
      stdout = "",
      failed = false;
    const stop = () => {
      failed = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on("data", (value: Buffer) => {
      total += value.length;
      if (total > 65536) stop();
      else stdout += value.toString("utf8");
    });
    child.stderr.on("data", (value: Buffer) => {
      total += value.length;
      if (total > 65536) stop();
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failed || signal !== null || code === null) reject(new SiteBuildError("unavailable"));
      else accept({ code, stdout });
    });
  });
}

/**
 * Byte publication only; the caller validates renderer/receipt/set evidence.
 * Requires system cc and one filesystem for private staging and destination.
 * Every failure retains already published destination files and directories;
 * only private staging/helper files are removed. Identical bytes can be retried,
 * while operator changes remain conflicts. There is no destination unlink path.
 * FD leases detect reparenting but cannot prevent same-principal renames between
 * syscalls. Failure does not confirm that a sealed set is absent: a failure after
 * its final link can retain that file too. Every consumer must validate it fresh.
 */
export async function publishSiteBuildDirectionArtifactsV1(
  input: NpSiteBuildDirectionArtifactPublicationV1,
): Promise<{ status: "written" | "unchanged"; paths: string[] }> {
  return publish(detach(input), NpSiteBuildDirectionArtifactPublicationErrorV1);
}

/** Bounded review output publication only; a manifest's presence never attests execution. */
export async function publishSiteBuildFinalArtifactsV1(
  input: NpSiteBuildFinalArtifactPublicationV1,
): Promise<{ status: "written" | "unchanged"; paths: string[] }> {
  return publish(detach(input, "final"), NpSiteBuildFinalArtifactPublicationErrorV1);
}
/** Byte retention only. Manifest presence is never proof of execution or approval. */
export async function publishSiteBuildGeneratorAuditV1(
  input: NpSiteBuildGeneratorAuditPublicationV1,
): Promise<{ status: "written" | "unchanged"; paths: string[] }> {
  return publish(detach(input, "audit"), NpSiteBuildGeneratorAuditPublicationErrorV1);
}

async function publish(
  detached: ReturnType<typeof detach>,
  PublicationError:
    | typeof NpSiteBuildDirectionArtifactPublicationErrorV1
    | typeof NpSiteBuildFinalArtifactPublicationErrorV1
    | typeof NpSiteBuildGeneratorAuditPublicationErrorV1,
): Promise<{ status: "written" | "unchanged"; paths: string[] }> {
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !constants.O_NOFOLLOW ||
    !constants.O_DIRECTORY
  )
    throw new SiteBuildError("unavailable");
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-direction-publish-")));
  const executable = join(root, "publisher");
  const argumentsV1 = [
    detached.project,
    join(root, "payload"),
    ...detached.files.map((file) => file.path),
  ];
  let attempted = false;
  try {
    await chmod(root, 0o700);
    await mkdir(join(root, "payload"), { mode: 0o700 });
    const source = join(root, "publisher.c");
    await writeFile(source, publisherSource, { flag: "wx", mode: 0o600 });
    const compiled = await runFixed(
      "/usr/bin/cc",
      ["-std=c11", "-O2", "-Wall", "-Werror", source, "-o", executable],
      30000,
      root,
    );
    if (compiled.code !== 0) throw new SiteBuildError("unavailable");
    for (let i = 0; i < detached.files.length; i++) {
      const fd = await open(join(root, "payload", String(i)), "wx", 0o400);
      try {
        await fd.writeFile(detached.files[i].bytes);
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
    attempted = true;
    const result = await runFixed(executable, ["publish", ...argumentsV1], 30000, root);
    if (result.code !== 0) throw new SiteBuildError(result.code === 2 ? "conflict" : "unavailable");
    if (result.stdout !== "written\n" && result.stdout !== "unchanged\n")
      throw new SiteBuildError("unavailable");
    return {
      status: result.stdout === "written\n" ? "written" : "unchanged",
      paths: detached.files.map((file) => file.path),
    };
  } catch (error) {
    if (attempted)
      throw new PublicationError(error instanceof SiteBuildError ? error.reason : "unavailable");
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
