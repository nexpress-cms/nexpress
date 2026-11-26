import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteBuildError } from "./artifact-io.js";
import { assertSiteBuildObservationActiveV1 } from "./observation-deadline.js";
import {
  projectSiteBuildApplicationErrorDiagnosticV1,
  type NpSiteBuildApplicationErrorDiagnosticV1,
} from "./application-error-diagnostic.js";
import {
  requireSiteBuildPreviewHttpDiagnosticV1,
  type NpSiteBuildPreviewHttpDiagnosticV1,
} from "./preview-http.js";
import {
  projectSiteBuildBrowserDiagnosticV1,
  type NpSiteBuildBrowserDiagnosticV1,
} from "./browser-request-diagnostic.js";
import {
  runSiteBuildDockerV1,
  withSiteBuildDockerV1,
  siteBuildReadOnlyImageDataArgsV1,
  type NpSiteBuildDockerHostV1,
} from "./docker-host.js";
import { NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1 } from "./linux-supervisor-source.js";
import { siteBuildRenderDriverAssetsV1 } from "./render-driver.js";
import { readSiteBuildSandboxArtifactV1 } from "./sandbox-artifact.js";
import { observeSiteBuildLinuxImageEnvironmentV1 } from "./linux-environment.js";
import {
  prepareSiteBuildRendererBaseV1,
  NP_SITE_BUILD_RENDERER_FONTCONFIG_V1,
} from "./renderer-image.js";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const imageId = (value: string) => /^sha256:[a-f0-9]{64}$/u.test(value);
const preparedImages = new WeakSet<NpSiteBuildLinuxSandboxImageV1>();
export interface NpSiteBuildLinuxSandboxImageV1 {
  schemaVersion: "np.site-build-linux-sandbox-image.v1";
  imageId: string;
  baseImageId: string;
  recipeDigest: string;
  supervisorSha256: string;
  supervisorSourceSha256: string;
  fontconfigSha256: string;
  driverFiles: Array<{ path: string; sha256: string }>;
}
async function successful(
  host: NpSiteBuildDockerHostV1,
  args: string[],
  timeoutMs = 30_000,
  bytes = 1024 * 1024,
): Promise<Buffer> {
  const result = await runSiteBuildDockerV1(host, args, { timeoutMs, bytes });
  if (result.code !== 0) throw new SiteBuildError("unavailable");
  return result.stdout;
}

