import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { types } from "node:util";
import {
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npRequireAgentBuildSourceTreeV1,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBuildSourceTreeV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

export interface NpSiteBuildRepositoryPublicationInputV1 {
  project: string;
  blueprint: unknown;
  baseline: NpAgentBuildSourceTreeV1;
  /** Caller-observed paths; this owner never invokes Git. */
  dirtyPaths: readonly string[];
  /** The caller owns verification. This DTO only identifies the exact observed raw source tree. */
  candidate: { project: string; sourceTree: NpAgentBuildSourceTreeV1 };
}
export interface NpSiteBuildRepositoryPublicationReceiptV1 {
  scope: "repository-file-plan-publication";
  blueprintHash: string;
  baselineTreeDigest: string;
  candidateTreeDigest: string;
  casProfile: "np.site-build-same-principal-fd-cas.v1";
  preservedDirtyPaths: string[];
  files: Array<{
    path: string;
    source: "staged" | "command";
    action: "create" | "update";
    expectedHash: string | null;
    contentHash: string;
    mode: "100644" | "100755";
  }>;
}
export interface NpSiteBuildRepositoryPublicationV1 {
  receipt: NpSiteBuildRepositoryPublicationReceiptV1;
  publish(): Promise<{
    scope: "repository-file-plan-publication";
    status: "written" | "unchanged";
    writtenPaths: string[];
    unchangedPaths: string[];
    treeDigest: string;
  }>;
  close(): Promise<void>;
}
/** No rollback or deletion of original files occurs, including after a partial write. */
export class NpSiteBuildRepositoryPublicationErrorV1 extends SiteBuildError {
  readonly scope = "repository-file-plan-publication";
  constructor(
    reason: "conflict" | "unavailable",
    readonly publicationState: "preflight-rejected" | "partial-changes-may-remain",
    readonly writtenPaths: string[],
    readonly unchangedPaths: string[],
    readonly uncertainPaths: string[],
  ) {
    super(reason);
  }
}

// Node has no openat on these hosts, and macOS has no usable /dev/fd directory
// children. This fixed POSIX adapter performs only FD-relative byte operations.
// Leases plus exact byte comparisons detect replacement, but are not atomic CAS
// against an uncooperative process with the same OS principal. In-place updates
// and create-only writes can be partially visible; there is no multi-file transaction.
const adapterSource = String.raw`
#define _GNU_SOURCE
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <limits.h>
#include <dirent.h>
#ifndef O_NOFOLLOW
#error O_NOFOLLOW required
#endif
#define MAXD 4096
#define MAXR 500
#define MAXB (64LL*1024*1024)
#define TOTALB (512LL*1024*1024)
typedef struct {int fd,parent;char name[256];struct stat identity;} Dir;
typedef struct {char path[513];uint32_t mode,present,write;int original,candidate,oldparent,newparent,state;char oldleaf[256],newleaf[256];struct stat oldidentity,newidentity;} Row;
static Dir dirs[MAXD];static Row rows[MAXR];static int nd=0,nr=0,originalroot=-1,candidateroot=-1,workspace=-1,cache=-1;
static int dirsame(const struct stat*a,const struct stat*b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_mode==b->st_mode;}
static int same(const struct stat*a,const struct stat*b){if(!dirsame(a,b)||a->st_nlink!=b->st_nlink||a->st_size!=b->st_size)return 0;
#ifdef __APPLE__
 return a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec&&a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec&&a->st_ctimespec.tv_sec==b->st_ctimespec.tv_sec&&a->st_ctimespec.tv_nsec==b->st_ctimespec.tv_nsec;
#else
 return a->st_mtim.tv_sec==b->st_mtim.tv_sec&&a->st_mtim.tv_nsec==b->st_mtim.tv_nsec&&a->st_ctim.tv_sec==b->st_ctim.tv_sec&&a->st_ctim.tv_nsec==b->st_ctim.tv_nsec;
#endif
}
static int regular(int fd,struct stat*s){return fstat(fd,s)||!S_ISREG(s->st_mode)||s->st_nlink!=1||(s->st_mode&07000)||s->st_size<0||s->st_size>MAXB?-1:0;}
static int exactname(int parent,const char*name){int fd=openat(dirs[parent].fd,".",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)return 0;DIR*d=fdopendir(fd);if(!d){close(fd);return 0;}int found=0;struct dirent*entry;while((entry=readdir(d)))if(!strcmp(entry->d_name,name)){found=1;break;}closedir(d);if(!found)errno=EEXIST;return found;}
static int checkdirs(void){for(int i=0;i<nd;i++){struct stat s;if(fstat(dirs[i].fd,&s)||!dirsame(&s,&dirs[i].identity))return -1;if(dirs[i].parent>=0&&(!exactname(dirs[i].parent,dirs[i].name)||fstatat(dirs[dirs[i].parent].fd,dirs[i].name,&s,AT_SYMLINK_NOFOLLOW)||!dirsame(&s,&dirs[i].identity)))return -1;}return 0;}
static int enter(int parent,const char*name,int create){
 if(parent<0||parent>=nd||!name[0]||strlen(name)>255||!strcmp(name,".")||!strcmp(name,".."))return -1;
 for(int i=0;i<nd;i++)if(dirs[i].parent==parent&&!strcmp(dirs[i].name,name)){struct stat s;if(fstatat(dirs[parent].fd,name,&s,AT_SYMLINK_NOFOLLOW)||!dirsame(&s,&dirs[i].identity))return -1;return i;}
 if(nd>=MAXD)return -1;
 int fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);
 if(fd<0&&errno==ENOENT&&create){if(mkdirat(dirs[parent].fd,name,0700)&&errno!=EEXIST)return -1;fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);}
 if(fd<0)return -1;
 struct stat s,at;if(!exactname(parent,name)||fstat(fd,&s)||!S_ISDIR(s.st_mode)||fstatat(dirs[parent].fd,name,&at,AT_SYMLINK_NOFOLLOW)||!dirsame(&s,&at)){close(fd);return -1;}
 int id=nd++;dirs[id].fd=fd;dirs[id].parent=parent;strcpy(dirs[id].name,name);dirs[id].identity=s;return id;
}
static int absolute(const char*path){if(path[0]!='/'||strlen(path)>=PATH_MAX||nd>=MAXD)return -1;int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)return -1;int id=nd++;dirs[id].fd=fd;dirs[id].parent=-1;dirs[id].name[0]=0;if(fstat(fd,&dirs[id].identity))return -1;char copy[PATH_MAX];strcpy(copy,path);char*save=NULL,*p=strtok_r(copy,"/",&save);while(p){id=enter(id,p,0);if(id<0)return -1;p=strtok_r(NULL,"/",&save);}return id;}
static int parentof(int root,const char*path,char*leaf,int create){char copy[513];if(!path[0]||strlen(path)>512)return -1;strcpy(copy,path);char*last=strrchr(copy,'/');if(!last){if(strlen(copy)>255)return -1;strcpy(leaf,copy);return root;}if(strlen(last+1)>255)return -1;strcpy(leaf,last+1);*last=0;char*save=NULL,*p=strtok_r(copy,"/",&save);int id=root;while(p){id=enter(id,p,create);if(id<0)return -1;p=strtok_r(NULL,"/",&save);}return id;}
static int checked(int parent,const char*leaf,int fd,const struct stat*identity){struct stat s,at;return regular(fd,&s)||!same(&s,identity)||fstatat(dirs[parent].fd,leaf,&at,AT_SYMLINK_NOFOLLOW)||!same(&s,&at)?-1:0;}
static int copybytes(int from,int to,off_t size){char b[65536];for(off_t p=0;p<size;){size_t n=size-p>(off_t)sizeof(b)?sizeof(b):(size_t)(size-p);ssize_t got=pread(from,b,n,p);if(got<=0)return -1;size_t done=0;while(done<(size_t)got){ssize_t wrote=pwrite(to,b+done,(size_t)got-done,p+(off_t)done);if(wrote<=0)return -1;done+=(size_t)wrote;}p+=got;}return 0;}
static int bytesame(int a,int b,off_t size){char x[65536],y[65536];for(off_t p=0;p<size;){size_t n=size-p>(off_t)sizeof(x)?sizeof(x):(size_t)(size-p);if(pread(a,x,n,p)!=(ssize_t)n||pread(b,y,n,p)!=(ssize_t)n||memcmp(x,y,n))return -1;p+=n;}return 0;}
static int cached(int index,struct stat*s){char name[24];snprintf(name,sizeof(name),"%d",index);int fd=openat(dirs[cache].fd,name,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(fd<0||regular(fd,s))return -1;return fd;}
static int snapshot(int fd,int index,const struct stat*s){char name[24];snprintf(name,sizeof(name),"%d",index);int out=openat(dirs[cache].fd,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0400);if(out<0)return -1;int result=copybytes(fd,out,s->st_size)||fsync(out);close(out);return result?-1:0;}
static int u32(FILE*f,uint32_t*out){unsigned char b[4];if(fread(b,1,4,f)!=4)return -1;*out=((uint32_t)b[0]<<24)|((uint32_t)b[1]<<16)|((uint32_t)b[2]<<8)|b[3];return 0;}
static int frame(void){int fd=openat(dirs[workspace].fd,"plan.bin",O_RDONLY|O_NOFOLLOW|O_NONBLOCK);struct stat s;if(fd<0||regular(fd,&s))return -1;FILE*f=fdopen(fd,"rb");if(!f){close(fd);return -1;}char magic[8];uint32_t count;int result=-1;if(fread(magic,1,8,f)!=8||memcmp(magic,"NPPUB001",8)||u32(f,&count)||count>MAXR)goto done;nr=(int)count;
 for(int i=0;i<nr;i++){Row*r=&rows[i];uint32_t n;r->original=r->candidate=-1;if(u32(f,&r->mode)||u32(f,&r->present)||u32(f,&r->write)||u32(f,&n)||n<1||n>512||fread(r->path,1,n,f)!=n||memchr(r->path,0,n)||(r->mode!=0644&&r->mode!=0755)||r->present>1||r->write>1)goto done;r->path[n]=0;}if(fgetc(f)!=EOF)goto done;result=0;
 done:fclose(f);return result;}
static int state(int save,int directfd){int fd=directfd;if(save)fd=openat(dirs[workspace].fd,"state.bin",O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_NONBLOCK,0600);struct stat s;if(fd<0||regular(fd,&s))return -1;FILE*f=fdopen(fd,save?"wb":"rb");if(!f){close(fd);return -1;}int values[6]={nd,nr,originalroot,candidateroot,workspace,cache},result=-1;
 if(save){if(fwrite(values,sizeof(values),1,f)!=1)goto done;for(int i=0;i<nd;i++)if(fwrite(&dirs[i].parent,sizeof(int),1,f)!=1||fwrite(dirs[i].name,256,1,f)!=1||fwrite(&dirs[i].identity,sizeof(struct stat),1,f)!=1)goto done;if(fwrite(rows,sizeof(Row),(size_t)nr,f)!=(size_t)nr||fflush(f)||fsync(fd))goto done;}
 else{if(fread(values,sizeof(values),1,f)!=1||values[0]<1||values[0]>MAXD||values[1]<0||values[1]>MAXR)goto done;nr=values[1];for(int i=0;i<values[0];i++){int parent;char name[256];struct stat identity;if(fread(&parent,sizeof(int),1,f)!=1||fread(name,256,1,f)!=1||!memchr(name,0,256)||fread(&identity,sizeof(identity),1,f)!=1)goto done;int id;if(parent<0)id=absolute("/");else{if(parent>=i)goto done;id=enter(parent,name,0);}if(id!=i||!dirsame(&dirs[id].identity,&identity))goto done;}if(fread(rows,sizeof(Row),(size_t)nr,f)!=(size_t)nr||fgetc(f)!=EOF)goto done;originalroot=values[2];candidateroot=values[3];workspace=values[4];cache=values[5];for(int i=2;i<6;i++)if(values[i]<0||values[i]>=nd)goto done;for(int i=0;i<nr;i++)rows[i].original=rows[i].candidate=-1;}
 result=checkdirs();done:fclose(f);return result;}
static int capture(void){off_t total=0;for(int i=0;i<nr;i++){Row*r=&rows[i];r->newparent=parentof(candidateroot,r->path,r->newleaf,0);if(r->newparent<0)return -1;r->candidate=openat(dirs[r->newparent].fd,r->newleaf,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(r->candidate<0||regular(r->candidate,&r->newidentity)||((r->newidentity.st_mode&0111)?0755:0644)!=r->mode||(total+=r->newidentity.st_size)>TOTALB||snapshot(r->candidate,2*i+1,&r->newidentity)||checked(r->newparent,r->newleaf,r->candidate,&r->newidentity))return -1;
 r->oldparent=parentof(originalroot,r->path,r->oldleaf,0);if(r->oldparent<0){if(errno==ENOENT&&!r->present)continue;return -1;}r->original=openat(dirs[r->oldparent].fd,r->oldleaf,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(r->original<0){if(errno==ENOENT&&!r->present)continue;return -1;}if(!r->present||regular(r->original,&r->oldidentity)||((r->oldidentity.st_mode&0111)?0755:0644)!=r->mode||(total+=r->oldidentity.st_size)>TOTALB||snapshot(r->original,2*i,&r->oldidentity)||checked(r->oldparent,r->oldleaf,r->original,&r->oldidentity))return -1;}
 return checkdirs();}
static int leases(void){if(checkdirs())return -1;for(int i=0;i<nr;i++){Row*r=&rows[i];if(r->candidate>=0&&checked(r->newparent,r->newleaf,r->candidate,&r->newidentity))return -1;if(r->original>=0&&checked(r->oldparent,r->oldleaf,r->original,&r->oldidentity))return -1;}return 0;}
static int preflight(void){if(checkdirs())return -1;for(int i=0;i<nr;i++){Row*r=&rows[i];r->candidate=openat(dirs[r->newparent].fd,r->newleaf,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(r->candidate<0||checked(r->newparent,r->newleaf,r->candidate,&r->newidentity))return -1;struct stat payload;int data=cached(2*i+1,&payload);if(data<0)return -1;int bad=payload.st_size!=r->newidentity.st_size||bytesame(data,r->candidate,payload.st_size);close(data);if(bad)return -1;
 r->oldparent=parentof(originalroot,r->path,r->oldleaf,0);r->state=0;if(r->oldparent<0){if(errno==ENOENT&&!r->present&&r->write)continue;return -1;}r->original=openat(dirs[r->oldparent].fd,r->oldleaf,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(r->original<0){if(errno==ENOENT&&!r->present&&r->write)continue;return -1;}if(!r->present||checked(r->oldparent,r->oldleaf,r->original,&r->oldidentity))return -1;
 data=cached(2*i+1,&payload);if(data<0)return -1;int final=r->oldidentity.st_size==payload.st_size&&!bytesame(r->original,data,payload.st_size);close(data);if(final){r->state=1;continue;}if(!r->write)return -1;data=cached(2*i,&payload);if(data<0)return -1;bad=r->oldidentity.st_size!=payload.st_size||bytesame(r->original,data,payload.st_size);close(data);if(bad)return -1;
 int writefd=openat(dirs[r->oldparent].fd,r->oldleaf,O_RDWR|O_NOFOLLOW|O_NONBLOCK);if(writefd<0||checked(r->oldparent,r->oldleaf,writefd,&r->oldidentity))return -1;close(r->original);r->original=writefd;r->state=2;
 }return leases();}
static int publish(void){if(preflight())return -1;for(int i=0;i<nr;i++){Row*r=&rows[i];if(r->state==1){printf("unchanged:%d\n",i);fflush(stdout);continue;}if(leases())return -1;printf("attempt:%d\n",i);fflush(stdout);struct stat payload;int data=cached(2*i+1,&payload);if(data<0)return -1;
 if(r->state==0){r->oldparent=parentof(originalroot,r->path,r->oldleaf,1);if(r->oldparent<0||checkdirs()){close(data);return -1;}r->original=openat(dirs[r->oldparent].fd,r->oldleaf,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK,r->mode);if(r->original<0){close(data);return -1;}r->present=1;if(fchmod(r->original,r->mode)){close(data);return -1;}}
 else if(checked(r->oldparent,r->oldleaf,r->original,&r->oldidentity)){close(data);return -1;}
 if(copybytes(data,r->original,payload.st_size)||ftruncate(r->original,payload.st_size)||fsync(r->original)||regular(r->original,&r->oldidentity)||r->oldidentity.st_size!=payload.st_size||bytesame(r->original,data,payload.st_size)||checked(r->oldparent,r->oldleaf,r->original,&r->oldidentity)||fsync(dirs[r->oldparent].fd)||leases()){close(data);return -1;}close(data);r->state=1;printf("written:%d\n",i);fflush(stdout);
 }return state(1,-1);}
int main(int argc,char**argv){if(argc!=5)return 3;int mode=!strcmp(argv[1],"capture")?0:!strcmp(argv[1],"publish")?1:-1;if(mode<0)return 3;int result=2;
 if(mode==0){workspace=absolute(argv[4]);if(workspace<0)goto done;cache=enter(workspace,"inputs",0);if(cache<0||frame())goto done;originalroot=absolute(argv[2]);candidateroot=absolute(argv[3]);if(originalroot<0||candidateroot<0||capture()||state(1,-1))goto done;}
 else{int fd=open(argv[4],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);if(fd<0)goto done;int source=openat(fd,"state.bin",O_RDONLY|O_NOFOLLOW|O_NONBLOCK);close(fd);if(source<0||state(0,source)||publish())goto done;}
 result=0;done:for(int i=0;i<nr;i++){if(rows[i].original>=0)close(rows[i].original);if(rows[i].candidate>=0)close(rows[i].candidate);}for(int i=nd-1;i>=0;i--)close(dirs[i].fd);return result;}
`;

function fields(value: unknown, names: string[]): Map<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== names.length
  )
    throw new SiteBuildError("input");
  return new Map(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(value, name);
      if (!field?.enumerable || !("value" in field)) throw new SiteBuildError("input");
      return [name, field.value];
    }),
  );
}
// Core owns artifact validation; this Node-only preflight additionally rejects Proxy
// traps before the browser-safe Core inspector performs descriptor operations.
function rejectRuntimeObjects(value: unknown): void {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 32) throw new SiteBuildError("input");
    if (item === null || typeof item !== "object") return;
    if (types.isProxy(item) || seen.has(item)) throw new SiteBuildError("input");
    seen.add(item);
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype))
      throw new SiteBuildError("input");
    if (array && item.length > 10_000) throw new SiteBuildError("input");
    const keys = Reflect.ownKeys(item);
    if (keys.length > (array ? 10_001 : 1024)) throw new SiteBuildError("input");
    for (const key of keys) {
      if (typeof key !== "string") throw new SiteBuildError("input");
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (!field || !("value" in field) || (!field.enumerable && !(array && key === "length")))
        throw new SiteBuildError("input");
      if (!(array && key === "length")) visit(field.value, depth + 1);
    }
  };
  visit(value, 0);
}
function rootPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value !== resolve(value) ||
    value === "/" ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new SiteBuildError("path");
  return value;
}
const zero = `nb1:file-sha256:${"A".repeat(43)}`;
function portable(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 512 ||
    value.split("/").some((part) => Buffer.byteLength(part) > 255)
  )
    throw new SiteBuildError("path");
  npRequireAgentBuildSourceTreeV1({
    schemaVersion: "np.agent-build-source-tree.v1",
    files: [{ path: value, kind: "file", mode: "100644", digest: zero }],
  });
  return value;
}
const reserved = (path: string) =>
  path
    .split("/")
    .some((part) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|\.agents|\.nexpress|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
        part,
      ),
    );
