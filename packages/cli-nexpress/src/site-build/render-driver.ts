import { spawn } from "node:child_process";
import { closeSync, constants, ftruncateSync, openSync, writeSync } from "node:fs";
import { cp, chmod, lstat, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { NpSiteBuildBrowserFailureV1, renderSiteBuildBrowserPngV1 } from "./chromium-render.js";
import { combineSiteBuildPngMontageV1 } from "./png-canonicalizer.js";
import { requireSiteBuildBrowserRequestPolicyV1 } from "./browser-request-policy.js";
import { deriveSiteBuildFixturePreviewContextV1 } from "./fixture-preview-context.js";
import { NpSiteBuildPreviewHttpFailureV1, requireSiteBuildPreviewHttpV1 } from "./preview-http.js";
import {
  stopSiteBuildRenderProcessV1 as stop,
  type NpSiteBuildRenderProcessV1 as OwnedProcess,
} from "./render-driver-process.js";
import {
  NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1,
  NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1,
} from "./render-worker-source.js";

// A fixed image entry, not a user-selected command. The outer native supervisor owns
// syscall auditing, total resource limits, descendant tracking and final reaping.
const project = "/np/project",
  output = "/np/output",
  driver = "/opt/np/driver";
const httpPort = 18080,
  postgresPort = 15432;
const wait = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
const environment = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: join(output, "home"),
  TMPDIR: join(output, "tmp"),
  NODE_ENV: "test",
  TZ: "UTC",
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `postgresql://np_build_fixture:np-build-synthetic-fixture-password-v1@127.0.0.1:${postgresPort}/postgres`,
  NP_SECRET: "np-build-synthetic-auth-secret-v1-32-characters",
  SITE_URL: `http://127.0.0.1:${httpPort}`,
  NP_BUILD_CAPSULE_PROJECT: project,
  NP_BUILD_CAPSULE_DEPENDENCIES: join(project, "node_modules"),
};
function start(
  executable: string,
  args: string[],
  env: Record<string, string>,
  options: { capture?: boolean; shutdownSignal?: OwnedProcess["shutdownSignal"] } = {},
): OwnedProcess {
  const child = spawn(executable, args, {
    cwd: project,
    env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  let ended = false;
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", () => {
      ended = true;
      reject(new Error("fixed-child-start"));
    });
    child.once("close", () => {
      ended = true;
      resolve();
    });
  });
  void closed.catch(() => {});
  return {
    child,
    closed,
    exited: () => ended,
    shutdownSignal: options.shutdownSignal ?? "SIGTERM",
  };
}
async function runNode(file: string, loader: string, doctor = false): Promise<void> {
  const process = start(
    "/usr/local/bin/node",
    ["--import", join(driver, "clock.mjs"), "--loader", loader, file],
    doctor
      ? { ...environment, NP_STORAGE_ADAPTER: "local", NP_STORAGE_DIR: join(output, "storage") }
      : environment,
    { capture: doctor },
  );
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  let stdoutBytes = 0,
    stderrBytes = 0,
    overflow = false;
  if (doctor) {
    process.child.stdout?.on("data", (bytes: Buffer) => {
      if ((stdoutBytes += bytes.length) > 256 * 1024) {
        overflow = true;
        process.child.kill("SIGTERM");
      } else stdout.push(bytes);
    });
    process.child.stderr?.on("data", (bytes: Buffer) => {
      if ((stderrBytes += bytes.length) > 256 * 1024) {
        overflow = true;
        process.child.kill("SIGTERM");
      } else stderr.push(bytes);
    });
  }
  await process.closed;
  if (overflow || process.child.exitCode !== 0 || process.child.signalCode !== null)
    throw new Error("fixed-worker-failed");
  if (doctor)
    await writeFile(
      join(output, "doctor-command-output.json"),
      JSON.stringify({
        schemaVersion: "np.agent-build-command-output.v1",
        stdout: { base64url: Buffer.concat(stdout).toString("base64url"), truncated: false },
        stderr: { base64url: Buffer.concat(stderr).toString("base64url"), truncated: false },
      }),
      { flag: "wx", mode: 0o600 },
    );
}
async function ready(port: number, process: OwnedProcess): Promise<void> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (process.exited()) throw new Error("fixed-service-exit");
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(250);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await wait(50);
  }
  throw new Error("fixed-service-timeout");
}
async function writableDatabase(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) await writableDatabase(join(path, name));
  } else if (info.isFile() && !info.isSymbolicLink()) await chmod(path, 0o600);
  else throw new Error("fixed-template-invalid");
}

