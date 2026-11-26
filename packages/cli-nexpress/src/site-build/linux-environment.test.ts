import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteBuildError } from "./artifact-io.js";
import type * as DockerHostModule from "./docker-host.js";
import {
  NP_SITE_BUILD_LINUX_ENVIRONMENT_WORKER_V1,
  observeSiteBuildLinuxImageEnvironmentV1,
} from "./linux-environment.js";

const docker = vi.hoisted(() => ({ run: vi.fn(), withHost: vi.fn() }));
vi.mock("./docker-host.js", async (original) => ({
  ...(await original<typeof DockerHostModule>()),
  runSiteBuildDockerV1: docker.run,
  withSiteBuildDockerV1: docker.withHost,
}));
const imageId = `sha256:${"a".repeat(64)}`;
const sha = "b".repeat(64);
const body = () => ({
  architecture: "arm64",
  kernel: { release: "6.12.0-linuxkit", version: "#1 SMP PREEMPT fixture" },
  node: { version: "v24.11.1", sha256: sha },
  browser: { version: "141.0.7390.122", sha256: sha },
  postgres: { version: "postgres (PostgreSQL) 16.10 (Debian fixture)", sha256: sha },
  fonts: [{ path: "usr/share/fonts/truetype/fixture.ttf", sha256: sha }],
  fontconfigSha256: sha,
});
beforeEach(() => {
  docker.run.mockReset();
  docker.withHost.mockReset().mockImplementation(async (run: (host: unknown) => Promise<unknown>) =>
    run({
      endpoint: "unix:///fixture.sock",
      config: "/empty-config",
      readOnlyData: "/owned-empty-image-data",
    }),
  );
  docker.run.mockImplementation((_host: unknown, args: string[]) =>
    Promise.resolve({
      code: 0,
      stdout: Buffer.from(args[0] === "run" ? JSON.stringify(body()) : "owned-container\n"),
      stderr: Buffer.alloc(0),
    }),
  );
});