function consistent(paths: Iterable<string>): void {
  const names = new Map<string, string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const value = parts.slice(0, index).join("/"),
        folded = value.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
      if (names.has(folded) && names.get(folded) !== value) throw new SiteBuildError("path");
      names.set(folded, value);
    }
  }
}
const ordered = (paths: Iterable<string>) =>
  [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
const overlap = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}
async function capturedBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 0n ||
      before.size > 64n * 1024n * 1024n
    )
      throw new SiteBuildError("conflict");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!read.bytesRead) throw new SiteBuildError("conflict");
      offset += read.bytesRead;
    }
    if ((await file.read(Buffer.alloc(1), 0, 1, offset)).bytesRead)
      throw new SiteBuildError("conflict");
    const identity = ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"] as const;
    for (const after of [await file.stat({ bigint: true }), await lstat(path, { bigint: true })])
      if (identity.some((key) => before[key] !== after[key])) throw new SiteBuildError("conflict");
    return bytes;
  } finally {
    await file.close();
  }
}
async function runFixed(
  executable: string,
  args: string[],
  temporaryRoot: string,
): Promise<{ code: number; stdout: string; stopped: boolean }> {
  return new Promise((resolveRun) => {
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
    let stdout = "",
      bytes = 0,
      stopped = false;
    const stop = () => {
      stopped = true;
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
    };
    const timer = setTimeout(stop, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65536) stop();
      else stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65536) stop();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolveRun({ code: 3, stdout, stopped: true });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 3, stdout, stopped: stopped || signal !== null });
    });
  });
}

