import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export interface NpSiteBuildRepositoryEditPlanInputV1 {
  scope: "private-build-copy";
  project: string;
  blueprint: unknown;
  baseline: NpAgentBuildSourceTreeV1;
  /** Observed by the caller; this owner never invokes Git. */
  dirtyPaths: readonly string[];
}
export interface NpSiteBuildRepositoryEditPlanReceiptV1 {
  scope: "private-build-copy";
  blueprintHash: string;
  baselineTreeDigest: string;
  privateBaselineTreeDigest: string;
  /** Dirty source paths copied byte-for-byte; omitted credential paths remain only in the original. */
  preservedDirtyPaths: string[];
  omittedPaths: string[];
  deferredCommandPaths: string[];
  files: Array<{
    path: string;
    action: "create" | "update";
    expectedHash: string | null;
    contentHash: string;
    mode: "100644" | "100755";
    stagedArtifactPath: string;
  }>;
}
export interface NpSiteBuildPrivateRepositoryEditPlanV1 {
  scope: "private-build-copy";
  /** A new, owned source copy. No node_modules, environment, or agent configuration is copied. */
  project: string;
  receipt: NpSiteBuildRepositoryEditPlanReceiptV1;
  apply(): Promise<{
    scope: "private-build-copy";
    status: "written" | "unchanged";
    paths: string[];
    deferredCommandPaths: string[];
    treeDigest: string;
  }>;
  assertOriginalUnchanged(): Promise<void>;
  close(): Promise<void>;
}

/** A failed apply invalidates its partial private copy. Close/discard it; the original is never written. */
export class NpSiteBuildPrivateRepositoryEditErrorV1 extends SiteBuildError {
  readonly scope = "private-build-copy";
  readonly privateCopyState = "partial-changes-may-remain";
}