/** Explicit, offline final image assembly from the provisioned immutable base and shipped assets. */
export async function prepareSiteBuildLinuxSandboxImageV1(): Promise<NpSiteBuildLinuxSandboxImageV1> {
  const baseImageId = (await prepareSiteBuildRendererBaseV1()).imageId;
  const root = await mkdtemp(join(tmpdir(), "np-build-native-image-"));
  try {
    const assets = join(root, "assets");
    await mkdir(assets);
    const dist = dirname(fileURLToPath(import.meta.url));
    // This function is shipped in dist/index.js; no source checkout or unshipped TS is used.
    const files = (await readdir(dist))
      .filter((name) =>
        /^(?:index|site-build-render-driver|site-build-loader|chunk-[A-Za-z0-9_-]+)\.js$/u.test(
          name,
        ),
      )
      .sort();
    if (!files.includes("site-build-render-driver.js") || files.length > 100)
      throw new SiteBuildError("unavailable");
    const driverFiles: Array<{ path: string; sha256: string }> = [];
    for (const name of files) {
      const file = join(dist, name),
        info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
        throw new SiteBuildError("input");
      const bytes = await readFile(file);
      await writeFile(join(assets, name), bytes, { flag: "wx", mode: 0o400 });
      driverFiles.push({ path: name, sha256: digest(bytes) });
    }
    for (const [name, body] of Object.entries(siteBuildRenderDriverAssetsV1)) {
      await writeFile(join(assets, name), body, { flag: "wx", mode: 0o400 });
      driverFiles.push({ path: name, sha256: digest(body) });
    }
    const packageBody = '{"type":"module"}\n';
    await writeFile(join(assets, "package.json"), packageBody, {
      flag: "wx",
      mode: 0o400,
    });
    driverFiles.push({ path: "package.json", sha256: digest(packageBody) });
    driverFiles.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
    const supervisorSourceSha256 = digest(NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1);
    const fontconfigSha256 = digest(NP_SITE_BUILD_RENDERER_FONTCONFIG_V1);
    await writeFile(join(root, "fonts.conf"), NP_SITE_BUILD_RENDERER_FONTCONFIG_V1, {
      flag: "wx",
      mode: 0o400,
    });
    await writeFile(join(root, "supervisor.c"), NP_SITE_BUILD_LINUX_SUPERVISOR_SOURCE_V1, {
      flag: "wx",
      mode: 0o400,
    });
    const recipe = [
      `FROM ${baseImageId}`,
      "COPY supervisor.c /opt/np/supervisor.c",
      "COPY assets/ /opt/np/driver/",
      "COPY fonts.conf /etc/fonts/fonts.conf",
      "RUN gcc -std=c11 -O2 -Wall -Wextra -Werror /opt/np/supervisor.c -o /opt/np/supervisor && chmod 0555 /opt/np/supervisor && chmod 0444 /etc/fonts/fonts.conf && find /opt/np/driver -type f -exec chmod 0444 {} + && find /opt/np/driver -type d -exec chmod 0555 {} + && mkdir -p /np/project /np/output /np/audit && chmod 0700 /np/audit && chown 1000:1000 /np/output && chmod 0700 /np/output",
      'ENTRYPOINT ["/opt/np/supervisor"]',
      "CMD []",
      "",
    ].join("\n");
    await writeFile(join(root, "Dockerfile"), recipe, { flag: "wx", mode: 0o400 });
    const recipeDigest = digest(
      JSON.stringify({ recipe, supervisorSourceSha256, fontconfigSha256, driverFiles }),
    );
    const iidfile = join(root, "image-id");
    return await withSiteBuildDockerV1(async (host) => {
      const tag = `nexpress-site-build-native:${recipeDigest}`;
      const cached = (
        await successful(
          host,
          ["image", "ls", "--no-trunc", "--filter", `reference=${tag}`, "--format", "{{.ID}}"],
          30_000,
          4096,
        )
      )
        .toString()
        .trim();
      if (cached && !imageId(cached)) throw new SiteBuildError("unavailable");
      if (!cached)
        await successful(
          host,
          [
            "build",
            "--network",
            "none",
            "--label",
            `org.nexpress.build.recipe=${recipeDigest}`,
            "--tag",
            tag,
            "--iidfile",
            iidfile,
            root,
          ],
          120_000,
          2 * 1024 * 1024,
        );
      const id = cached || (await readFile(iidfile, "utf8")).trim();
      if (!imageId(id)) throw new SiteBuildError("unavailable");
      const observed = (
        await successful(host, [
          "image",
          "inspect",
          id,
          "--format",
          '{{.Id}} {{index .Config.Labels "org.nexpress.build.recipe"}}',
        ])
      )
        .toString()
        .trim();
      if (observed !== `${id} ${recipeDigest}`) throw new SiteBuildError("unavailable");
      const supervisorSha256 = (
        await successful(
          host,
          [
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--entrypoint",
            "/usr/local/bin/node",
            id,
            "--input-type=module",
            "-e",
            "import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';console.log(createHash('sha256').update(await readFile('/opt/np/supervisor')).digest('hex'));",
          ],
          30_000,
          4096,
        )
      )
        .toString()
        .trim();
      if (!/^[a-f0-9]{64}$/u.test(supervisorSha256)) throw new SiteBuildError("unavailable");
      const prepared: NpSiteBuildLinuxSandboxImageV1 = {
        schemaVersion: "np.site-build-linux-sandbox-image.v1",
        imageId: id,
        baseImageId,
        recipeDigest,
        supervisorSha256,
        supervisorSourceSha256,
        fontconfigSha256,
        driverFiles,
      };
      Object.freeze(prepared);
      preparedImages.add(prepared);
      return prepared;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Fresh image-file observation; only an image prepared by this process is accepted. */
export async function observeSiteBuildLinuxSandboxEnvironmentV1(
  image: NpSiteBuildLinuxSandboxImageV1,
) {
  if (!preparedImages.has(image)) throw new SiteBuildError("input");
  const observed = await observeSiteBuildLinuxImageEnvironmentV1(image.imageId);
  if (observed.fontconfigSha256 !== image.fontconfigSha256) throw new SiteBuildError("unavailable");
  return observed;
}

export interface NpSiteBuildLinuxAuditV1 {
  schemaVersion: "np.site-build-linux-audit.v1";
  status: "passed" | "failed" | "violation" | "unavailable";
  reason: string;
  tracedProcesses: number;
  reapedProcesses: number;
  descendantsReaped: boolean;
  argumentsFrozen: boolean;
  ownIpcReclaimed: boolean;
  rootExitCode: number | null;
  rootSignal: number;
  forbiddenAttempts: number;
  [key: string]: unknown;
}

export class SiteBuildLinuxSandboxFailureV1 extends SiteBuildError {
  constructor(
    readonly audit: NpSiteBuildLinuxAuditV1,
    readonly driverStage: string | null,
    readonly fixtureStage: string | null = null,
    readonly fixtureReason: string | null = null,
    readonly fixtureLocation: { owner: string; line: number } | null = null,
    readonly browserPhase: string | null = null,
    readonly browserDiagnostic: NpSiteBuildBrowserDiagnosticV1 | null = null,
    readonly previewHttpDiagnostic: NpSiteBuildPreviewHttpDiagnosticV1 | null = null,
    readonly applicationDiagnostic: NpSiteBuildApplicationErrorDiagnosticV1 | null = null,
  ) {
    super("unavailable");
  }
}

/**
 * Read-only prepared source; only a fresh bounded, private volume is writable.
 * Abort force-removes this invocation's container, then awaits attached transport
 * termination and all cleanup attempts using the existing bounded Docker calls.
 * A cleanup/daemon failure rejects and does not attest resource deletion.
 */
export async function runSiteBuildLinuxSandboxV1(input: {
  image: NpSiteBuildLinuxSandboxImageV1;
  project: string;
  /** Fixed driver input only. Mounted read-only without changing the frozen source copy. */
  inputBytes?: Uint8Array;
  artifacts: readonly { name: string; maxBytes: number }[];
  signal?: AbortSignal;
}): Promise<{ audit: NpSiteBuildLinuxAuditV1; artifacts: Map<string, Uint8Array> }> {
  assertSiteBuildObservationActiveV1(input);
  if (
    !preparedImages.has(input.image) ||
    !imageId(input.image.imageId) ||
    input.artifacts.length > 403 ||
    input.artifacts.some(
      (file) =>
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(file.name) ||
        !Number.isSafeInteger(file.maxBytes) ||
        file.maxBytes < 1 ||
        file.maxBytes > 64 * 1024 * 1024,
    ) ||
    new Set(input.artifacts.map((file) => file.name)).size !== input.artifacts.length
  )
    throw new SiteBuildError("input");
  const project = await realpath(input.project);
  if (project === "/" || project.includes(",") || !(await lstat(project)).isDirectory())
    throw new SiteBuildError("path");
  return withSiteBuildDockerV1(async (host) => {
    assertSiteBuildObservationActiveV1(input);
    let inputRoot: string | undefined;
    const name = `np-build-render-${randomUUID()}`,
      volume = `${name}-output`,
      auditVolume = `${name}-audit`;
    let created = false,
      volumeCreated = false,
      auditVolumeCreated = false;
    let abortRemoval: Promise<void> | undefined;
    const abort = () => {
      if (created && !abortRemoval) {
        abortRemoval = successful(host, ["rm", "--force", "--volumes", name]).then(() => {
          created = false;
        });
        // The finally owner awaits this promise, including failures. An event
        // listener cannot itself return an awaited promise to AbortController.
        void abortRemoval.catch(() => {});
      }
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = async (): Promise<void> => {
      input.signal?.removeEventListener("abort", abort);
      let failed = false;
      if (abortRemoval) {
        try {
          await abortRemoval;
        } catch {
          failed = true;
        }
      }
      if (created) {
        try {
          await successful(host, ["rm", "--force", "--volumes", name]);
        } catch {
          failed = true;
        }
      }
      for (const resource of [
        volumeCreated ? volume : null,
        auditVolumeCreated ? auditVolume : null,
      ]) {
        if (resource) {
          try {
            await successful(host, ["volume", "rm", resource]);
          } catch {
            failed = true;
          }
        }
      }
      if (inputRoot) {
        try {
          await rm(inputRoot, { recursive: true, force: true });
        } catch {
          failed = true;
        }
      }
      if (failed) throw new SiteBuildError("unavailable");
    };
    try {
      assertSiteBuildObservationActiveV1(input);
      const inputMount: string[] = [];
      if (input.inputBytes !== undefined) {
        if (!(input.inputBytes instanceof Uint8Array) || input.inputBytes.length > 8 * 1024 * 1024)
          throw new SiteBuildError("input");
        const bytes = Buffer.from(input.inputBytes);
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const target = join(project, ".nexpress/site/tmp/render-input.json");
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
          throw new SiteBuildError("input");
        inputRoot = await mkdtemp(join(tmpdir(), "np-build-fixed-input-"));
        if (inputRoot.includes(",")) throw new SiteBuildError("unavailable");
        const source = join(inputRoot, "input.json");
        await writeFile(source, bytes, { flag: "wx", mode: 0o444 });
        await chmod(source, 0o444);
        inputMount.push(
          "--mount",
          `type=bind,src=${source},dst=/np/project/.nexpress/site/tmp/render-input.json,readonly`,
        );
      }
      assertSiteBuildObservationActiveV1(input);
      await successful(host, [
        "volume",
        "create",
        "--label",
        "org.nexpress.build.owned=true",
        volume,
      ]);
      volumeCreated = true;
      assertSiteBuildObservationActiveV1(input);
      await successful(host, [
        "volume",
        "create",
        "--label",
        "org.nexpress.build.owned=true",
        auditVolume,
      ]);
      auditVolumeCreated = true;
      assertSiteBuildObservationActiveV1(input);
      await successful(host, [
        "create",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--ipc",
        "private",
        "--cap-drop",
        "ALL",
        "--cap-add",
        "SYS_PTRACE",
        "--cap-add",
        "SETUID",
        "--cap-add",
        "SETGID",
        "--cap-add",
        "KILL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "256",
        "--memory",
        "2g",
        "--cpus",
        "2",
        "--ulimit",
        "nofile=4096:4096",
        "--mount",
        `type=bind,src=${project},dst=/np/project,readonly`,
        "--mount",
        `type=volume,src=${volume},dst=/np/output`,
        "--mount",
        `type=volume,src=${auditVolume},dst=/np/audit`,
        ...siteBuildReadOnlyImageDataArgsV1(host),
        ...inputMount,
        input.image.imageId,
        "/np/project",
        "/np/output",
        "/usr/local/bin/node",
        "/opt/np/driver/site-build-render-driver.js",
        "18080",
        "15432",
        "/np/audit/result.json",
      ]);
      created = true;
      assertSiteBuildObservationActiveV1(input);
      const containment = (
        await successful(host, [
          "inspect",
          name,
          "--format",
          "{{.HostConfig.PidMode}}|{{.HostConfig.IpcMode}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}",
        ])
      )
        .toString()
        .trim();
      if (containment !== "|private|none|true|false") throw new SiteBuildError("unavailable");
      assertSiteBuildObservationActiveV1(input);
      const execution = await runSiteBuildDockerV1(host, ["start", "--attach", name], {
        timeoutMs: 315_000,
        bytes: 16 * 1024,
      });
      assertSiteBuildObservationActiveV1(input);
      if (execution.stdout.length > 8192 || execution.stderr.length)
        throw new SiteBuildError("unavailable");
      const audit: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(execution.stdout),
      );
      if (audit === null || typeof audit !== "object" || Array.isArray(audit))
        throw new SiteBuildError("unavailable");
      const record = audit as NpSiteBuildLinuxAuditV1;
      const saved = await successful(
        host,
        ["cp", `${name}:/np/audit/result.json`, "-"],
        30_000,
        32 * 1024,
      );
      if (
        !Buffer.from(readSiteBuildSandboxArtifactV1(saved, "result.json", 8192)).equals(
          execution.stdout,
        )
      )
        throw new SiteBuildError("unavailable");
      const failObserved = async (): Promise<never> => {
        let driverStage: string | null = null;
        let browserPhase: string | null = null;
        let browserDiagnostic: SiteBuildLinuxSandboxFailureV1["browserDiagnostic"] = null;
        let previewHttpDiagnostic: NpSiteBuildPreviewHttpDiagnosticV1 | null = null;
        let applicationDiagnostic: NpSiteBuildApplicationErrorDiagnosticV1 | null = null;
        try {
          const observed = await successful(
            host,
            ["cp", `${name}:/np/output/driver-result.json`, "-"],
            30_000,
            32 * 1024,
          );
          const body: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              readSiteBuildSandboxArtifactV1(observed, "driver-result.json", 8192),
            ),
          );
          if (body !== null && typeof body === "object" && !Array.isArray(body)) {
            previewHttpDiagnostic = requireSiteBuildPreviewHttpDiagnosticV1(
              (body as Record<string, unknown>).previewHttpDiagnostic,
            );
            const stage = (body as Record<string, unknown>).stage;
            if (
              typeof stage === "string" &&
              [
                "worker",
                "database",
                "fixture",
                "server",
                "prewarm",
                "audience",
                "browser",
                "catalog",
                "blueprint",
                "candidate",
                "projection",
                "render",
              ].includes(stage)
            )
              driverStage = stage;
            const browser = (body as Record<string, unknown>).browserPhase;
            if (
              typeof browser === "string" &&
              [
                "input",
                "launch",
                "protocol",
                "configure",
                "navigate",
                "network-idle",
                "fonts",
                "checks",
                "freeze",
                "screenshot",
                "close",
              ].includes(browser)
            )
              browserPhase = browser;
            browserDiagnostic = projectSiteBuildBrowserDiagnosticV1(
              (body as Record<string, unknown>).browserDiagnostic,
            );
          }
        } catch {
          /* Native failures may occur before a fixed driver result exists. */
        }
        if (browserPhase === null) {
          try {
            const observed = await successful(
              host,
              ["cp", `${name}:/np/output/browser-progress.json`, "-"],
              30_000,
              32 * 1024,
            );
            const progress: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                readSiteBuildSandboxArtifactV1(observed, "browser-progress.json", 8192),
              ),
            );
            if (progress !== null && typeof progress === "object" && !Array.isArray(progress)) {
              const row = progress as Record<string, unknown>;
              if (
                row.schemaVersion === "np.site-build-browser-progress.v1" &&
                typeof row.phase === "string" &&
                [
                  "input",
                  "launch",
                  "protocol",
                  "configure",
                  "navigate",
                  "network-idle",
                  "fonts",
                  "checks",
                  "freeze",
                  "screenshot",
                  "close",
                ].includes(row.phase)
              ) {
                browserPhase = row.phase;
                driverStage ??= "browser";
                browserDiagnostic ??= projectSiteBuildBrowserDiagnosticV1(row);
              }
            }
          } catch {
            /* A killed driver may have no completed diagnostic write. */
          }
        }
        let fixtureStage: string | null = null;
        let fixtureReason: string | null = null;
        let fixtureLocation: { owner: string; line: number } | null = null;
        try {
          const observed = await successful(
            host,
            ["cp", `${name}:/np/output/fixture-result.json`, "-"],
            30_000,
            32 * 1024,
          );
          const body: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              readSiteBuildSandboxArtifactV1(observed, "fixture-result.json", 1024),
            ),
          );
          if (body !== null && typeof body === "object" && !Array.isArray(body)) {
            const stage = (body as Record<string, unknown>).stage;
            if (
              typeof stage === "string" &&
              [
                "input",
                "config-import",
                "catalog",
                "blueprint",
                "candidate-owners",
                "candidate-baseline",
                "candidate",
                "repository-seed",
                "projection",
                "migration-driver",
                "migration-read",
                "migration-connect",
                "migration-apply",
                "bootstrap-import",
                "bootstrap",
                "site-settings",
                "principal",
                "member-principal",
                "member-session",
                "theme",
                "documents",
                "navigation",
                "seed-reconciliation",
                "seed-materialization",
                "doctor-environment",
                "doctor",
                "shutdown",
              ].includes(stage)
            )
              fixtureStage = stage;
            const reason = (body as Record<string, unknown>).reason;
            if (
              typeof reason === "string" &&
              [
                "missing-relation",
                "missing-column",
                "missing-object",
                "duplicate-object",
                "duplicate-relation",
                "foreign-key",
                "unique-constraint",
                "check-constraint",
                "database-permission",
                "database-file",
                "database-disk",
                "database-memory",
                "database-cancelled",
                "database-connection",
                "missing-file",
                "file-permission",
                "readonly-file",
                "invalid-argument",
                "database-other",
                "type-error",
                "range-error",
                "migration-journal",
                "migration-file",
                "database-reset",
                "database-pipe",
                "database-timeout",
                "database-terminated",
                "database-unqueryable",
                "missing-module",
                "package-export",
                "module-extension",
                "reference-error",
                "syntax-error",
                "module-boundary",
              ].includes(reason)
            )
              fixtureReason = reason;
            const location = (body as Record<string, unknown>).location;
            if (location !== null && typeof location === "object" && !Array.isArray(location)) {
              const { owner, line } = location as Record<string, unknown>;
              if (
                typeof owner === "string" &&
                [
                  "drizzle-driver",
                  "drizzle-session",
                  "drizzle-dialect",
                  "drizzle-migration-loader",
                  "postgres-client",
                  "postgres-parser",
                  "worker",
                  "loader",
                ].includes(owner) &&
                typeof line === "number" &&
                Number.isSafeInteger(line) &&
                line > 0 &&
                line <= 10000
              )
                fixtureLocation = { owner, line };
            }
          }
        } catch {
          /* A native failure can precede the fixed worker's result. */
        }
        try {
          // The supervisor has finished before this read, so an optional reporter
          // cannot race the artifact reader. Metadata never changes the outcome.
          const observed = await successful(
            host,
            ["cp", `${name}:/np/output/application-error-diagnostic.json`, "-"],
            30_000,
            16 * 1024,
          );
          applicationDiagnostic = projectSiteBuildApplicationErrorDiagnosticV1(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                readSiteBuildSandboxArtifactV1(observed, "application-error-diagnostic.json", 4096),
              ),
            ),
          );
        } catch {
          // Most hosts do not install a reporter; missing or invalid data is unknown.
        }
        throw new SiteBuildLinuxSandboxFailureV1(
          record,
          driverStage,
          fixtureStage,
          fixtureReason,
          fixtureLocation,
          browserPhase,
          browserDiagnostic,
          previewHttpDiagnostic,
          applicationDiagnostic,
        );
      };
      if (
        execution.code !== 0 ||
        record.schemaVersion !== "np.site-build-linux-audit.v1" ||
        record.status !== "passed" ||
        record.reason !== "none" ||
        record.rootExitCode !== 0 ||
        record.rootSignal !== 0 ||
        record.forbiddenAttempts !== 0 ||
        record.argumentsFrozen !== true ||
        record.descendantsReaped !== true ||
        record.ownIpcReclaimed !== true ||
        !Number.isSafeInteger(record.tracedProcesses) ||
        record.tracedProcesses < 1 ||
        record.tracedProcesses !== record.reapedProcesses
      )
        await failObserved();
      const artifacts = new Map<string, Uint8Array>();
      for (const file of input.artifacts) {
        assertSiteBuildObservationActiveV1(input);
        const archive = await successful(
          host,
          ["cp", `${name}:/np/output/${file.name}`, "-"],
          30_000,
          file.maxBytes + 32 * 1024,
        );
        artifacts.set(file.name, readSiteBuildSandboxArtifactV1(archive, file.name, file.maxBytes));
      }
      return { audit: record, artifacts };
    } finally {
      await cleanup();
      assertSiteBuildObservationActiveV1(input);
    }
  });
}
