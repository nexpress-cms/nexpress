import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as DockerHost from "./docker-host.js";
import type * as Url from "node:url";
import {
  prepareSiteBuildLinuxSandboxImageV1,
  runSiteBuildLinuxSandboxV1,
  SiteBuildLinuxSandboxFailureV1,
} from "./linux-sandbox.js";

const fixture = vi.hoisted(() => ({ dist: "", recipe: "", run: vi.fn() }));
const imageId = `sha256:${"a".repeat(64)}`;
vi.mock("node:url", async (original) => {
  const actual = await original<typeof Url>();
  return {
    ...actual,
    fileURLToPath: (url: string | URL) =>
      String(url).endsWith("/linux-sandbox.ts")
        ? join(fixture.dist, "index.js")
        : actual.fileURLToPath(url),
  };
});
vi.mock("./render-driver.js", () => ({ siteBuildRenderDriverAssetsV1: {} }));
vi.mock("./renderer-image.js", () => ({
  prepareSiteBuildRendererBaseV1: () => Promise.resolve({ imageId: `sha256:${"a".repeat(64)}` }),
  NP_SITE_BUILD_RENDERER_FONTCONFIG_V1: "fixed unit fontconfig",
}));
vi.mock("./docker-host.js", async (original) => ({
  ...(await original<typeof DockerHost>()),
  runSiteBuildDockerV1: fixture.run,
  withSiteBuildDockerV1: async (run: (host: unknown) => Promise<unknown>) =>
    run({
      endpoint: "unix:///fixture.sock",
      config: "/owned-empty",
      readOnlyData: "/owned-empty-data",
    }),
}));
const roots: string[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function artifact(name: string, value: unknown): Buffer {
  const content = Buffer.from(JSON.stringify(value)),
    header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000600\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(32, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Buffer.concat([
    header,
    content,
    Buffer.alloc(((512 - (content.length % 512)) % 512) + 1024),
  ]);
}
beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "np-sandbox-abort-unit-"));
  roots.push(root);
  fixture.dist = join(root, "dist");
  await mkdir(fixture.dist);
  for (const name of ["index.js", "site-build-render-driver.js"])
    await writeFile(join(fixture.dist, name), "// actual unit asset bytes\n");
  fixture.run.mockReset().mockImplementation((_host: unknown, args: string[]) => {
    let stdout = "";
    if (args[0] === "image" && args[1] === "ls") {
      fixture.recipe = args
        .find((arg) => arg.startsWith("reference="))!
        .split(":")
        .at(-1)!;
      stdout = imageId;
    } else if (args[0] === "image" && args[1] === "inspect")
      stdout = `${imageId} ${fixture.recipe}`;
    else if (args[0] === "run") stdout = "b".repeat(64);
    else if (args[0] === "inspect") stdout = "|private|none|true|false";
    return Promise.resolve({ code: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) });
  });
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Docker is deliberately doubled. These tests prove lifecycle ownership/order,
// not actual native containment or daemon behavior.
describe("native sandbox cooperative cancellation ownership", () => {
  const applicationDiagnostic = {
    schemaVersion: "np.site-build-application-error-diagnostic.v1",
    reasons: ["statement-timeout"],
    truncated: false,
  };
  it.each([
    { application: applicationDiagnostic, expected: applicationDiagnostic },
    { application: { ...applicationDiagnostic, message: "private-query-value" }, expected: null },
  ])(
    "projects bounded driver diagnostics through strict artifact reads and cleanup ($expected)",
    async ({ application, expected }) => {
      const image = await prepareSiteBuildLinuxSandboxImageV1();
      const audit = {
        schemaVersion: "np.site-build-linux-audit.v1",
        status: "failed",
        reason: "driver-exit",
        rootExitCode: 1,
        rootSignal: 0,
        tracedProcesses: 2,
        reapedProcesses: 2,
        descendantsReaped: true,
        argumentsFrozen: true,
        ownIpcReclaimed: true,
        forbiddenAttempts: 0,
      };
      const wait = {
        step: "post-font-idle",
        elapsedMs: 120_001,
        stepElapsedMs: 90_000,
        pendingCount: 9,
        truncated: true,
        pending: Array.from({ length: 8 }, () => ({
          target: "api",
          query: "none",
          method: "GET",
          apiRole: "member-session",
          resourceType: "fetch",
          headersReceived: false,
          eventStream: false,
          ageMs: 89_999,
        })),
      };
      const detail = {
        reason: "timeout",
        loaded: true,
        inflight: 9,
        ready: 0,
        request: null,
        wait,
      };
      const driver = {
        status: "failed",
        stage: "browser",
        browserPhase: "fonts",
        browserDiagnostic: detail,
      };
      expect(Buffer.byteLength(JSON.stringify(driver))).toBeGreaterThan(1024);
      const normal = fixture.run.getMockImplementation()!;
      fixture.run.mockImplementation((host: unknown, args: string[]) => {
        if (args[0] === "start")
          return Promise.resolve({
            code: 1,
            stdout: Buffer.from(JSON.stringify(audit)),
            stderr: Buffer.alloc(0),
          });
        if (args[0] === "cp") {
          const name = args[1].split("/").at(-1)!;
          return Promise.resolve({
            code: name === "fixture-result.json" ? 1 : 0,
            stdout: artifact(
              name,
              name === "result.json"
                ? audit
                : name === "application-error-diagnostic.json"
                  ? application
                  : driver,
            ),
            stderr: Buffer.alloc(0),
          });
        }
        return normal(host, args);
      });
      const failed = await runSiteBuildLinuxSandboxV1({
        image,
        project: fixture.dist,
        artifacts: [],
      }).catch((error: unknown) => error);
      expect(failed).toBeInstanceOf(SiteBuildLinuxSandboxFailureV1);
      expect(failed).toMatchObject({
        browserPhase: "fonts",
        browserDiagnostic: detail,
        applicationDiagnostic: expected,
      });
      expect(JSON.stringify(failed)).not.toContain("private-query-value");
      expect(fixture.run.mock.calls.filter(([, args]) => args[0] === "rm")).toHaveLength(1);
      expect(
        fixture.run.mock.calls.filter(([, args]) => args[0] === "volume" && args[1] === "rm"),
      ).toHaveLength(2);
    },
  );

  it("does no Docker work for an already aborted request", async () => {
    const image = await prepareSiteBuildLinuxSandboxImageV1();
    fixture.run.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSiteBuildLinuxSandboxV1({
        image,
        project: fixture.dist,
        artifacts: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(fixture.run).not.toHaveBeenCalled();
  });

  it("force-removes only its active container and awaits attach plus both volume deletions", async () => {
    const image = await prepareSiteBuildLinuxSandboxImageV1(),
      controller = new AbortController();
    const started = deferred<void>(),
      attach = deferred<void>(),
      removed = deferred<void>(),
      volumes = deferred<void>();
    const normal = fixture.run.getMockImplementation()!;
    let name = "";
    const deleted: string[] = [];
    fixture.run.mockImplementation(async (host: unknown, args: string[]) => {
      if (args[0] === "create") name = args[args.indexOf("--name") + 1];
      if (args[0] === "start") {
        started.resolve();
        await attach.promise;
        throw new Error("bounded attach closed");
      }
      if (args[0] === "rm") {
        expect(args).toEqual(["rm", "--force", "--volumes", name]);
        removed.resolve();
        await attach.promise;
      }
      if (args[0] === "volume" && args[1] === "rm") {
        deleted.push(args[2]);
        await volumes.promise;
      }
      return normal(host, args);
    });
    let settled = false;
    const failed = runSiteBuildLinuxSandboxV1({
      image,
      project: fixture.dist,
      artifacts: [],
      signal: controller.signal,
    }).catch((error: unknown) => {
      settled = true;
      return error;
    });
    await started.promise;
    controller.abort();
    await removed.promise;
    expect(settled).toBe(false);
    expect(deleted).toEqual([]);
    attach.resolve();
    // Wait until the first cleanup command is owned, without a timing sleep.
    await vi.waitFor(() => expect(deleted).toHaveLength(1));
    expect(settled).toBe(false);
    volumes.resolve();
    expect(await failed).toMatchObject({ reason: "unavailable" });
    expect(deleted).toEqual([`${name}-output`, `${name}-audit`]);
    const start = fixture.run.mock.calls.find(([, args]) => args[0] === "start")!;
    expect(start[2]).toEqual({ timeoutMs: 315_000, bytes: 16 * 1024 });
    const create = fixture.run.mock.calls.find(([, args]) => args[0] === "create")![1];
    for (const flag of [
      "none",
      "--read-only",
      "SYS_PTRACE",
      "SETUID",
      "SETGID",
      "KILL",
      "no-new-privileges",
    ])
      expect(create).toContain(flag);
  });

  it("cleans a container created concurrently with cancellation without starting it", async () => {
    const image = await prepareSiteBuildLinuxSandboxImageV1(),
      controller = new AbortController();
    const normal = fixture.run.getMockImplementation()!;
    fixture.run.mockImplementation((host: unknown, args: string[]) => {
      if (args[0] === "create") controller.abort();
      return normal(host, args);
    });
    await expect(
      runSiteBuildLinuxSandboxV1({
        image,
        project: fixture.dist,
        artifacts: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(fixture.run.mock.calls.some(([, args]) => args[0] === "start")).toBe(false);
    expect(fixture.run.mock.calls.filter(([, args]) => args[0] === "rm")).toHaveLength(1);
    expect(
      fixture.run.mock.calls.filter(([, args]) => args[0] === "volume" && args[1] === "rm"),
    ).toHaveLength(2);
  });

  it("still attempts both volume removals and fails closed when cancelled cleanup fails", async () => {
    const image = await prepareSiteBuildLinuxSandboxImageV1(),
      controller = new AbortController();
    const normal = fixture.run.getMockImplementation()!;
    fixture.run.mockImplementation((host: unknown, args: string[]) => {
      if (args[0] === "create") controller.abort();
      if (args[0] === "volume" && args[1] === "rm" && args[2].endsWith("-output"))
        return Promise.resolve({
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from("private daemon detail"),
        });
      return normal(host, args);
    });
    await expect(
      runSiteBuildLinuxSandboxV1({
        image,
        project: fixture.dist,
        artifacts: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(
      fixture.run.mock.calls.filter(([, args]) => args[0] === "volume" && args[1] === "rm"),
    ).toHaveLength(2);
  });
});
