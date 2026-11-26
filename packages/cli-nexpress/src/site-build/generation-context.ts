import { createHash } from "node:crypto";
import { types } from "node:util";
import { SiteBuildError } from "./artifact-io.js";

export interface NpSiteBuildGenerationContextV1 {
  schemaVersion: "np.site-build-generation-context.v1";
  implementation: "np.site-build-generation.v1";
  selectedDirectionHash: string;
  comparisonInputsDigest: string;
  selectedRenderEnvironmentFingerprint: string;
  clock: { now: string; randomSeed: string };
}
/** The root controller must derive these values from the selected observed comparison.
 * Parsing/hashing the descriptor grants no execution, approval, environment or source authority.
 * The enclosing blueprint hash deliberately does not enter generated entropy: that hash
 * already includes the generated file hashes. The execution receipt binds both afterward.
 */
export function requireSiteBuildGenerationContextV1(
  value: unknown,
): NpSiteBuildGenerationContextV1 {
  const record = (input: unknown, keys: string[]): Record<string, unknown> => {
    if (
      !input ||
      typeof input !== "object" ||
      types.isProxy(input) ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      throw new SiteBuildError("input");
    const fields = Object.getOwnPropertyDescriptors(input);
    if (
      Reflect.ownKeys(fields).length !== keys.length ||
      keys.some((key) => !fields[key] || !("value" in fields[key]) || !fields[key].enumerable)
    )
      throw new SiteBuildError("input");
    return Object.fromEntries(keys.map((key) => [key, fields[key].value]));
  };
  const body = record(value, [
    "schemaVersion",
    "implementation",
    "selectedDirectionHash",
    "comparisonInputsDigest",
    "selectedRenderEnvironmentFingerprint",
    "clock",
  ]);
  const clock = record(body.clock, ["now", "randomSeed"]);
  if (
    body.schemaVersion !== "np.site-build-generation-context.v1" ||
    body.implementation !== "np.site-build-generation.v1" ||
    [
      body.selectedDirectionHash,
      body.comparisonInputsDigest,
      body.selectedRenderEnvironmentFingerprint,
    ].some(
      (value) =>
        typeof value !== "string" ||
        !/^nb1:sha256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value),
    ) ||
    typeof clock.now !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(clock.now) ||
    !Number.isFinite(Date.parse(clock.now)) ||
    new Date(clock.now).toISOString() !== clock.now ||
    typeof clock.randomSeed !== "string" ||
    !/^[a-f0-9]{64}$/u.test(clock.randomSeed)
  )
    throw new SiteBuildError("input");
  return {
    schemaVersion: "np.site-build-generation-context.v1",
    implementation: "np.site-build-generation.v1",
    selectedDirectionHash: body.selectedDirectionHash as string,
    comparisonInputsDigest: body.comparisonInputsDigest as string,
    selectedRenderEnvironmentFingerprint: body.selectedRenderEnvironmentFingerprint as string,
    clock: { now: clock.now, randomSeed: clock.randomSeed },
  };
}
export function fingerprintSiteBuildGenerationContextV1(value: unknown): string {
  const context = requireSiteBuildGenerationContextV1(value);
  return `ngc1:sha256:${createHash("sha256").update("np.site-build-generation-context.v1\0").update(JSON.stringify(context)).digest("base64url")}`;
}
export function createSiteBuildGenerationPreloadV1(
  contextValue: unknown,
  command: {
    id: string;
    template: "schema-generate" | "migration-generate";
    name: string | null;
  },
): { source: string; sha256: string } {
  const context = requireSiteBuildGenerationContextV1(contextValue);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(command.id) ||
    (command.template !== "schema-generate" && command.template !== "migration-generate") ||
    (command.template === "schema-generate"
      ? command.name !== null
      : typeof command.name !== "string" || !/^[a-z][a-z0-9_-]{0,511}$/u.test(command.name))
  )
    throw new SiteBuildError("input");
  const source = `const generation=${JSON.stringify({ context, command: { id: command.id, template: command.template, name: command.name } })};\n${NP_SITE_BUILD_GENERATION_PRELOAD_SOURCE_V1}`;
  if (Buffer.byteLength(source) > 64 * 1024) throw new SiteBuildError("input");
  return { source, sha256: createHash("sha256").update(source).digest("hex") };
}

/** Fixed generation-only child preload. Never loaded in the host/app Runtime or a browser.
 * The normal App owner and pnpm keep real clocks; only schema evaluation and actual
 * Drizzle `generate` processes receive controlled time/UUIDs. No output is rewritten.
 */