describe("Linux image environment observation transport", () => {
  it("uses one fixed bounded worker with only the owned empty readonly image-volume override", async () => {
    const result = await observeSiteBuildLinuxImageEnvironmentV1(imageId);
    expect(result).toEqual({
      schemaVersion: "np.site-build-linux-environment-observation.v1",
      imageId,
      ...body(),
      scope: "environment-observation-only",
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const [host, args, limits] = docker.run.mock.calls[0];
    expect(host).toEqual({
      endpoint: "unix:///fixture.sock",
      config: "/empty-config",
      readOnlyData: "/owned-empty-image-data",
    });
    for (const flag of [
      "--pull=never",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=64",
      "--memory=512m",
      "--cpus=1",
      "--user=1000:1000",
      "NODE_OPTIONS=",
      "NODE_PATH=",
      "LD_PRELOAD=",
      "LD_LIBRARY_PATH=",
    ])
      expect(args).toContain(flag);
    expect(args.filter((arg: string) => arg === "--mount")).toHaveLength(1);
    expect(args).toContain(
      "type=bind,src=/owned-empty-image-data,dst=/var/lib/postgresql/data,readonly",
    );
    expect(args.slice(-6)).toEqual([
      "--entrypoint",
      "/usr/local/bin/node",
      imageId,
      "--no-warnings",
      "--eval",
      NP_SITE_BUILD_LINUX_ENVIRONMENT_WORKER_V1,
    ]);
    expect(limits).toEqual({ timeoutMs: 60_000, bytes: 128 * 1024 });
    expect(docker.run.mock.calls[1][1]).toEqual([
      "rm",
      "--force",
      "--volumes",
      args[args.indexOf("--name") + 1],
    ]);
  });

  it("rejects image tags and malformed IDs before accessing Docker", async () => {
    for (const value of ["node:24", "sha256:abc", `sha256:${"A".repeat(64)}`, `${imageId}\n`])
      await expect(observeSiteBuildLinuxImageEnvironmentV1(value)).rejects.toMatchObject({
        reason: "unavailable",
      });
    expect(docker.withHost).not.toHaveBeenCalled();
  });

  it("normalizes runtime/output/cleanup failures without leaking their contents", async () => {
    for (const kind of ["run", "exit", "stderr", "cleanup"] as const) {
      docker.run.mockImplementation((_host: unknown, args: string[]) => {
        if (kind === "run" && args[0] === "run") throw new Error("fixture-sensitive-detail");
        return Promise.resolve({
          code: kind === "exit" || (kind === "cleanup" && args[0] === "rm") ? 1 : 0,
          stdout: Buffer.from(JSON.stringify(body())),
          stderr: kind === "stderr" ? Buffer.from("fixture-sensitive-detail") : Buffer.alloc(0),
        });
      });
      await expect(observeSiteBuildLinuxImageEnvironmentV1(imageId)).rejects.toEqual(
        new SiteBuildError("unavailable"),
      );
      expect(docker.run.mock.calls.at(-1)?.[1][0]).toBe("rm");
    }
  });

  it("requires exact bounded observed JSON and sorted unique relative font inventory", async () => {
    const variants: unknown[] = [
      { ...body(), extra: true },
      { ...body(), architecture: "amd64" },
      { ...body(), node: { version: "v24.11.1", sha256: "A".repeat(64) } },
      { ...body(), browser: { version: "Chromium 141.0.7390.122", sha256: sha } },
      { ...body(), postgres: { version: "16.10", sha256: sha } },
      { ...body(), kernel: { release: "x\nsecret", version: "fixture" } },
      { ...body(), kernel: { release: "x".repeat(4097), version: "fixture" } },
      { ...body(), fonts: [] },
      { ...body(), fonts: Array(101).fill(body().fonts[0]) },
      { ...body(), fonts: [body().fonts[0], body().fonts[0]] },
      ...[
        "/usr/share/fonts/a.ttf",
        "usr/share/fonts/../a.ttf",
        "usr/share/fonts/a.woff",
        "usr/share/fonts/a\\b.ttf",
        "elsewhere/a.ttf",
      ].map((path) => ({ ...body(), fonts: [{ path, sha256: sha }] })),
      {
        ...body(),
        fonts: [
          { path: "usr/share/fonts/z.ttf", sha256: sha },
          { path: "usr/share/fonts/a.ttf", sha256: sha },
        ],
      },
    ];
    for (const value of variants) {
      docker.run.mockImplementation((_host: unknown, args: string[]) =>
        Promise.resolve({
          code: 0,
          stdout: Buffer.from(args[0] === "run" ? JSON.stringify(value) : ""),
          stderr: Buffer.alloc(0),
        }),
      );
      await expect(observeSiteBuildLinuxImageEnvironmentV1(imageId)).rejects.toMatchObject({
        reason: "unavailable",
      });
    }
    for (const raw of [
      "",
      "{",
      `${JSON.stringify(body()).slice(0, -1)},"architecture":"x64"}`,
      "x".repeat(128 * 1024 + 1),
    ]) {
      docker.run.mockImplementation((_host: unknown, args: string[]) =>
        Promise.resolve({
          code: 0,
          stdout: Buffer.from(args[0] === "run" ? raw : ""),
          stderr: Buffer.alloc(0),
        }),
      );
      await expect(observeSiteBuildLinuxImageEnvironmentV1(imageId)).rejects.toMatchObject({
        reason: "unavailable",
      });
    }
  });
});

interface WorkerFixtureOptions {
  link?: string;
  oversize?: string;
  change?: string;
  fontCount?: number;
  fontName?: string;
  virtualFontBytes?: number;
  platform?: string;
  versionFailure?: boolean;
}
async function workerFixture(options: WorkerFixtureOptions = {}) {
  const payloads = new Map<string, Buffer>([
    ["/usr/local/bin/node", Buffer.from("node bytes")],
    ["/opt/np/chromium/chrome", Buffer.from("browser bytes")],
    ["/usr/lib/postgresql/16/bin/postgres", Buffer.from("postgres bytes")],
    ["/etc/fonts/fonts.conf", Buffer.from("fontconfig bytes")],
    ["/proc/sys/kernel/osrelease", Buffer.from("6.12.0-linuxkit\n")],
    ["/proc/sys/kernel/version", Buffer.from("#1 SMP fixture\n")],
  ]);
  for (let i = 0; i < (options.fontCount ?? 2); i++)
    payloads.set(
      `/usr/share/fonts/${options.fontName ?? `font-${i}.ttf`}`,
      Buffer.from(`font-${i} bytes`),
    );
  const directories = new Set<string>();
  for (const path of payloads.keys()) {
    const parts = path.split("/");
    for (let i = 2; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
  }
  const reads: number[] = [],
    closed: string[] = [];
  const stats = (path: string, changed = false) => {
    if (!payloads.has(path) && !directories.has(path)) throw new Error("unavailable fixture path");
    const bytes = path.startsWith("/proc/")
      ? 0
      : options.oversize === path
        ? 512 * 1024 * 1024 + 1
        : path.startsWith("/usr/share/fonts/") && options.virtualFontBytes
          ? options.virtualFontBytes
          : (payloads.get(path)?.length ?? 0);
    return {
      dev: 1n,
      ino: 1n,
      size: BigInt(bytes),
      mode: 0o644n,
      nlink: 1n,
      mtimeNs: 1n,
      ctimeNs: changed ? 2n : 1n,
      isFile: () => payloads.has(path),
      isDirectory: () => directories.has(path),
      isSymbolicLink: () => path === options.link,
    };
  };
  let output = "";
  const processValue = {
    platform: options.platform ?? "linux",
    arch: "arm64",
    execPath: "/usr/local/bin/node",
    version: "v24.11.1",
    exitCode: 0,
    stdout: {
      write: (text: string) => {
        output += text;
      },
    },
  };
  const spawnSync = vi.fn((path: string) => ({
    status: options.versionFailure ? 1 : 0,
    signal: null,
    stderr: "",
    stdout: path.includes("chromium")
      ? "Chromium 141.0.7390.122 built on Debian\n"
      : "postgres (PostgreSQL) 16.10 (Debian fixture)\n",
  }));
  const opened = vi.fn((path: string, flags: number) => {
    expect(flags & constants.O_NOFOLLOW).toBeTruthy();
    let observed = false;
    return Promise.resolve({
      stat: () => {
        const changed = observed && options.change === path;
        observed = true;
        return Promise.resolve(stats(path, changed));
      },
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        reads.push(length);
        const data = payloads.get(path)!;
        const virtual = path.startsWith("/usr/share/fonts/") ? options.virtualFontBytes : undefined;
        const bytesRead = Math.max(0, Math.min(length, (virtual ?? data.length) - position));
        if (!virtual) data.copy(buffer, offset, position, position + bytesRead);
        return Promise.resolve({ bytesRead });
      },
      close: () => {
        closed.push(path);
        return Promise.resolve();
      },
    });
  });
  const modules: Record<string, unknown> = {
    "node:crypto": {
      createHash: options.virtualFontBytes
        ? () => ({
            update() {
              return this;
            },
            digest: () => sha,
          })
        : createHash,
    },
    "node:fs": { constants },
    "node:fs/promises": {
      lstat: (path: string) => Promise.resolve(stats(path)),
      open: opened,
      opendir: (path: string) => {
        const children = new Set(
          [...payloads.keys(), ...directories]
            .filter((entry) => entry.startsWith(`${path}/`))
            .map((entry) => entry.slice(path.length + 1).split("/")[0]),
        );
        return Promise.resolve([...children].reverse().map((name) => ({ name })));
      },
    },
    "node:child_process": { spawnSync },
  };
  await runInNewContext(NP_SITE_BUILD_LINUX_ENVIRONMENT_WORKER_V1, {
    require: (name: string) => {
      if (!(name in modules)) throw new Error("unexpected import");
      return modules[name];
    },
    process: processValue,
    Buffer,
    TextDecoder,
  });
  return { processValue, output, payloads, reads, closed, opened, spawnSync };
}

describe("isolated fixed image observer worker", () => {
  it("streams actual fixed bytes, preserves kernel/version text and sorts all font paths", async () => {
    const result = await workerFixture();
    expect(result.processValue.exitCode).toBe(0);
    const actual = JSON.parse(result.output) as ReturnType<typeof body>;
    expect(actual.kernel).toEqual({ release: "6.12.0-linuxkit", version: "#1 SMP fixture" });
    expect(actual.browser.version).toBe("141.0.7390.122");
    expect(actual.postgres.version).toBe("postgres (PostgreSQL) 16.10 (Debian fixture)");
    expect(actual.fonts.map(({ path }) => path)).toEqual([
      "usr/share/fonts/font-0.ttf",
      "usr/share/fonts/font-1.ttf",
    ]);
    expect(actual.node.sha256).toBe(createHash("sha256").update("node bytes").digest("hex"));
    expect(actual.fonts[0].sha256).toBe(createHash("sha256").update("font-0 bytes").digest("hex"));
    expect(Math.max(...result.reads)).toBeLessThanOrEqual(64 * 1024);
    expect(result.closed).toHaveLength(result.opened.mock.calls.length);
    for (const call of result.spawnSync.mock.calls)
      expect(call[0]).toMatch(
        /^\/(?:opt\/np\/chromium\/chrome|usr\/lib\/postgresql\/16\/bin\/postgres)$/u,
      );
  });

  it("rejects unsupported OS, path/ancestor links, changed files and oversized binaries", async () => {
    for (const options of [
      { platform: "darwin" },
      { link: "/usr/local/bin/node" },
      { link: "/usr/local" },
      { link: "/usr/share/fonts/font-0.ttf" },
      { change: "/usr/local/bin/node" },
      { oversize: "/opt/np/chromium/chrome" },
      { fontName: "single\\backslash.ttf" },
      { versionFailure: true },
    ]) {
      const result = await workerFixture(options);
      expect(result.processValue.exitCode, JSON.stringify(options)).toBe(1);
      expect(result.output).toBe("");
      expect(result.closed).toHaveLength(result.opened.mock.calls.length);
    }
  });

  it("enforces font inventory and aggregate byte limits before reporting success", async () => {
    for (const options of [
      { fontCount: 0 },
      { fontCount: 101 },
      { virtualFontBytes: 300 * 1024 * 1024 },
    ]) {
      const result = await workerFixture(options);
      expect(result.processValue.exitCode).toBe(1);
      expect(result.output).toBe("");
    }
  });
});