/**
 * Bind a verified candidate's exact file-plan bytes, then explicitly publish them.
 * Verification/approval belongs to the caller; this handle never grants authority or
 * runs project code, blueprint commands, Runtime, DB, or Git. Updates preserve existing
 * permissions and inode; creates are O_EXCL. Unrelated paths are never written.
 * POSIX leases/exact comparisons are not atomic against another process with the same
 * OS principal. Failure can leave partial bytes/directories; no original is deleted or
 * rolled back. Requires local cc/POSIX and at most 500 rows, 64MiB/file, 512MiB captured.
 */
export async function prepareSiteBuildRepositoryPublicationV1(
  input: NpSiteBuildRepositoryPublicationInputV1,
): Promise<NpSiteBuildRepositoryPublicationV1> {
  const dto = fields(input, ["project", "blueprint", "baseline", "dirtyPaths", "candidate"]);
  const project = rootPath(dto.get("project"));
  const candidateDto = fields(dto.get("candidate"), ["project", "sourceTree"]),
    candidate = rootPath(candidateDto.get("project"));
  if (
    project === candidate ||
    project.startsWith(`${candidate}/`) ||
    candidate.startsWith(`${project}/`)
  )
    throw new SiteBuildError("path");
  for (const value of [dto.get("blueprint"), dto.get("baseline"), candidateDto.get("sourceTree")])
    rejectRuntimeObjects(value);
  const blueprint = npRequireAgentSiteBlueprintV1(dto.get("blueprint"));
  const baseline = npRequireAgentBuildSourceTreeV1(dto.get("baseline"));
  const candidateTree = npRequireAgentBuildSourceTreeV1(candidateDto.get("sourceTree"));
  const dirtyValue = dto.get("dirtyPaths");
  if (
    !Array.isArray(dirtyValue) ||
    types.isProxy(dirtyValue) ||
    dirtyValue.length > 10000 ||
    Reflect.ownKeys(dirtyValue).length !== dirtyValue.length + 1
  )
    throw new SiteBuildError("input");
  const dirty: string[] = [];
  for (let i = 0; i < dirtyValue.length; i++) {
    const d = Object.getOwnPropertyDescriptor(dirtyValue, String(i));
    if (!d?.enumerable || !("value" in d)) throw new SiteBuildError("input");
    dirty.push(portable(d.value));
  }
  const dirtyPaths = ordered(new Set(dirty));
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !constants.O_NOFOLLOW ||
    !constants.O_DIRECTORY
  )
    throw new SiteBuildError("unavailable");
  if ((await realpath(project)) !== project || (await realpath(candidate)) !== candidate)
    throw new SiteBuildError("path");
  const candidateTreeDigest = await npBuildCanonicalDigest(
    "np.build-source-tree.v1",
    candidateTree,
  );
  if ((await readSiteSourceTreeV1(candidate)).digest !== candidateTreeDigest)
    throw new SiteBuildError("conflict");
  const originalTree = await readSiteSourceTreeV1(project),
    originalFiles = new Map(originalTree.manifest.files.map((f) => [f.path, f]));
  const before = new Map(baseline.files.map((f) => [f.path, f])),
    finalFiles = new Map(candidateTree.files.map((f) => [f.path, f]));
  consistent([
    ...originalFiles.keys(),
    ...before.keys(),
    ...finalFiles.keys(),
    ...dirtyPaths,
    ...blueprint.filePlan.map((f) => f.path),
  ]);
  const rows = blueprint.filePlan.map((row) => {
    const old = before.get(row.path),
      current = originalFiles.get(row.path),
      file = finalFiles.get(row.path),
      mode = old?.mode ?? "100644";
    if (reserved(portable(row.path))) throw new SiteBuildError("path");
    if (
      row.action === "update"
        ? !old || ![row.expectedHash, row.contentHash].includes(old.digest)
        : old && old.digest !== row.contentHash
    )
      throw new SiteBuildError("conflict");
    if (
      !file ||
      file.digest !== row.contentHash ||
      file.mode !== mode ||
      (current &&
        (current.mode !== mode || ![row.expectedHash, row.contentHash].includes(current.digest))) ||
      (!current && row.action === "update")
    )
      throw new SiteBuildError("conflict");
    const dirtyOverlap = dirtyPaths.some((path) => overlap(path, row.path));
    if (dirtyOverlap && current?.digest !== row.contentHash) throw new SiteBuildError("conflict");
    return { ...row, mode, present: Boolean(current), write: !dirtyOverlap };
  });
  const receipt: NpSiteBuildRepositoryPublicationReceiptV1 = {
    scope: "repository-file-plan-publication",
    blueprintHash: await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint),
    baselineTreeDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", baseline),
    candidateTreeDigest,
    casProfile: "np.site-build-same-principal-fd-cas.v1",
    preservedDirtyPaths: dirtyPaths,
    files: rows.map(({ path, source, action, expectedHash, contentHash, mode }) => ({
      path,
      source,
      action,
      expectedHash,
      contentHash,
      mode,
    })),
  };
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-repository-publication-"))),
    executable = join(root, "adapter");
  let closed = false,
    running = false,
    invalid = false;
  const ensureOpen = () => {
    if (closed || running || invalid) throw new SiteBuildError("conflict");
  };
  try {
    await chmod(root, 0o700);
    await mkdir(join(root, "inputs"), { mode: 0o700 });
    await writeFile(join(root, "adapter.c"), adapterSource, { flag: "wx", mode: 0o600 });
    const compile = await runFixed(
      "/usr/bin/cc",
      ["-std=c11", "-O2", "-Wall", "-Werror", join(root, "adapter.c"), "-o", executable],
      root,
    );
    if (compile.code !== 0 || compile.stopped) throw new SiteBuildError("unavailable");
    await writeFile(
      join(root, "plan.bin"),
      Buffer.concat([
        Buffer.from("NPPUB001"),
        u32(rows.length),
        ...rows.flatMap((row) => [
          u32(row.mode === "100755" ? 0o755 : 0o644),
          u32(Number(row.present)),
          u32(Number(row.write)),
          u32(Buffer.byteLength(row.path)),
          Buffer.from(row.path),
        ]),
      ]),
      { flag: "wx", mode: 0o400 },
    );
    const captured = await runFixed(executable, ["capture", project, candidate, root], root);
    if (captured.code !== 0 || captured.stopped) throw new SiteBuildError("conflict");
    for (const [index, row] of rows.entries()) {
      const bytes = await capturedBytes(join(root, "inputs", String(2 * index + 1)));
      if ((await npBuildFileDigest("np.build-source-file.v1", bytes)) !== row.contentHash)
        throw new SiteBuildError("conflict");
      if (row.present) {
        const old = await capturedBytes(join(root, "inputs", String(2 * index)));
        if (
          ![row.expectedHash, row.contentHash].includes(
            await npBuildFileDigest("np.build-source-file.v1", old),
          )
        )
          throw new SiteBuildError("conflict");
      }
    }
    if ((await readSiteSourceTreeV1(candidate)).digest !== candidateTreeDigest)
      throw new SiteBuildError("conflict");
    return {
      receipt: structuredClone(receipt),
      async publish() {
        ensureOpen();
        running = true;
        let entered = false;
        const attempted: string[] = [],
          written: string[] = [],
          unchanged: string[] = [];
        try {
          const current = await readSiteSourceTreeV1(project);
          consistent([
            ...current.manifest.files.map((f) => f.path),
            ...dirtyPaths,
            ...rows.map((f) => f.path),
          ]);
          if ((await readSiteSourceTreeV1(candidate)).digest !== candidateTreeDigest)
            throw new SiteBuildError("conflict");
          entered = true;
          const result = await runFixed(executable, ["publish", project, candidate, root], root);
          const events = result.stdout ? result.stdout.trimEnd().split("\n") : [];
          for (const event of events) {
            const match = /^(attempt|written|unchanged):([0-9]+)$/u.exec(event);
            if (!match || !rows[Number(match[2])]) throw new SiteBuildError("unavailable");
            const path = rows[Number(match[2])].path;
            if (match[1] === "attempt") attempted.push(path);
            else if (match[1] === "written") written.push(path);
            else unchanged.push(path);
          }
          if (result.code !== 0 || result.stopped)
            throw new NpSiteBuildRepositoryPublicationErrorV1(
              result.stopped ? "unavailable" : "conflict",
              attempted.length || result.stopped
                ? "partial-changes-may-remain"
                : "preflight-rejected",
              ordered(new Set(written)),
              ordered(new Set(unchanged)),
              ordered(new Set(attempted.filter((p) => !written.includes(p)))),
            );
          if (
            written.length + unchanged.length !== rows.length ||
            new Set([...written, ...unchanged]).size !== rows.length
          )
            throw new SiteBuildError("unavailable");
          const final = await readSiteSourceTreeV1(project),
            observed = new Map(final.manifest.files.map((f) => [f.path, f]));
          for (const row of rows) {
            const file = observed.get(row.path);
            if (!file || file.digest !== row.contentHash || file.mode !== row.mode)
              throw new SiteBuildError("conflict");
          }
          if ((await readSiteSourceTreeV1(candidate)).digest !== candidateTreeDigest)
            throw new SiteBuildError("conflict");
          return {
            scope: "repository-file-plan-publication",
            status: written.length ? "written" : "unchanged",
            writtenPaths: written,
            unchangedPaths: unchanged,
            treeDigest: final.digest,
          };
        } catch (error) {
          invalid = true;
          if (error instanceof NpSiteBuildRepositoryPublicationErrorV1) throw error;
          throw new NpSiteBuildRepositoryPublicationErrorV1(
            error instanceof SiteBuildError && error.reason === "conflict"
              ? "conflict"
              : "unavailable",
            entered ? "partial-changes-may-remain" : "preflight-rejected",
            ordered(new Set(written)),
            ordered(new Set(unchanged)),
            entered ? ordered(new Set(rows.map((row) => row.path))) : [],
          );
        } finally {
          running = false;
        }
      },
      async close() {
        if (closed) return;
        if (running) throw new SiteBuildError("conflict");
        running = true;
        try {
          await rm(root, { recursive: true, force: true });
          closed = true;
        } finally {
          running = false;
        }
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("unavailable");
  }
}