// Node has no openat API; /dev/fd directory children are unavailable on macOS.
// This fixed adapter only captures original bytes and edits the newly owned private copy.
// Directory and file leases detect replacement. They do not promise atomic CAS against
// another process running as the same OS principal; failed private copies must be discarded.
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
#ifndef O_NOFOLLOW
#error O_NOFOLLOW required
#endif
#ifndef AT_SYMLINK_NOFOLLOW
#error AT_SYMLINK_NOFOLLOW required
#endif
#define MAXF 2500
#define MAXD 4096
#define MAXB (64LL*1024*1024)
#define TOTALB (512LL*1024*1024)
typedef struct {int fd,parent;char name[256];struct stat identity;} Dir;
typedef struct {char path[513];uint32_t mode,copy;struct stat identity;} Input;
typedef struct {char path[513];uint32_t old,new,mode,write;int fd,parent,state;char leaf[256];struct stat identity;} Edit;
static Dir dirs[MAXD];static int nd=0;static Input inputs[MAXF];static int ni=0;static Edit edits[500];static int ne=0;
static int dirsame(const struct stat*a,const struct stat*b){return a->st_dev==b->st_dev&&a->st_ino==b->st_ino&&a->st_mode==b->st_mode;}
static int same(const struct stat*a,const struct stat*b){
 if(!dirsame(a,b)||a->st_nlink!=b->st_nlink||a->st_size!=b->st_size)return 0;
#ifdef __APPLE__
 return a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec&&a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec&&a->st_ctimespec.tv_sec==b->st_ctimespec.tv_sec&&a->st_ctimespec.tv_nsec==b->st_ctimespec.tv_nsec;
#else
 return a->st_mtim.tv_sec==b->st_mtim.tv_sec&&a->st_mtim.tv_nsec==b->st_mtim.tv_nsec&&a->st_ctim.tv_sec==b->st_ctim.tv_sec&&a->st_ctim.tv_nsec==b->st_ctim.tv_nsec;
#endif
}
static int regular(int fd,struct stat*s){return fstat(fd,s)||!S_ISREG(s->st_mode)||s->st_nlink!=1||s->st_size<0||s->st_size>MAXB?-1:0;}
static int checkdirs(void){for(int i=0;i<nd;i++){struct stat s;if(fstat(dirs[i].fd,&s)||!dirsame(&s,&dirs[i].identity))return -1;if(dirs[i].parent>=0&&(fstatat(dirs[dirs[i].parent].fd,dirs[i].name,&s,AT_SYMLINK_NOFOLLOW)||!dirsame(&s,&dirs[i].identity)))return -1;}return 0;}
static int enter(int parent,const char*name,int create){
 for(int i=0;i<nd;i++)if(dirs[i].parent==parent&&!strcmp(dirs[i].name,name))return checkdirs()?-1:i;
 if(nd>=MAXD||!name[0]||strlen(name)>255||!strcmp(name,".")||!strcmp(name,"..")||checkdirs())return -1;
 int fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);
 if(fd<0&&errno==ENOENT&&create){if(mkdirat(dirs[parent].fd,name,0700)&&errno!=EEXIST)return -1;fd=openat(dirs[parent].fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK);}
 if(fd<0)return -1;struct stat s,at;if(fstat(fd,&s)||!S_ISDIR(s.st_mode)||fstatat(dirs[parent].fd,name,&at,AT_SYMLINK_NOFOLLOW)||!dirsame(&s,&at)){close(fd);return -1;}
 int id=nd++;dirs[id].fd=fd;dirs[id].parent=parent;strcpy(dirs[id].name,name);dirs[id].identity=s;return checkdirs()?-1:id;
}
static int absolute(const char*path){
 if(path[0]!='/'||strlen(path)>=PATH_MAX)return -1;int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0||nd>=MAXD)return -1;
 int id=nd++;dirs[id].fd=fd;dirs[id].parent=-1;dirs[id].name[0]=0;if(fstat(fd,&dirs[id].identity))return -1;
 char copy[PATH_MAX];strcpy(copy,path);char*save=NULL,*part=strtok_r(copy,"/",&save);while(part){id=enter(id,part,0);if(id<0)return -1;part=strtok_r(NULL,"/",&save);}return id;
}
static int parentof(int root,const char*path,char*leaf,int create){
 char copy[513];if(!path[0]||strlen(path)>512)return -1;strcpy(copy,path);char*last=strrchr(copy,'/');if(!last){strcpy(leaf,copy);return root;}if(strlen(last+1)>255)return -1;strcpy(leaf,last+1);*last=0;
 char*save=NULL,*part=strtok_r(copy,"/",&save);int id=root;while(part){id=enter(id,part,create);if(id<0)return -1;part=strtok_r(NULL,"/",&save);}return id;
}
static int pathfile(int root,const char*path,int flags,int*parent,char*leaf){*parent=parentof(root,path,leaf,0);if(*parent<0)return -1;return openat(dirs[*parent].fd,leaf,flags|O_NOFOLLOW|O_NONBLOCK,0600);}
static int u32(FILE*f,uint32_t*out){unsigned char b[4];if(fread(b,1,4,f)!=4)return -1;*out=((uint32_t)b[0]<<24)|((uint32_t)b[1]<<16)|((uint32_t)b[2]<<8)|b[3];return 0;}
static int pathread(FILE*f,char*out){uint32_t n;if(u32(f,&n)||n<1||n>512||fread(out,1,n,f)!=n||memchr(out,0,n))return -1;out[n]=0;return 0;}
static int frame(int workspace,int apply){
 int fd=openat(dirs[workspace].fd,apply?"apply.bin":"capture.bin",O_RDONLY|O_NOFOLLOW|O_NONBLOCK);struct stat s;if(fd<0||regular(fd,&s))return -1;FILE*f=fdopen(fd,"rb");char magic[8];uint32_t count;int result=-1;
 if(!f||fread(magic,1,8,f)!=8||memcmp(magic,apply?"NPEDAP01":"NPEDCP01",8)||u32(f,&count)||count>(apply?500:MAXF))goto done;
 if(apply){ne=(int)count;for(int i=0;i<ne;i++){Edit*e=&edits[i];e->fd=-1;if(u32(f,&e->old)||u32(f,&e->new)||u32(f,&e->mode)||u32(f,&e->write)||pathread(f,e->path)||e->new>=MAXF||(e->old!=UINT32_MAX&&e->old>=MAXF)||(e->mode!=0644&&e->mode!=0755)||e->write>1)goto done;}}
 else{ni=(int)count;for(int i=0;i<ni;i++)if(u32(f,&inputs[i].mode)||u32(f,&inputs[i].copy)||pathread(f,inputs[i].path)||inputs[i].copy>1||(inputs[i].mode!=0&&inputs[i].mode!=0644&&inputs[i].mode!=0755))goto done;}
 if(fgetc(f)!=EOF)goto done;result=0;
done:if(f)fclose(f);else close(fd);return result;
}
static int copybytes(int from,int to,off_t size){char b[65536];for(off_t p=0;p<size;){size_t n=size-p>(off_t)sizeof(b)?sizeof(b):(size_t)(size-p);if(pread(from,b,n,p)!=(ssize_t)n||pwrite(to,b,n,p)!=(ssize_t)n)return -1;p+=n;}return 0;}
static int bytesame(int a,int b,off_t size){char x[65536],y[65536];for(off_t p=0;p<size;){size_t n=size-p>(off_t)sizeof(x)?sizeof(x):(size_t)(size-p);if(pread(a,x,n,p)!=(ssize_t)n||pread(b,y,n,p)!=(ssize_t)n||memcmp(x,y,n))return -1;p+=n;}return 0;}
static int samepath(int parent,const char*leaf,int fd,const struct stat*expected){struct stat s,at;return regular(fd,&s)||!same(&s,expected)||fstatat(dirs[parent].fd,leaf,&at,AT_SYMLINK_NOFOLLOW)||!same(&s,&at)?-1:0;}
static int lease(int workspace,const char*name,int writing,int files){
 int fd=openat(dirs[workspace].fd,name,(writing?O_WRONLY|O_CREAT|O_EXCL:O_RDONLY)|O_NOFOLLOW|O_NONBLOCK,0600);struct stat s;if(fd<0||regular(fd,&s))return -1;FILE*f=fdopen(fd,writing?"wb":"rb");int result=-1;uint32_t count=(uint32_t)nd;
 if(!f)goto done;if(writing){if(fwrite(&count,sizeof(count),1,f)!=1)goto done;for(int i=0;i<nd;i++){if(fwrite(&dirs[i].parent,sizeof(int),1,f)!=1||fwrite(dirs[i].name,256,1,f)!=1||fwrite(&dirs[i].identity,sizeof(struct stat),1,f)!=1)goto done;}if(files&&fwrite(inputs,sizeof(Input),(size_t)ni,f)!=(size_t)ni)goto done;if(fflush(f)||fsync(fd))goto done;}
 else{if(fread(&count,sizeof(count),1,f)!=1||count>MAXD)goto done;for(uint32_t i=0;i<count;i++){int parent;char nameV[256];struct stat identity;if(fread(&parent,sizeof(int),1,f)!=1||fread(nameV,256,1,f)!=1||fread(&identity,sizeof(struct stat),1,f)!=1||!memchr(nameV,0,256))goto done;int id;if(parent<0){id=absolute("/");}else{if(parent>=(int)i)goto done;id=enter(parent,nameV,0);}if(id!=(int)i||!dirsame(&dirs[id].identity,&identity))goto done;}if(files){Input expected;for(int i=0;i<ni;i++){if(fread(&expected,sizeof(Input),1,f)!=1||strcmp(expected.path,inputs[i].path)||expected.mode!=inputs[i].mode||expected.copy!=inputs[i].copy)goto done;inputs[i].identity=expected.identity;}}if(fgetc(f)!=EOF)goto done;}
 result=checkdirs();
done:if(f)fclose(f);else close(fd);return result;
}
static int sourcefiles(int root,int cache,int capture){
 off_t total=0;for(int i=0;i<ni;i++){char leaf[256],number[24];int parent,fd=pathfile(root,inputs[i].path,O_RDONLY,&parent,leaf);struct stat s;if(fd<0||regular(fd,&s))return -1;
 if((inputs[i].mode&&((s.st_mode&0111)?0755:0644)!=inputs[i].mode)||(total+=s.st_size)>TOTALB){close(fd);return -1;}
 if(capture){inputs[i].identity=s;if(inputs[i].copy){snprintf(number,sizeof(number),"%d",i);int out=openat(dirs[cache].fd,number,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0400);if(out<0||copybytes(fd,out,s.st_size)||fsync(out)){close(fd);return -1;}close(out);}}
 if(samepath(parent,leaf,fd,&inputs[i].identity)||checkdirs()){close(fd);return -1;}close(fd);
 }return checkdirs();
}
static int cachefile(int cache,uint32_t index,struct stat*s){char number[24];snprintf(number,sizeof(number),"%u",index);int fd=openat(dirs[cache].fd,number,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(fd<0||regular(fd,s))return -1;return fd;}
static int matches(int fd,const struct stat*s,int cache,uint32_t index,uint32_t mode){struct stat data;int old=cachefile(cache,index,&data);if(old<0)return 0;int result=((s->st_mode&0111)?0755:0644)==mode&&s->st_size==data.st_size&&!bytesame(fd,old,s->st_size);close(old);return result;}
static int preflight(int root,int cache){
 for(int i=0;i<ne;i++){Edit*e=&edits[i];e->parent=parentof(root,e->path,e->leaf,0);e->state=0;if(e->parent<0){if(errno==ENOENT&&e->old==UINT32_MAX&&e->write)continue;return -1;}e->fd=openat(dirs[e->parent].fd,e->leaf,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);
 if(e->fd<0){if(errno==ENOENT&&e->old==UINT32_MAX&&e->write)continue;return -1;}if(regular(e->fd,&e->identity))return -1;
 if(matches(e->fd,&e->identity,cache,e->new,e->mode)){e->state=1;continue;}
 if(!e->write||e->old==UINT32_MAX||!matches(e->fd,&e->identity,cache,e->old,e->mode))return -1;e->state=2;
 }return checkdirs();
}
static int checkedits(void){if(checkdirs())return -1;for(int i=0;i<ne;i++)if(edits[i].fd>=0&&samepath(edits[i].parent,edits[i].leaf,edits[i].fd,&edits[i].identity))return -1;return 0;}
static int apply(int root,int cache){
 if(preflight(root,cache))return -1;int changed=0;
 for(int i=0;i<ne;i++){Edit*e=&edits[i];if(e->state==1)continue;if(checkedits())return -1;struct stat payload;int data=cachefile(cache,e->new,&payload);if(data<0)return -1;
 int parent=parentof(root,e->path,e->leaf,1);if(parent<0||checkdirs()){close(data);return -1;}int target;
 if(e->state==0){target=openat(dirs[parent].fd,e->leaf,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK,e->mode);if(target<0){close(data);return -1;}e->parent=parent;}
 else{target=openat(dirs[parent].fd,e->leaf,O_RDWR|O_NOFOLLOW|O_NONBLOCK);if(target<0||samepath(parent,e->leaf,target,&e->identity)){close(data);return -1;}close(e->fd);}
 e->fd=target;if(copybytes(data,target,payload.st_size)||ftruncate(target,payload.st_size)||fchmod(target,e->mode)||fsync(target)||regular(target,&e->identity)||e->identity.st_size!=payload.st_size||bytesame(target,data,payload.st_size)||samepath(parent,e->leaf,target,&e->identity)||fsync(dirs[parent].fd)||checkedits()){close(data);return -1;}close(data);e->state=1;changed=1;
 }return changed;
}
int main(int argc,char**argv){
 if(argc!=4)return 3;int mode=!strcmp(argv[1],"capture")?0:!strcmp(argv[1],"check")?1:!strcmp(argv[1],"snapshot")?2:!strcmp(argv[1],"apply")?3:-1;if(mode<0)return 3;
 int result=2,applied=0,workspace=absolute(argv[3]);if(workspace<0)goto done;int cache=enter(workspace,"inputs",0);if(cache<0||frame(workspace,mode==3))goto done;
 if(mode==3){struct stat s;if(!fstatat(dirs[workspace].fd,"applied.lease",&s,AT_SYMLINK_NOFOLLOW)){if(!S_ISREG(s.st_mode)||s.st_nlink!=1)goto done;applied=1;}else if(errno!=ENOENT)goto done;}
 if(mode==1||mode==3){/* Rebuild in exactly the captured order, starting with the private workspace. */
  for(int i=nd-1;i>=0;i--)close(dirs[i].fd);nd=0;int fd=open(argv[3],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(fd<0)goto done;
  /* The lease reader uses this temporary FD while reconstructing all directory leases. */
  Dir saved;memset(&saved,0,sizeof(saved));saved.fd=fd;dirs[MAXD-1]=saved;
  if(lease(MAXD-1,mode==1?"original.lease":applied?"applied.lease":"private.lease",0,mode==1)){close(fd);goto done;}close(fd);
  workspace=absolute(argv[3]);cache=enter(workspace,"inputs",0);if(workspace<0||cache<0)goto done;
 }
 int root=absolute(argv[2]);if(root<0)goto done;
 if(mode==0){if(sourcefiles(root,cache,1)||sourcefiles(root,cache,0)||lease(workspace,"original.lease",1,1))goto done;}
 else if(mode==1){if(sourcefiles(root,cache,0))goto done;}
 else if(mode==2){if(sourcefiles(root,cache,1)||lease(workspace,"private.lease",1,0))goto done;}
 else{int changed=apply(root,cache);if(changed<0||(!applied&&lease(workspace,"applied.lease",1,0)))goto done;puts(changed?"written":"unchanged");}
 result=0;
done:for(int i=0;i<ne;i++)if(edits[i].fd>=0)close(edits[i].fd);for(int i=nd-1;i>=0;i--)close(dirs[i].fd);return result;
}
`;

const zero = `nb1:file-sha256:${"A".repeat(43)}`;
const omitted = (path: string) =>
  path
    .split("/")
    .some((part) =>
      /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pnpmfile\..*|\.aws|\.ssh|\.codex|\.claude|\.agents|\.nexpress|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx))$/iu.test(
        part,
      ),
    );
const ordered = (paths: Iterable<string>) =>
  [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
function portable(path: unknown, artifact = false): string {
  if (
    typeof path !== "string" ||
    Buffer.byteLength(path) > 512 ||
    path.split("/").some((part) => Buffer.byteLength(part) > 255)
  )
    throw new SiteBuildError("path");
  if (!artifact)
    npRequireAgentBuildSourceTreeV1({
      schemaVersion: "np.agent-build-source-tree.v1",
      files: [{ path, kind: "file", mode: "100644", digest: zero }],
    });
  return path;
}
function requireConsistentPathInventory(paths: Iterable<string>): void {
  const names = new Map<string, string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const spelling = parts.slice(0, index).join("/");
      const folded = spelling.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
      const previous = names.get(folded);
      if (previous !== undefined && previous !== spelling) throw new SiteBuildError("path");
      names.set(folded, spelling);
    }
  }
}
function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}
const framedPath = (path: string) => [u32(Buffer.byteLength(path)), Buffer.from(path)];
type Capture = { path: string; mode: number; copy: boolean };
function captureFrame(files: Capture[]) {
  return Buffer.concat([
    Buffer.from("NPEDCP01"),
    u32(files.length),
    ...files.flatMap((file) => [u32(file.mode), u32(Number(file.copy)), ...framedPath(file.path)]),
  ]);
}
async function runFixed(executable: string, args: string[], temporaryRoot: string) {
  return new Promise<{ code: number; stdout: string }>((accept, reject) => {
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
    const timer = setTimeout(stop, 30000);
    child.stdout.on("data", (bytes: Buffer) => {
      total += bytes.length;
      if (total > 65536) stop();
      else stdout += bytes.toString("utf8");
    });
    child.stderr.on("data", (bytes: Buffer) => {
      total += bytes.length;
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
 * Prepare a bounded, credential-free private source copy and bind staged byte inputs.
 * The original repository is never a write destination. Apply is deliberately limited
 * to this owned copy: POSIX does not provide atomic conditional replacement of a live
 * repository file. No command, config, custom hook, schema generation or Git is run.
 * Requires a local cc and POSIX FD operations; unsupported hosts fail closed.
 * At most 2,000 source files plus 500 staged inputs, 64 MiB/file and 512 MiB total.
 */
export async function prepareSiteBuildRepositoryEditPlanV1(
  input: NpSiteBuildRepositoryEditPlanInputV1,
): Promise<NpSiteBuildPrivateRepositoryEditPlanV1> {
  if (
    !input ||
    typeof input !== "object" ||
    types.isProxy(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 5
  )
    throw new SiteBuildError("input");
  const fields = new Map<string, unknown>();
  for (const key of ["scope", "project", "blueprint", "baseline", "dirtyPaths"]) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !("value" in field)) throw new SiteBuildError("input");
    fields.set(key, field.value);
  }
  if (fields.get("scope") !== "private-build-copy") throw new SiteBuildError("input");
  const projectInput = fields.get("project");
  if (
    typeof projectInput !== "string" ||
    projectInput.length > 4096 ||
    projectInput !== resolve(projectInput) ||
    projectInput === "/" ||
    [...projectInput].some((character) => character.charCodeAt(0) < 32)
  )
    throw new SiteBuildError("path");
  const original = projectInput;
  const blueprint = npRequireAgentSiteBlueprintV1(fields.get("blueprint"));
  const baseline = npRequireAgentBuildSourceTreeV1(fields.get("baseline"));
  const dirtyInput = fields.get("dirtyPaths");
  if (
    baseline.files.length > 2000 ||
    !Array.isArray(dirtyInput) ||
    types.isProxy(dirtyInput) ||
    dirtyInput.length > 10000 ||
    Reflect.ownKeys(dirtyInput).length !== dirtyInput.length + 1
  )
    throw new SiteBuildError("input");
  const dirtyValues: string[] = [];
  for (let index = 0; index < dirtyInput.length; index++) {
    const field = Object.getOwnPropertyDescriptor(dirtyInput, String(index));
    if (!field?.enumerable || !("value" in field)) throw new SiteBuildError("input");
    dirtyValues.push(portable(field.value));
  }
  const dirty = ordered(new Set(dirtyValues));
  const source = new Map(
    baseline.files.map((file, index) => [portable(file.path), { ...file, index }]),
  );
  const sourceAndPlan = new Map(baseline.files.map((file) => [file.path, file]));
  for (const row of blueprint.filePlan) {
    portable(row.path);
    if (!sourceAndPlan.has(row.path))
      sourceAndPlan.set(row.path, {
        path: row.path,
        kind: "file",
        mode: "100644",
        digest: row.contentHash,
      });
  }
  npRequireAgentBuildSourceTreeV1({
    schemaVersion: "np.agent-build-source-tree.v1",
    files: [...sourceAndPlan.values()].sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    ),
  });
  requireConsistentPathInventory(sourceAndPlan.keys());
  const baselineTreeDigest = await npBuildCanonicalDigest("np.build-source-tree.v1", baseline);
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const captures: Capture[] = baseline.files.map((file) => ({
    path: file.path,
    mode: file.mode === "100755" ? 0o755 : 0o644,
    copy: !omitted(file.path),
  }));
  const staged = blueprint.filePlan.filter((row) => row.source === "staged");
  const stageIndices = new Map<string, number>();
  for (const row of staged) {
    if (!stageIndices.has(row.stagedArtifactPath)) {
      const path = portable(row.stagedArtifactPath, true);
      stageIndices.set(path, captures.length);
      captures.push({ path, mode: 0, copy: true });
    }
  }
  const edits = staged.map((row) => {
    const old = source.get(row.path);
    if (omitted(row.path) || (old && omitted(old.path))) throw new SiteBuildError("path");
    if (
      row.action === "update"
        ? !old || ![row.expectedHash, row.contentHash].includes(old.digest)
        : old && old.digest !== row.contentHash
    )
      throw new SiteBuildError("conflict");
    const unchanged = old?.digest === row.contentHash;
    const overlapping = dirty.some(
      (path) =>
        path === row.path || path.startsWith(`${row.path}/`) || row.path.startsWith(`${path}/`),
    );
    if (overlapping && !unchanged) throw new SiteBuildError("conflict");
    return {
      ...row,
      oldIndex: old?.index ?? 0xffffffff,
      newIndex: stageIndices.get(row.stagedArtifactPath)!,
      mode: old?.mode ?? "100644",
      write: !overlapping,
    };
  });
  const deferred = blueprint.filePlan.filter((row) => row.source === "command");
  for (const row of deferred) {
    const old = source.get(row.path);
    if (
      row.action === "update"
        ? !old || ![row.expectedHash, row.contentHash].includes(old.digest)
        : old && old.digest !== row.contentHash
    )
      throw new SiteBuildError("conflict");
  }
  if (
    !["darwin", "linux"].includes(process.platform) ||
    !constants.O_NOFOLLOW ||
    !constants.O_DIRECTORY
  )
    throw new SiteBuildError("unavailable");
  if ((await realpath(original)) !== original) throw new SiteBuildError("path");
  const observed = await readSiteSourceTreeV1(original);
  if (observed.digest !== baselineTreeDigest) throw new SiteBuildError("conflict");
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-private-edit-plan-")));
  const project = join(root, "project"),
    executable = join(root, "adapter");
  let closed = false,
    running = false,
    invalid = false;
  const ensureOpen = () => {
    if (closed || running) throw new SiteBuildError("conflict");
  };
  const native = async (mode: string, destination: string) => {
    const result = await runFixed(executable, [mode, destination, root], root);
    if (result.code !== 0) throw new SiteBuildError(result.code === 2 ? "conflict" : "unavailable");
    return result.stdout;
  };
  try {
    await chmod(root, 0o700);
    await mkdir(join(root, "inputs"), { mode: 0o700 });
    await mkdir(project, { mode: 0o700 });
    await writeFile(join(root, "adapter.c"), adapterSource, { flag: "wx", mode: 0o600 });
    const compile = await runFixed(
      "/usr/bin/cc",
      ["-std=c11", "-O2", "-Wall", "-Werror", join(root, "adapter.c"), "-o", executable],
      root,
    );
    if (compile.code !== 0) throw new SiteBuildError("unavailable");
    await writeFile(join(root, "capture.bin"), captureFrame(captures), { flag: "wx", mode: 0o600 });
    await native("capture", original);
    for (const [index, file] of baseline.files.entries()) {
      if (omitted(file.path)) continue;
      const bytes = await readFile(join(root, "inputs", String(index)));
      if ((await npBuildFileDigest("np.build-source-file.v1", bytes)) !== file.digest)
        throw new SiteBuildError("conflict");
      await mkdir(dirname(join(project, file.path)), { recursive: true, mode: 0o700 });
      await writeFile(join(project, file.path), bytes, {
        flag: "wx",
        mode: file.mode === "100755" ? 0o755 : 0o644,
      });
      await chmod(join(project, file.path), file.mode === "100755" ? 0o755 : 0o644);
    }
    for (const edit of edits) {
      const bytes = await readFile(join(root, "inputs", String(edit.newIndex)));
      if ((await npBuildFileDigest("np.build-source-file.v1", bytes)) !== edit.contentHash)
        throw new SiteBuildError("conflict");
    }
    await native("check", original);
    if ((await readSiteSourceTreeV1(original)).digest !== baselineTreeDigest)
      throw new SiteBuildError("conflict");
    const privateBaseline = (await readSiteSourceTreeV1(project)).manifest;
    // Snapshot directory leases in the owned copy, without adding or reading credentials.
    const privateCaptures = privateBaseline.files.map((file) => ({
      path: file.path,
      mode: file.mode === "100755" ? 0o755 : 0o644,
      copy: false,
    }));
    await writeFile(join(root, "capture.bin"), captureFrame(privateCaptures), { mode: 0o400 });
    await native("snapshot", project);
    await writeFile(join(root, "capture.bin"), captureFrame(captures), { mode: 0o400 });
    await writeFile(
      join(root, "apply.bin"),
      Buffer.concat([
        Buffer.from("NPEDAP01"),
        u32(edits.length),
        ...edits.flatMap((edit) => [
          u32(edit.oldIndex),
          u32(edit.newIndex),
          u32(edit.mode === "100755" ? 0o755 : 0o644),
          u32(Number(edit.write)),
          ...framedPath(edit.path),
        ]),
      ]),
      { flag: "wx", mode: 0o400 },
    );
    const receipt: NpSiteBuildRepositoryEditPlanReceiptV1 = {
      scope: "private-build-copy",
      blueprintHash,
      baselineTreeDigest,
      privateBaselineTreeDigest: await npBuildCanonicalDigest(
        "np.build-source-tree.v1",
        privateBaseline,
      ),
      preservedDirtyPaths: dirty.filter((path) => !omitted(path)),
      omittedPaths: baseline.files.filter((file) => omitted(file.path)).map((file) => file.path),
      deferredCommandPaths: deferred.map((file) => file.path),
      files: edits.map(({ path, action, expectedHash, contentHash, mode, stagedArtifactPath }) => ({
        path,
        action,
        expectedHash,
        contentHash,
        mode,
        stagedArtifactPath,
      })),
    };
    return {
      scope: "private-build-copy",
      project,
      receipt: structuredClone(receipt),
      async assertOriginalUnchanged() {
        ensureOpen();
        running = true;
        try {
          await native("check", original);
          if ((await readSiteSourceTreeV1(original)).digest !== baselineTreeDigest)
            throw new SiteBuildError("conflict");
        } finally {
          running = false;
        }
      },
      async apply() {
        ensureOpen();
        if (invalid) throw new NpSiteBuildPrivateRepositoryEditErrorV1("conflict");
        running = true;
        try {
          await native("check", original);
          if ((await readSiteSourceTreeV1(original)).digest !== baselineTreeDigest)
            throw new SiteBuildError("conflict");
          const output = await native("apply", project);
          if (output !== "written\n" && output !== "unchanged\n")
            throw new SiteBuildError("unavailable");
          const final = await readSiteSourceTreeV1(project);
          for (const edit of edits) {
            const found = final.manifest.files.find((file) => file.path === edit.path);
            if (!found || found.digest !== edit.contentHash || found.mode !== edit.mode)
              throw new SiteBuildError("conflict");
          }
          return {
            scope: "private-build-copy",
            status: output === "written\n" ? "written" : "unchanged",
            paths: edits.map((file) => file.path),
            deferredCommandPaths: [...receipt.deferredCommandPaths],
            treeDigest: final.digest,
          };
        } catch (error) {
          invalid = true;
          throw new NpSiteBuildPrivateRepositoryEditErrorV1(
            error instanceof SiteBuildError ? error.reason : "unavailable",
          );
        } finally {
          running = false;
        }
      },
      async close() {
        if (closed) return;
        ensureOpen();
        closed = true;
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("unavailable");
  }
}
