import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SiteBuildError } from "./artifact-io.js";

export interface NpSiteBuildDockerHostV1 {
  endpoint: string;
  config: string;
  /** Owned empty directory mounted read-only over the inherited PostgreSQL image VOLUME. */
  readOnlyData: string;
}
export function siteBuildReadOnlyImageDataArgsV1(host: NpSiteBuildDockerHostV1): string[] {
  if (!host.readOnlyData?.startsWith("/") || /[,\r\n]/u.test(host.readOnlyData))
    throw new SiteBuildError("unavailable");
  return ["--mount", `type=bind,src=${host.readOnlyData},dst=/var/lib/postgresql/data,readonly`];
}
const path = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";

/** Private byte transport. No shell, remote daemon, inherited environment or registry credentials. */
export async function runSiteBuildDockerV1(
  host: NpSiteBuildDockerHostV1,
  args: readonly string[],
  limits: { timeoutMs: number; bytes: number },
): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  if (!/^unix:\/\/\//u.test(host.endpoint)) throw new SiteBuildError("unavailable");
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["--host", host.endpoint, ...args], {
      env: {
        PATH: path,
        HOME: host.config,
        DOCKER_CONFIG: host.config,
        DOCKER_BUILDKIT: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let bytes = 0,
      stopped = false;
    const stop = () => {
      stopped = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const collect = (target: Buffer[]) => (value: Buffer) => {
      bytes += value.length;
      if (bytes > limits.bytes) stop();
      else target.push(value);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(stop, limits.timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (stopped || signal !== null || code === null) reject(new SiteBuildError("unavailable"));
      else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export async function withSiteBuildDockerV1<T>(
  run: (host: NpSiteBuildDockerHostV1) => Promise<T>,
): Promise<T> {
  // The sole use of the user's context is a read-only endpoint lookup. All subsequent
  // requests use an empty private config and a local Unix socket explicitly.
  const endpoint = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "docker",
      ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      {
        env: {
          PATH: path,
          ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
          ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {}),
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (value: Buffer) => {
      output += value.toString("utf8");
      if (output.length > 4096) child.kill("SIGKILL");
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new SiteBuildError("unavailable"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const value = output.trim();
      if (
        code !== 0 ||
        signal !== null ||
        !value.startsWith("unix:///") ||
        value.length > 2048 ||
        Array.from(value).some(
          (character) => character.charCodeAt(0) <= 32 || "?%#".includes(character),
        )
      )
        reject(new SiteBuildError("unavailable"));
      else resolve(value);
    });
  });
  const root = await mkdtemp(join(tmpdir(), "np-build-docker-"));
  try {
    const config = join(root, "config"),
      readOnlyData = join(root, "empty-image-data");
    await mkdir(config, { mode: 0o700 });
    await mkdir(readOnlyData, { mode: 0o500 });
    return await run({
      endpoint: `unix://${await realpath(endpoint.slice(7))}`,
      config,
      readOnlyData,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