export const NP_SITE_BUILD_GENERATION_PRELOAD_SOURCE_V1 = String.raw`
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import * as fs from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const fail=()=>{throw new Error('site-build-generation-context')};
const own=pathToFileURL(fileURLToPath(import.meta.url)).href;
const options='--import='+own;
if(process.env.NODE_OPTIONS&&process.env.NODE_OPTIONS!==options)fail();
process.env.NODE_OPTIONS=options;
const root=fs.realpathSync(process.cwd());
const same=(a,b)=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
function journal(){
 const absent={entries:[],next:0,last:null,digest:'absent',snapshot:null};
 for(const directory of [join(root,'drizzle'),join(root,'drizzle/meta')]){let s;try{s=fs.lstatSync(directory);}catch(e){if(e.code==='ENOENT')return absent;throw e;}if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(directory)!==directory)fail();}
 const path=join(root,'drizzle/meta/_journal.json');let h;
 try{h=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return absent;throw e;}
 try{if(fs.realpathSync(dirname(path))!==join(root,'drizzle/meta'))fail();const s=fs.fstatSync(h,{bigint:true});if(!s.isFile()||s.nlink!==1n||s.size<0n||s.size>2097152n)fail();
 const b=Buffer.alloc(Number(s.size)+1);let n=0;for(;;){const r=fs.readSync(h,b,n,b.length-n,n);if(!r)break;n+=r;if(n===b.length)fail();}
 if(n!==Number(s.size)||!same(s,fs.fstatSync(h,{bigint:true}))||!same(s,fs.lstatSync(path,{bigint:true})))fail();
 const data=JSON.parse(b.subarray(0,n).toString('utf8'));
 if(!data||data.version!=='7'||data.dialect!=='postgresql'||!Array.isArray(data.entries)||data.entries.length>10000)fail();
 let last=null;
 for(const [index,row] of data.entries.entries()){
 if(!row||row.idx!==index||row.version!=='7'||typeof row.breakpoints!=='boolean'||!Number.isSafeInteger(row.when)||Math.abs(row.when)>8640000000000000||typeof row.tag!=='string'||!/^[0-9]{4}_[A-Za-z0-9_-]+$/.test(row.tag)||row.tag.slice(0,4)!==String(index).padStart(4,'0')||row.tag.length>255||(last!==null&&row.when<=last))fail();
 last=row.when;}
 if(data.entries.length>=10000)fail();
 let snapshot=null;
 if(data.entries.length){const snapshotPath=join(root,'drizzle/meta',String(data.entries.length-1).padStart(4,'0')+'_snapshot.json');
 const fd=fs.openSync(snapshotPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd,{bigint:true});if(!st.isFile()||st.nlink!==1n||st.size<0n||st.size>67108864n)fail();
 const hash=crypto.createHash('sha256'),block=Buffer.alloc(65536);let read=0;
 while(read<Number(st.size)){const count=fs.readSync(fd,block,0,Math.min(block.length,Number(st.size)-read),read);if(!count)fail();hash.update(block.subarray(0,count));read+=count;}
 if(fs.readSync(fd,block,0,1,read)||!same(st,fs.fstatSync(fd,{bigint:true}))||!same(st,fs.lstatSync(snapshotPath,{bigint:true})))fail();snapshot=hash.digest('hex');
 }finally{fs.closeSync(fd);}}
 return {entries:data.entries,next:data.entries.length,last,digest:crypto.createHash('sha256').update(b.subarray(0,n)).digest('hex'),snapshot};
 }finally{fs.closeSync(h);}}
export function assertSiteBuildGenerationJournalV1(){return journal().entries.length;}
let active=generation.command.template==='schema-generate';
let index=0,name=generation.command.name,when=Date.parse(generation.context.clock.now),history=null;
if(generation.command.template==='migration-generate'){
 let expected,actual;try{expected=fs.realpathSync(join(root,'node_modules/drizzle-kit/bin.cjs'));actual=fs.realpathSync(process.argv[1]);}catch{}
 if(expected&&expected===actual){
  const args=process.argv.slice(2);if(args[0]!=='generate')fail();
  if(args.length===1)name=null;
  else if(args.length===4&&args[1]==='--custom'&&args[2]==='--name'&&/^[a-z][a-z0-9_-]{0,511}$/.test(args[3]))name=args[3];
  else if(args.length===5&&args[1]==='--config'&&args[2]==='drizzle.config.ts'&&args[3]==='--name'&&args[4]===generation.command.name)name=args[4];
  else fail();
  const state=journal();history={journal:state.digest,snapshot:state.snapshot};index=state.next;when=Math.max(when+index,state.last===null?-8640000000000000:state.last+1);active=true;
 }
}
if(active){
 if(!Number.isSafeInteger(when)||Math.abs(when)>8640000000000000)fail();
 const domain=JSON.stringify({implementation:'np.site-build-generation.v1',selectedDirectionHash:generation.context.selectedDirectionHash,
 comparisonInputsDigest:generation.context.comparisonInputsDigest,selectedRenderEnvironmentFingerprint:generation.context.selectedRenderEnvironmentFingerprint,
 clock:generation.context.clock,commandId:generation.command.id,template:generation.command.template,index,name,history});
 const next=(label,count)=>crypto.createHash('sha256').update('np.site-build-generation-entropy.v1\0').update(domain).update('\0'+label+'\0'+count).digest();
 let uuidCount=0,randomCount=0;
 const uuid=()=>{const b=Buffer.from(next('uuid',uuidCount++).subarray(0,16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
 crypto.randomUUID=uuid;
 if(crypto.webcrypto)Object.defineProperty(crypto.webcrypto,'randomUUID',{value:uuid,configurable:true,writable:true});
 syncBuiltinESMExports();
 Math.random=()=>Number(next('math',randomCount++).readBigUInt64BE(0)>>11n)/9007199254740992;
 const OriginalDate=Date;
 globalThis.Date=new Proxy(OriginalDate,{
 apply(){return new OriginalDate(when).toString();},
 construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[when],newTarget);},
 get(target,key,receiver){return key==='now'?()=>when:Reflect.get(target,key,receiver);}
 });
}
`;
