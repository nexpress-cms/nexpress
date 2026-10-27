import { randomUUID } from "node:crypto";
import { npParseBuildJsonV1 } from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  runSiteBuildDockerV1,
  withSiteBuildDockerV1,
  siteBuildReadOnlyImageDataArgsV1,
} from "./docker-host.js";

export interface NpSiteBuildLinuxImageEnvironmentObservationV1 {
  schemaVersion: "np.site-build-linux-environment-observation.v1";
  imageId: string;
  architecture: "arm64" | "x64";
  kernel: { release: string; version: string };
  node: { version: string; sha256: string };
  browser: { version: string; sha256: string };
  postgres: { version: string; sha256: string };
  fonts: Array<{ path: string; sha256: string }>;
  fontconfigSha256: string;
  scope: "environment-observation-only";
}

/** Fixed image observer only. It neither launches a site nor proves its runtime sandbox. */
export const NP_SITE_BUILD_LINUX_ENVIRONMENT_WORKER_V1 = String.raw`
(async () => {
  const {createHash} = require('node:crypto');
  const {constants} = require('node:fs');
  const {lstat,open,opendir} = require('node:fs/promises');
  const {spawnSync} = require('node:child_process');
  if(process.platform !== 'linux' || !['arm64','x64'].includes(process.arch) ||
     process.execPath !== '/usr/local/bin/node' || !constants.O_NOFOLLOW) throw new Error();
  const limit = 512 * 1024 * 1024;
  const fixed = ['/usr/local/bin/node','/opt/np/chromium/chrome','/usr/lib/postgresql/16/bin/postgres'];
  const same = (a,b) => ['dev','ino','size','mode','nlink','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
  const pathOK = path => typeof path === 'string' && path.length <= 512 && path.startsWith('/') &&
    !path.includes(String.fromCharCode(92)) && path.slice(1).split('/').every(part => part && part !== '.' && part !== '..' &&
      !Array.from(part).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
  const directories = new Map();
  const ancestors = async path => {
    if(!pathOK(path)) throw new Error();
    const parts = path.split('/');
    let current = '';
    for(const part of parts.slice(1,-1)) {
      current += '/' + part;
      const stat = await lstat(current,{bigint:true});
      if(!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      const previous = directories.get(current);
      if(previous && !same(previous,stat)) throw new Error();
      directories.set(current,stat);
    }
  };
  const read = async (path,max,hash,proc=false) => {
    await ancestors(path);
    const expected = await lstat(path,{bigint:true});
    if(!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1n ||
      expected.size < 0n || expected.size > BigInt(max)) throw new Error();
    const file = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat({bigint:true});
      if(!same(before,expected)) throw new Error();
      const buffer = Buffer.alloc(64 * 1024);
      const digest = hash ? createHash('sha256') : null;
      const chunks = [];
      let total = 0;
      while(true) {
        const result = await file.read(buffer,0,Math.min(buffer.length,max + 1 - total),total);
        if(!result.bytesRead) break;
        total += result.bytesRead;
        if(total > max) throw new Error();
        if(digest) digest.update(buffer.subarray(0,result.bytesRead));
        else chunks.push(Buffer.from(buffer.subarray(0,result.bytesRead)));
      }
      if((!proc && BigInt(total) !== before.size) || !same(before,await file.stat({bigint:true})) ||
        !same(before,await lstat(path,{bigint:true}))) throw new Error();
      return {value:digest ? digest.digest('hex') : new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),bytes:total};
    } finally {await file.close();}
  };
  const line = text => {
    const value = text.replace(/\r?\n$/u,'');
    if(!value || value.length > 4096 || Array.from(value).some(character =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126)) throw new Error();
    return value;
  };
  const version = executable => {
    const result = spawnSync(executable,['--version'],{cwd:'/',shell:false,timeout:5000,maxBuffer:8192,
      env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/nonexistent',LANG:'C',TZ:'UTC'},encoding:'utf8'});
    if(result.error || result.signal || result.status !== 0 || result.stderr) throw new Error();
    return line(result.stdout);
  };
  const binaries = [];
  for(const path of fixed) binaries.push((await read(path,limit,true)).value);
  const browserText = version(fixed[1]);
  const browserVersion = /(?:^| )(\d+\.\d+\.\d+\.\d+)(?: |$)/u.exec(browserText)?.[1];
  if(!browserVersion) throw new Error();
  const postgresVersion = version(fixed[2]);
  const fontconfigSha256 = (await read('/etc/fonts/fonts.conf',1024 * 1024,true)).value;
  const fonts = [];
  let fontBytes = 0, entries = 0;
  const walk = async path => {
    await ancestors(path + '/entry');
    const before = await lstat(path,{bigint:true});
    if(!before.isDirectory() || before.isSymbolicLink()) throw new Error();
    const directory = await opendir(path);
    for await(const entry of directory) {
      if(++entries > 10000 || !pathOK(path + '/' + entry.name)) throw new Error();
      const child = path + '/' + entry.name;
      const stat = await lstat(child,{bigint:true});
      if(stat.isSymbolicLink()) throw new Error();
      if(stat.isDirectory()) await walk(child);
      else if(!stat.isFile()) throw new Error();
      else if(/\.(?:ttf|otf|ttc)$/iu.test(entry.name)) {
        if(fonts.length >= 100 || stat.size < 1n || stat.size > BigInt(limit - fontBytes)) throw new Error();
        const observed = await read(child,limit - fontBytes,true);
        fontBytes += observed.bytes;
        fonts.push({path:child.slice(1),sha256:observed.value});
      }
    }
    if(!same(before,await lstat(path,{bigint:true}))) throw new Error();
  };
  await walk('/usr/share/fonts');
  if(!fonts.length) throw new Error();
  fonts.sort((a,b) => Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  const release = line((await read('/proc/sys/kernel/osrelease',4096,false,true)).value);
  const kernelVersion = line((await read('/proc/sys/kernel/version',4096,false,true)).value);
  for(const [path,stat] of directories) if(!same(stat,await lstat(path,{bigint:true}))) throw new Error();
  process.stdout.write(JSON.stringify({architecture:process.arch,kernel:{release,version:kernelVersion},
    node:{version:process.version,sha256:binaries[0]},browser:{version:browserVersion,sha256:binaries[1]},
    postgres:{version:postgresVersion,sha256:binaries[2]},fonts,fontconfigSha256}) + '\n');
})().catch(() => {process.exitCode = 1;});
`;