async function readPrivateJson(
  name: "fixture.json" | "member-session.json",
  maximum: number,
): Promise<unknown> {
  const path = join(output, name);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum))
      throw new Error("fixed-fixture-limit");
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length <= maximum) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    for (const after of [await handle.stat({ bigint: true }), await lstat(path, { bigint: true })])
      if (
        length > maximum ||
        BigInt(length) !== before.size ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.mode !== before.mode ||
        after.nlink !== before.nlink ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs
      )
        throw new Error("fixed-fixture-changed");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
    ) as unknown;
  } finally {
    await handle.close();
  }
}

async function requireAnonymousWithholding(path: string): Promise<void> {
  await requireSiteBuildPreviewHttpV1({
    url: `http://127.0.0.1:${httpPort}${path}`,
    expected: "anonymous-withheld",
    timeoutMs: 60_000,
  });
}

async function requirePreviewReady(path: string, memberSessionToken?: string): Promise<void> {
  await requireSiteBuildPreviewHttpV1({
    url: `http://127.0.0.1:${httpPort}${path}`,
    expected: "ready",
    timeoutMs: 60_000,
    ...(memberSessionToken ? { memberSessionToken } : {}),
  });
}

export async function runSiteBuildRenderDriverV1(): Promise<void> {
  if (process.platform !== "linux" || process.getuid?.() !== 1000 || process.cwd() !== project)
    throw new Error("fixed-driver-unavailable");
  const inputBytes = await readFile(join(project, ".nexpress/site/tmp/render-input.json"));
  if (inputBytes.length > 8 * 1024 * 1024) throw new Error("fixed-input-limit");
  const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes));
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new Error("fixed-input-invalid");
  const value = input as Record<string, unknown>;
  if (
    ![
      "catalog",
      "blueprint",
      "candidate",
      "projection",
      "fixture",
      "render",
      "final-render",
      "doctor",
    ].includes(String(value.mode)) ||
    typeof value.config !== "string" ||
    !/^(?:src\/)?nexpress\.config\.[cm]?[jt]s$/u.test(value.config)
  )
    throw new Error("fixed-input-invalid");
  // Each page gets a fresh database/browser job. The host combines their
  // canonical PNGs in the declared order; one native deadline never grows
  // with the IA or montage page count.
  const rendering = value.mode === "render" || value.mode === "final-render";
  if (rendering && (!Array.isArray(value.routes) || value.routes.length !== 1))
    throw new Error("fixed-render-batch-invalid");
  await mkdir(join(output, "tmp"), { recursive: true });
  await mkdir(join(output, "home"), { recursive: true });
  await mkdir(join(output, "next-cache"), { recursive: true });
  if (value.mode === "doctor") await mkdir(join(output, "storage"), { mode: 0o700 });
  const require = createRequire(join(project, "package.json"));
  const loader = join(
    dirname(require.resolve("@nexpress/cli/package.json")),
    "dist/site-build-loader.js",
  );
  let database: OwnedProcess | undefined,
    server: OwnedProcess | undefined,
    stage = "worker";
  try {
    if (value.mode === "fixture" || value.mode === "doctor" || rendering) {
      stage = "database";
      const databaseRoot = join(output, "postgres");
      await cp("/opt/np/postgres-template", databaseRoot, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await writableDatabase(databaseRoot);
      await mkdir(join(output, "pgsocket"), { mode: 0o700 });
      database = start(
        "/usr/lib/postgresql/16/bin/postgres",
        [
          "-D",
          databaseRoot,
          "-h",
          "127.0.0.1",
          "-p",
          String(postgresPort),
          "-k",
          join(output, "pgsocket"),
          "-c",
          "shared_memory_type=mmap",
          "-c",
          "dynamic_shared_memory_type=mmap",
          "-c",
          "max_connections=30",
          "-c",
          "shared_buffers=16MB",
        ],
        environment,
        // PostgreSQL fast shutdown closes idle sessions and reaps its children;
        // smart shutdown can wait indefinitely for a pooled client to disconnect.
        { shutdownSignal: "SIGINT" },
      );
      await ready(postgresPort, database);
    }
    stage = "fixture";
    await runNode(join(driver, "worker.mjs"), loader, value.mode === "doctor");
    if (rendering) {
      stage = "server";
      // Use the ordinary standalone entry. No credential files are staged; the
      // native profile handles only exact, verified-absent Next metadata probes.
      const serverEntry = join(project, ".next/standalone/server.js");
      const serverInfo = await lstat(serverEntry);
      if (!serverInfo.isFile() || serverInfo.isSymbolicLink())
        throw new Error("fixed-build-unavailable");
      server = start("/usr/local/bin/node", ["--import", join(driver, "clock.mjs"), serverEntry], {
        ...environment,
        HOSTNAME: "127.0.0.1",
        PORT: String(httpPort),
      });
      await ready(httpPort, server);
      stage = "browser";
      if (
        !Array.isArray(value.routes) ||
        value.routes.length < 1 ||
        value.routes.length > 200 ||
        !Array.isArray(value.allowedPaths)
      )
        throw new Error("fixed-render-input-invalid");
      let ordinal = 0;
      const pages: Uint8Array[] = [];
      const requestPolicy = requireSiteBuildBrowserRequestPolicyV1(value.requestPolicy);
      const fixture = await readPrivateJson("fixture.json", 8 * 1024 * 1024);
      if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture))
        throw new Error("fixed-fixture-invalid");
      const projected = (fixture as Record<string, unknown>).pageDocuments;
      if (!Array.isArray(projected) || projected.length > 200)
        throw new Error("fixed-fixture-invalid");
      const selected = new Set<string>();
      for (const route of value.routes) {
        if (route === null || typeof route !== "object" || Array.isArray(route))
          throw new Error("fixed-render-input-invalid");
        const row = route as Record<string, unknown>;
        if (
          typeof row.pageId !== "string" ||
          selected.has(row.pageId) ||
          typeof row.path !== "string" ||
          !row.path.startsWith("/") ||
          !["public", "member"].includes(String(row.audience)) ||
          typeof row.locale !== "string"
        )
          throw new Error("fixed-render-route-unsupported");
        const actual: unknown = projected.find(
          (page: unknown) =>
            page !== null &&
            typeof page === "object" &&
            !Array.isArray(page) &&
            (page as Record<string, unknown>).pageId === row.pageId,
        );
        if (actual === null || typeof actual !== "object" || Array.isArray(actual))
          throw new Error("fixed-render-route-binding");
        const page = actual as Record<string, unknown>;
        if (
          page.route !== row.path ||
          page.audience !== row.audience ||
          (page.locale !== null && page.locale !== row.locale)
        )
          throw new Error("fixed-render-route-binding");
        selected.add(row.pageId);
        let memberSessionToken: string | undefined;
        let expectedForumTitle: string | undefined;
        if (page.routeOwner !== undefined) {
          const documents = (fixture as Record<string, unknown>).documents;
          if (!Array.isArray(documents)) throw new Error("fixed-fixture-invalid");
          const document: unknown = documents.find(
            (entry: unknown) =>
              entry !== null &&
              typeof entry === "object" &&
              (entry as Record<string, unknown>).documentId === page.documentId,
          );
          if (document === null || typeof document !== "object" || Array.isArray(document))
            throw new Error("fixed-fixture-invalid");
          const data = (document as Record<string, unknown>).data;
          if (
            data === null ||
            typeof data !== "object" ||
            Array.isArray(data) ||
            typeof (data as Record<string, unknown>).title !== "string"
          )
            throw new Error("fixed-fixture-invalid");
          expectedForumTitle = (data as Record<string, string>).title;
        }
        if (row.audience === "member") {
          if (
            page.sessionRequired !== "member" ||
            page.anonymousWithholdingRequired !== true ||
            !expectedForumTitle
          )
            throw new Error("fixed-audience-unsupported");
          stage = "audience";
          await requireAnonymousWithholding(row.path);
          const session = await readPrivateJson("member-session.json", 8192);
          if (
            session === null ||
            typeof session !== "object" ||
            Array.isArray(session) ||
            (session as Record<string, unknown>).schemaVersion !==
              "np.site-build-private-member-session.v1" ||
            typeof (session as Record<string, unknown>).access !== "string"
          )
            throw new Error("fixed-member-session-invalid");
          memberSessionToken = (session as Record<string, string>).access;
        }
        // Complete the ordinary route's cold HTTP bootstrap before launching
        // Chromium. Both requests remain inside the same fixed native deadline
        // and private database; this never substitutes for the browser capture.
        stage = "prewarm";
        await requirePreviewReady(row.path, memberSessionToken);
        stage = "browser";
        const progressFd = openSync(
          join(output, "browser-progress.json"),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        let result: Awaited<ReturnType<typeof renderSiteBuildBrowserPngV1>>;
        try {
          result = await renderSiteBuildBrowserPngV1({
            executable: "/opt/np/chromium/chrome",
            outputRoot: output,
            url: `http://127.0.0.1:${httpPort}${row.path}`,
            allowedPaths: value.allowedPaths as string[],
            requestPolicy,
            viewport: value.viewport as { width: number; height: number; deviceScaleFactor: 1 | 2 },
            locale: row.locale,
            clockNow: String(value.clockNow),
            randomSeed: String(value.randomSeed),
            timeoutMs: 120_000,
            ...(memberSessionToken ? { memberSessionToken } : {}),
            ...(expectedForumTitle ? { expectedForumTitle } : {}),
            previewChecks: deriveSiteBuildFixturePreviewContextV1({
              fixture,
              pageId: row.pageId,
              route: row.path,
              locale: row.locale,
              renderer: value.renderer,
            }),
            onProgress(progress) {
              const bytes = Buffer.from(
                JSON.stringify({ schemaVersion: "np.site-build-browser-progress.v1", ...progress }),
              );
              if (writeSync(progressFd, bytes, 0, bytes.length, 0) !== bytes.length)
                throw new Error("fixed-progress-write");
              ftruncateSync(progressFd, bytes.length);
            },
          });
        } finally {
          closeSync(progressFd);
        }
        if (result.png.length > 10 * 1024 * 1024) throw new Error("fixed-image-limit");
        if (!result.checks) throw new Error("fixed-checks-unavailable");
        const checkBytes = Buffer.from(
          JSON.stringify({
            schemaVersion: "np.site-build-page-preview-observations.v1",
            pageId: row.pageId,
            route: row.path,
            locale: row.locale,
            audience: row.audience,
            status: result.status,
            ...result.checks,
          }),
        );
        if (checkBytes.length > 3 * 1024 * 1024) throw new Error("fixed-checks-limit");
        await writeFile(
          join(output, `preview-checks-${String(ordinal).padStart(3, "0")}.json`),
          checkBytes,
          { flag: "wx", mode: 0o600 },
        );
        pages.push(result.png);
        await writeFile(
          join(output, `page-${String(ordinal++).padStart(3, "0")}.png`),
          result.png,
          { flag: "wx", mode: 0o600 },
        );
      }
      await writeFile(join(output, "montage.png"), combineSiteBuildPngMontageV1(pages), {
        flag: "wx",
        mode: 0o600,
      });
    }
    await writeFile(
      join(output, "driver-result.json"),
      JSON.stringify({
        schemaVersion: "np.site-build-driver-result.v1",
        status: "passed",
        stage: value.mode,
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    await writeFile(
      join(output, "driver-result.json"),
      JSON.stringify({
        schemaVersion: "np.site-build-driver-result.v1",
        status: "failed",
        stage,
        browserPhase: error instanceof NpSiteBuildBrowserFailureV1 ? error.phase : null,
        browserDiagnostic: error instanceof NpSiteBuildBrowserFailureV1 ? error.diagnostic : null,
        previewHttpDiagnostic:
          error instanceof NpSiteBuildPreviewHttpFailureV1 ? error.diagnostic : null,
      }),
      { flag: "wx", mode: 0o600 },
    );
    throw new Error("fixed-driver-failed", { cause: error });
  } finally {
    try {
      await stop(server);
    } finally {
      await stop(database);
    }
  }
}

export const siteBuildRenderDriverAssetsV1 = {
  "worker.mjs": NP_SITE_BUILD_RENDER_WORKER_SOURCE_V1,
  "clock.mjs": NP_SITE_BUILD_RENDER_CLOCK_SOURCE_V1,
};
