import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createSiteNodeSandboxPolicyV1, siteNodeSandboxEnvironmentV1 } from "./sandbox-policy.js";

it("enforces the observed macOS file/loopback policy or fails closed on an unsupported OS", async () => {
  if (process.platform !== "darwin") {
    expect(() =>
      createSiteNodeSandboxPolicyV1({
        sourceRoot: "/tmp/source",
        outputRoot: "/tmp/output",
        nodeExecutable: process.execPath,
        loopbackPorts: [],
      }),
    ).toThrow("unavailable");
    return;
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-site-sandbox-")));
  const source = join(root, "source"),
    output = join(root, "output");
  const servers: Server[] = [];
  const serve = (message: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const server = createServer((_request, response) => response.end(message));
      servers.push(server);
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Missing controlled server port"));
          return;
        }
        resolve(address.port);
      });
    });
  try {
    await mkdir(source);
    await mkdir(output);
    await mkdir(join(source, ".aws"));
    await writeFile(join(source, "public.txt"), "synthetic public data");
    await writeFile(join(source, ".env.local"), "synthetic forbidden environment");
    await writeFile(join(source, ".pnpmfile.cjs"), "synthetic forbidden package hook credential");
    await writeFile(join(source, ".aws/credentials"), "synthetic forbidden credential");
    await writeFile(join(root, "unmounted.txt"), "synthetic unmounted data");
    const allowedPort = await serve("allowed"),
      deniedPort = await serve("denied");
    const node = await realpath(process.execPath);
    const profile = createSiteNodeSandboxPolicyV1({
      sourceRoot: source,
      outputRoot: output,
      nodeExecutable: node,
      loopbackPorts: [allowedPort],
      denyFork: true,
    });
    await writeFile(join(root, "profile.sb"), profile, { mode: 0o600 });
    const program = `import fs from 'node:fs'; import http from 'node:http'; import { spawnSync } from 'node:child_process';
      const result = {};
      result.public = fs.readFileSync(${JSON.stringify(join(source, "public.txt"))}, 'utf8');
      const denyRead = path => { try { fs.readFileSync(path); return false; } catch (error) { return ['EPERM','EACCES'].includes(error.code); } };
      result.envDenied = denyRead(${JSON.stringify(join(source, ".env.local"))});
      result.pnpmHookDenied = denyRead(${JSON.stringify(join(source, ".pnpmfile.cjs"))});
      result.credentialDenied = denyRead(${JSON.stringify(join(source, ".aws/credentials"))});
      result.unmountedDenied = denyRead(${JSON.stringify(join(root, "unmounted.txt"))});
      try { fs.linkSync(${JSON.stringify(join(source, "public.txt"))}, ${JSON.stringify(join(output, "alias.txt"))}); result.linkDenied = false; }
      catch (error) { result.linkDenied = ['EPERM','EACCES'].includes(error.code); }
      try { fs.writeFileSync(${JSON.stringify(join(source, "unplanned.txt"))}, 'unplanned'); result.readOnly = false; }
      catch (error) { result.readOnly = ['EPERM','EACCES'].includes(error.code); }
      fs.writeFileSync(${JSON.stringify(join(output, "result.txt"))}, 'synthetic output');
      try { fs.writeFileSync(${JSON.stringify(join(output, ".env"))}, 'forbidden output'); result.envWriteDenied = false; }
      catch (error) { result.envWriteDenied = ['EPERM','EACCES'].includes(error.code); }
      const get = port => new Promise(resolve => {
        const request = http.get({host:'127.0.0.1',port,path:'/'}, response => { let body=''; response.on('data',chunk=>body+=chunk); response.on('end',()=>resolve(body)); });
        request.once('error',error=>resolve(error.code)); request.setTimeout(1000,()=>{request.destroy();resolve('TIMEOUT');});
      });
      result.allowed = await get(${allowedPort}); result.denied = await get(${deniedPort});
      result.clean = process.env.HOME === undefined && process.env.OPENAI_API_KEY === undefined && process.env.NODE_OPTIONS === undefined;
      result.forkDenied = ['EPERM','EACCES'].includes(spawnSync(process.execPath, ['-e','process.exit(0)']).error?.code);
      try { process.kill(process.ppid, 0); result.externalSignalDenied = false; }
      catch (error) { result.externalSignalDenied = ['EPERM','EACCES'].includes(error.code); }
      console.log(JSON.stringify(result));`;
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-f", join(root, "profile.sb"), node, "--input-type=module", "-e", program],
      { cwd: output, env: siteNodeSandboxEnvironmentV1(output), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
      if (stdout.length > 64 * 1024) child.kill("SIGKILL");
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
      if (stderr.length > 64 * 1024) child.kill("SIGKILL");
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
    let exit: { code: number | null; signal: NodeJS.Signals | null };
    try {
      exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
    } finally {
      clearTimeout(deadline);
    }
    expect(exit, stderr).toEqual({ code: 0, signal: null });
    expect(JSON.parse(stdout)).toEqual({
      public: "synthetic public data",
      envDenied: true,
      pnpmHookDenied: true,
      credentialDenied: true,
      unmountedDenied: true,
      linkDenied: true,
      readOnly: true,
      allowed: "allowed",
      denied: "EPERM",
      clean: true,
      forkDenied: true,
      externalSignalDenied: true,
      envWriteDenied: true,
    });
    expect(await readFile(join(output, "result.txt"), "utf8")).toBe("synthetic output");
  } finally {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    await rm(root, { force: true, recursive: true });
  }
}, 10_000);