function observedBody(
  bytes: Uint8Array,
): Omit<NpSiteBuildLinuxImageEnvironmentObservationV1, "schemaVersion" | "imageId" | "scope"> {
  const fail = (): never => {
    throw new SiteBuildError("unavailable");
  };
  if (!bytes.length || bytes.length > 128 * 1024) return fail();
  const value: unknown = npParseBuildJsonV1(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const record = (input: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== keys.length ||
      Object.keys(input).some((key) => !keys.includes(key))
    )
      return fail();
    return input as Record<string, unknown>;
  };
  const text = (input: unknown, max: number): string => {
    if (
      typeof input !== "string" ||
      !input.length ||
      input.length > max ||
      Array.from(input).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126,
      )
    )
      return fail();
    return input;
  };
  const sha = (input: unknown): string => {
    if (typeof input !== "string" || !/^[a-f0-9]{64}$/u.test(input)) return fail();
    return input;
  };
  const body = record(value, [
    "architecture",
    "kernel",
    "node",
    "browser",
    "postgres",
    "fonts",
    "fontconfigSha256",
  ]);
  if (body.architecture !== "arm64" && body.architecture !== "x64") return fail();
  const kernel = record(body.kernel, ["release", "version"]);
  const binary = (input: unknown, versionPattern: RegExp) => {
    const result = record(input, ["version", "sha256"]);
    const version = text(result.version, 4096);
    if (!versionPattern.test(version)) return fail();
    return { version, sha256: sha(result.sha256) };
  };
  if (!Array.isArray(body.fonts) || !body.fonts.length || body.fonts.length > 100) return fail();
  let previous = "";
  const fonts = body.fonts.map((input: unknown) => {
    const font = record(input, ["path", "sha256"]);
    if (
      typeof font.path !== "string" ||
      font.path.length > 512 ||
      !font.path.startsWith("usr/share/fonts/") ||
      font.path.includes("\\") ||
      !/\.(?:ttf|otf|ttc)$/iu.test(font.path) ||
      font.path
        .split("/")
        .some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            Array.from(part).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ),
        ) ||
      (previous && Buffer.compare(Buffer.from(previous), Buffer.from(font.path)) >= 0)
    )
      return fail();
    previous = font.path;
    return { path: font.path, sha256: sha(font.sha256) };
  });
  return {
    architecture: body.architecture,
    kernel: { release: text(kernel.release, 4096), version: text(kernel.version, 4096) },
    node: binary(body.node, /^v\d+\.\d+\.\d+$/u),
    browser: binary(body.browser, /^\d+\.\d+\.\d+\.\d+$/u),
    postgres: binary(body.postgres, /^postgres \(PostgreSQL\) [\x20-\x7e]+$/u),
    fonts,
    fontconfigSha256: sha(body.fontconfigSha256),
  };
}

/** Caller brands the final image separately. This returns observed environment facts only. */
export async function observeSiteBuildLinuxImageEnvironmentV1(
  imageId: string,
): Promise<NpSiteBuildLinuxImageEnvironmentObservationV1> {
  try {
    if (typeof imageId !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(imageId))
      throw new SiteBuildError("unavailable");
    return await withSiteBuildDockerV1(async (host) => {
      const name = `np-linux-environment-${randomUUID()}`;
      let result: Awaited<ReturnType<typeof runSiteBuildDockerV1>>;
      let cleanupCode: number;
      try {
        result = await runSiteBuildDockerV1(
          host,
          [
            "run",
            "--pull=never",
            "--name",
            name,
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=64",
            "--memory=512m",
            "--memory-swap=512m",
            "--cpus=1",
            "--user=1000:1000",
            "--workdir=/",
            "--env",
            "NODE_OPTIONS=",
            "--env",
            "NODE_PATH=",
            "--env",
            "LD_PRELOAD=",
            "--env",
            "LD_LIBRARY_PATH=",
            ...siteBuildReadOnlyImageDataArgsV1(host),
            "--entrypoint",
            "/usr/local/bin/node",
            imageId,
            "--no-warnings",
            "--eval",
            NP_SITE_BUILD_LINUX_ENVIRONMENT_WORKER_V1,
          ],
          { timeoutMs: 60000, bytes: 128 * 1024 },
        );
      } finally {
        const cleanup = await runSiteBuildDockerV1(host, ["rm", "--force", "--volumes", name], {
          timeoutMs: 15000,
          bytes: 4096,
        });
        cleanupCode = cleanup.code;
      }
      if (cleanupCode !== 0 || result.code !== 0 || result.stderr.length)
        throw new SiteBuildError("unavailable");
      return {
        schemaVersion: "np.site-build-linux-environment-observation.v1",
        imageId,
        ...observedBody(result.stdout),
        scope: "environment-observation-only",
      };
    });
  } catch {
    throw new SiteBuildError("unavailable");
  }
}
