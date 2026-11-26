import {
  npBuildCanonicalDigest,
  npBuildInstalledCatalogDigestV1,
  npParseBuildInstalledCatalogJsonV1,
  npRequireAgentBuildDirectionRendererV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentBuildInstalledCatalogV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { withSiteBuildDockerV1 } from "./docker-host.js";
import { prepareSiteBuildRendererBaseV1 } from "./renderer-image.js";
import {
  observeSiteBuildLinuxProjectInputsV1,
  prepareSiteBuildLinuxProjectV1,
  type NpPreparedSiteBuildLinuxProjectV1,
} from "./linux-project.js";
import {
  prepareSiteBuildLinuxBuildV1,
  type NpSiteBuildLinuxBuildReceiptV1,
} from "./linux-build.js";
import {
  freezePreparedSiteBuildRenderProjectV1,
  type NpFrozenPreparedSiteBuildRenderProjectV1,
} from "./render-capsule.js";
import {
  createSiteBuildRenderRuntimeCacheV1,
  detachSiteBuildRuntimeJsonV1,
  reuseSiteBuildRenderRuntimeCacheV1,
  siteBuildRuntimeJsonDigestV1,
  type NpSiteBuildRenderRuntimeCacheV1,
} from "./render-runtime-cache.js";
import {
  prepareSiteBuildLinuxSandboxImageV1,
  runSiteBuildLinuxSandboxV1,
} from "./linux-sandbox.js";

export interface Clock {
  now: string;
  randomSeed: string;
}
interface BuildSummary {
  schemaVersion: "np.site-build-render-build-summary.v1";
  buildId: string;
  migrations: "generated-private-baseline" | "preserved-existing";
  changedSourceFiles: number;
  artifactManifestSha256: string;
  commands: Array<{
    id: "schema-generate" | "migration-generate" | "next-build";
    exitCode: 0;
    stdoutSha256: string;
    stderrSha256: string;
  }>;
  previewConfig?: {
    scope: "forum-build-preview-analytics-only";
    rendererStage: "pre-command-source-and-prepared-linux-packages";
    preCommandSourceDigest: string;
    preCommandRendererDigest: string;
    finalSourceDigest: string;
    runtimeManifestSha256: string;
  };
  nextPreviewRuntime?: {
    scope: "private-preview-next-isr-flush-to-disk-false";
    ownerVersion: "16.3.4" | "16.4.2";
    ownerContentDigest: string;
    originalEntrySha256: string;
    derivedEntrySha256: string;
    requiredServerFilesSha256: string;
    runtimeManifestSha256: string;
    nativeVerification: "required-separately";
  };
}
export interface NpSiteBuildRenderSessionV1 {
  schemaVersion: "np.site-build-render-session.v1";
  config: string;
  cache: NpSiteBuildRenderRuntimeCacheV1;
  renderer: NpAgentBuildDirectionRendererV1;
  clock: Clock;
  /** Diagnostic summary only; reuse never treats command/hash claims as execution evidence. */
  buildReceiptSummary?: BuildSummary;
}

function keys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new SiteBuildError("input");
}
function configPath(value: unknown): string {
  if (typeof value !== "string" || !/^(?:src\/)?nexpress\.config\.[cm]?[jt]s$/u.test(value))
    throw new SiteBuildError("input");
  return value;
}
function clockValue(value: unknown): Clock {
  const clock = detachSiteBuildRuntimeJsonV1(value);
  keys(clock, ["now", "randomSeed"]);
  if (
    typeof clock.now !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(clock.now) ||
    !Number.isFinite(Date.parse(clock.now)) ||
    new Date(clock.now).toISOString() !== clock.now ||
    typeof clock.randomSeed !== "string" ||
    !/^[a-f0-9]{64}$/u.test(clock.randomSeed)
  )
    throw new SiteBuildError("input");
  return { now: clock.now, randomSeed: clock.randomSeed };
}
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function buildSummaryValue(value: unknown): BuildSummary {
  const body = detachSiteBuildRuntimeJsonV1(value);
  keys(
    body,
    [
      "schemaVersion",
      "buildId",
      "migrations",
      "changedSourceFiles",
      "artifactManifestSha256",
      "commands",
    ],
    ["previewConfig", "nextPreviewRuntime"],
  );
  if (
    body.schemaVersion !== "np.site-build-render-build-summary.v1" ||
    typeof body.buildId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(body.buildId) ||
    !["generated-private-baseline", "preserved-existing"].includes(String(body.migrations)) ||
    typeof body.changedSourceFiles !== "number" ||
    !Number.isSafeInteger(body.changedSourceFiles) ||
    body.changedSourceFiles < 0 ||
    body.changedSourceFiles > 10000 ||
    !sha256(body.artifactManifestSha256) ||
    !Array.isArray(body.commands) ||
    body.commands.length !== 3
  )
    throw new SiteBuildError("input");
  const ids = ["schema-generate", "migration-generate", "next-build"] as const;
  const commands = body.commands.map((value: unknown, index) => {
    const row = detachSiteBuildRuntimeJsonV1(value);
    keys(row, ["id", "exitCode", "stdoutSha256", "stderrSha256"]);
    if (
      row.id !== ids[index] ||
      row.exitCode !== 0 ||
      !sha256(row.stdoutSha256) ||
      !sha256(row.stderrSha256)
    )
      throw new SiteBuildError("input");
    return {
      id: ids[index],
      exitCode: 0 as const,
      stdoutSha256: row.stdoutSha256,
      stderrSha256: row.stderrSha256,
    };
  });
  let previewConfig: BuildSummary["previewConfig"];
  if (body.previewConfig !== undefined) {
    const preview = detachSiteBuildRuntimeJsonV1(body.previewConfig);
    keys(preview, [
      "scope",
      "rendererStage",
      "preCommandSourceDigest",
      "preCommandRendererDigest",
      "finalSourceDigest",
      "runtimeManifestSha256",
    ]);
    if (
      preview.scope !== "forum-build-preview-analytics-only" ||
      preview.rendererStage !== "pre-command-source-and-prepared-linux-packages" ||
      !sha256(preview.runtimeManifestSha256) ||
      [
        preview.preCommandSourceDigest,
        preview.preCommandRendererDigest,
        preview.finalSourceDigest,
      ].some((value) => typeof value !== "string" || !/^nb1:sha256:[A-Za-z0-9_-]{43}$/u.test(value))
    )
      throw new SiteBuildError("input");
    previewConfig = {
      scope: "forum-build-preview-analytics-only",
      rendererStage: "pre-command-source-and-prepared-linux-packages",
      preCommandSourceDigest: String(preview.preCommandSourceDigest),
      preCommandRendererDigest: String(preview.preCommandRendererDigest),
      finalSourceDigest: String(preview.finalSourceDigest),
      runtimeManifestSha256: preview.runtimeManifestSha256,
    };
  }
  let nextPreviewRuntime: BuildSummary["nextPreviewRuntime"];
  if (body.nextPreviewRuntime !== undefined) {
    const runtime = detachSiteBuildRuntimeJsonV1(body.nextPreviewRuntime);
    keys(runtime, [
      "scope",
      "ownerVersion",
      "ownerContentDigest",
      "originalEntrySha256",
      "derivedEntrySha256",
      "requiredServerFilesSha256",
      "runtimeManifestSha256",
      "nativeVerification",
    ]);
    if (
      runtime.scope !== "private-preview-next-isr-flush-to-disk-false" ||
      (runtime.ownerVersion !== "16.3.4" && runtime.ownerVersion !== "16.4.2") ||
      typeof runtime.ownerContentDigest !== "string" ||
      !/^npkg1:sha256:[A-Za-z0-9_-]{43}$/u.test(runtime.ownerContentDigest) ||
      !sha256(runtime.originalEntrySha256) ||
      !sha256(runtime.derivedEntrySha256) ||
      !sha256(runtime.requiredServerFilesSha256) ||
      !sha256(runtime.runtimeManifestSha256) ||
      runtime.nativeVerification !== "required-separately"
    )
      throw new SiteBuildError("input");
    nextPreviewRuntime = {
      scope: "private-preview-next-isr-flush-to-disk-false",
      ownerVersion: runtime.ownerVersion,
      ownerContentDigest: runtime.ownerContentDigest,
      originalEntrySha256: runtime.originalEntrySha256,
      derivedEntrySha256: runtime.derivedEntrySha256,
      requiredServerFilesSha256: runtime.requiredServerFilesSha256,
      runtimeManifestSha256: runtime.runtimeManifestSha256,
      nativeVerification: "required-separately",
    };
  }
  return {
    schemaVersion: "np.site-build-render-build-summary.v1",
    buildId: body.buildId,
    migrations:
      body.migrations === "generated-private-baseline"
        ? "generated-private-baseline"
        : "preserved-existing",
    changedSourceFiles: body.changedSourceFiles,
    artifactManifestSha256: body.artifactManifestSha256,
    commands,
    ...(previewConfig ? { previewConfig } : {}),
    ...(nextPreviewRuntime ? { nextPreviewRuntime } : {}),
  };
}
function requireBuildSummaryPackages(
  summary: BuildSummary | undefined,
  packages: NpAgentBuildDirectionRendererV1["packages"],
): void {
  const runtime = summary?.nextPreviewRuntime;
  if (
    runtime &&
    !packages.some(
      (item) =>
        item.name === "next" &&
        item.version === runtime.ownerVersion &&
        item.contentDigest === runtime.ownerContentDigest,
    )
  )
    throw new SiteBuildError("conflict");
}
function sessionValue(value: unknown) {
  const body = detachSiteBuildRuntimeJsonV1(value);
  keys(body, ["schemaVersion", "config", "cache", "renderer", "clock"], ["buildReceiptSummary"]);
  if (body.schemaVersion !== "np.site-build-render-session.v1") throw new SiteBuildError("input");
  const session = {
    schemaVersion: "np.site-build-render-session.v1" as const,
    config: configPath(body.config),
    cache: body.cache,
    renderer: npRequireAgentBuildDirectionRendererV1(body.renderer),
    clock: clockValue(body.clock),
    ...(body.buildReceiptSummary === undefined
      ? {}
      : { buildReceiptSummary: buildSummaryValue(body.buildReceiptSummary) }),
  };
  requireBuildSummaryPackages(session.buildReceiptSummary, session.renderer.packages);
  return session;
}
function summarizeBuild(receipt: NpSiteBuildLinuxBuildReceiptV1): BuildSummary {
  return buildSummaryValue({
    schemaVersion: "np.site-build-render-build-summary.v1",
    buildId: receipt.buildId,
    migrations: receipt.migrations,
    changedSourceFiles: receipt.changedSources.length,
    artifactManifestSha256: receipt.artifactManifestSha256,
    commands: receipt.commands.map((command) => ({
      id: command.id,
      exitCode: command.exitCode,
      stdoutSha256: command.stdout.sha256,
      stderrSha256: command.stderr.sha256,
    })),
    ...(receipt.previewConfig
      ? {
          previewConfig: {
            scope: receipt.previewConfig.scope,
            rendererStage: receipt.previewConfig.rendererStage,
            preCommandSourceDigest: receipt.previewConfig.preCommandSourceDigest,
            preCommandRendererDigest: receipt.previewConfig.preCommandRendererDigest,
            finalSourceDigest: receipt.previewConfig.finalSourceDigest,
            runtimeManifestSha256: receipt.previewConfig.runtimeManifestSha256,
          },
        }
      : {}),
    ...(receipt.nextPreviewRuntime
      ? {
          nextPreviewRuntime: {
            scope: receipt.nextPreviewRuntime.scope,
            ownerVersion: receipt.nextPreviewRuntime.owner.version,
            ownerContentDigest: receipt.nextPreviewRuntime.owner.contentDigest,
            originalEntrySha256: receipt.nextPreviewRuntime.entry.original.sha256,
            derivedEntrySha256: receipt.nextPreviewRuntime.entry.derived.sha256,
            requiredServerFilesSha256: receipt.nextPreviewRuntime.requiredServerFiles.sha256,
            runtimeManifestSha256: receipt.nextPreviewRuntime.evidence.find(
              (item) => item.path === ".next/np-build-next-preview-runtime/manifest.json",
            )?.sha256,
            nativeVerification: receipt.nextPreviewRuntime.nativeVerification,
          },
        }
      : {}),
  });
}

/** Explicit preparation. The native result is a declaration catalog, never a rendered direction. */
export async function prepareSiteBuildRenderSessionV1(options: {
  projectRoot: string;
  config: string;
  fixtures: Array<{ path: string; bytes: Uint8Array }>;
  clock: Clock;
}): Promise<{
  session: NpSiteBuildRenderSessionV1;
  catalog: NpAgentBuildInstalledCatalogV1;
  fingerprint: string;
  /** Caller must close if create-only publication fails; successful publication retains the capsule. */
  close(): Promise<void>;
}> {
  const projectRoot = options.projectRoot,
    config = configPath(options.config),
    clock = clockValue(options.clock);
  if (options.fixtures.length > 200) throw new SiteBuildError("input");
  let fixtureBytes = 0;
  const fixtures = options.fixtures.map((fixture) => {
    if (
      !/^\.nexpress\/site\/fixtures\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(fixture.path) ||
      !(fixture.bytes instanceof Uint8Array) ||
      fixture.bytes.byteLength > 512 * 1024 * 1024 ||
      (fixtureBytes += fixture.bytes.byteLength) > 4 * 1024 * 1024 * 1024
    )
      throw new SiteBuildError("input");
    return { path: fixture.path, bytes: Buffer.from(fixture.bytes) };
  });
  let prepared: NpPreparedSiteBuildLinuxProjectV1 | undefined;
  let capsule: NpFrozenPreparedSiteBuildRenderProjectV1 | undefined;
  let retained = false;
  let result: Awaited<ReturnType<typeof prepareSiteBuildRenderSessionV1>> | undefined;
  let failure: Error | undefined;
  let cleanupFailed = false;
  try {
    const originInputs = await observeSiteBuildLinuxProjectInputsV1(projectRoot);
    const base = await prepareSiteBuildRendererBaseV1();
    prepared = await withSiteBuildDockerV1(async (host) => {
      const owned = await prepareSiteBuildLinuxProjectV1({
        projectRoot,
        imageId: base.imageId,
        dockerEndpoint: host.endpoint,
        dockerConfig: host.config,
      });
      // Capture ownership before the Docker wrapper cleans its own temporary config.
      prepared = owned;
      return owned;
    });
    const receipt = prepared.receipt;
    if (
      receipt.imageId !== base.imageId ||
      receipt.sourceManifestSha256 !== originInputs.sourceManifestSha256 ||
      receipt.sourceLockSha256 !== originInputs.sourceLockSha256 ||
      receipt.sourceTreeDigest !== originInputs.sourceTreeDigest ||
      siteBuildRuntimeJsonDigestV1(
        receipt.tarballs.map(({ reference, sha256, bytes }) => ({ reference, sha256, bytes })),
      ) !== siteBuildRuntimeJsonDigestV1(originInputs.tarballs)
    )
      throw new SiteBuildError("conflict");
    await prepared.assertSourceUnchanged();
    const build = await prepareSiteBuildLinuxBuildV1({
      project: prepared.project,
      baseImageId: base.imageId,
      previewConfig: "forum-build-preview-analytics-only",
      deterministicNextClock: clock,
    });
    if (
      !build.previewConfig ||
      !build.nextPreviewRuntime ||
      !build.deterministicNext ||
      build.deterministicNext.preparation.context.baseImageId !== base.imageId ||
      JSON.stringify(build.deterministicNext.preparation.context.clock) !== JSON.stringify(clock) ||
      build.deterministicNext.preparation.buildId !== build.buildId ||
      build.previewConfig.preparation.configPath !== config ||
      build.previewConfig.finalSourceDigest !== build.sourceAfter.digest
    )
      throw new SiteBuildError("conflict");
    const buildSummary = summarizeBuild(build);
    requireBuildSummaryPackages(buildSummary, prepared.receipt.packages);
    await prepared.assertSourceUnchanged();
    const input = { mode: "catalog", config, clockNow: clock.now, randomSeed: clock.randomSeed };
    capsule = await freezePreparedSiteBuildRenderProjectV1({
      project: prepared.project,
      originInputs,
      fixtures,
      input,
    });
    const observed = await createSiteBuildRenderRuntimeCacheV1({
      project: capsule.project,
      originalProjectRoot: projectRoot,
    });
    if (
      siteBuildRuntimeJsonDigestV1(capsule.renderer) !==
        siteBuildRuntimeJsonDigestV1(observed.renderer) ||
      capsule.runtimeFilesDigest !== observed.cache.runtimeFilesDigest
    )
      throw new SiteBuildError("conflict");
    requireBuildSummaryPackages(buildSummary, observed.renderer.packages);
    const image = await prepareSiteBuildLinuxSandboxImageV1();
    if (image.baseImageId !== base.imageId) throw new SiteBuildError("conflict");
    await observed.assertUnchanged();
    const execution = await runSiteBuildLinuxSandboxV1({
      image,
      project: capsule.project,
      inputBytes: Buffer.from(JSON.stringify({ ...input, renderer: observed.renderer })),
      artifacts: [{ name: "catalog.json", maxBytes: 4 * 1024 * 1024 }],
    });
    const bytes = execution.artifacts.get("catalog.json");
    if (!bytes) throw new SiteBuildError("unavailable");
    const catalog = npParseBuildInstalledCatalogJsonV1(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      (await npBuildCanonicalDigest("np.build-direction-renderer.v1", catalog.sourceCapsule)) !==
      (await npBuildCanonicalDigest("np.build-direction-renderer.v1", observed.renderer))
    )
      throw new SiteBuildError("conflict");
    const fingerprint = await npBuildInstalledCatalogDigestV1(catalog);
    await observed.assertUnchanged();
    await capsule.assertOriginalUnchanged();
    const session: NpSiteBuildRenderSessionV1 = {
      schemaVersion: "np.site-build-render-session.v1",
      config,
      cache: observed.cache,
      renderer: observed.renderer,
      clock,
      buildReceiptSummary: buildSummary,
    };
    await prepared.close();
    prepared = undefined;
    const ownedCapsule = capsule;
    retained = true;
    result = { session, catalog, fingerprint, close: () => ownedCapsule.close() };
  } catch (error) {
    failure = error instanceof Error ? error : new SiteBuildError("unavailable");
  } finally {
    if (prepared) {
      try {
        await prepared.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (!retained && capsule) {
      try {
        await capsule.close();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) throw new SiteBuildError("unavailable");
  if (failure) throw failure;
  if (!result) throw new SiteBuildError("unavailable");
  return result;
}

/** JSON is a locator/byte claim only. The caller still compares sealed render/approval bindings. */
export async function reuseSiteBuildRenderSessionV1(options: {
  session: unknown;
  projectRoot: string;
  /** Actual original package/lock owner for a relocated private packed copy. */
  tarballProjectRoot?: string;
}) {
  try {
    const session = sessionValue(options.session);
    const observed = await reuseSiteBuildRenderRuntimeCacheV1({
      cache: session.cache,
      originalProjectRoot: options.projectRoot,
      expectedRenderer: session.renderer,
      tarballProjectRoot: options.tarballProjectRoot,
    });
    return {
      config: session.config,
      clock: session.clock,
      installedPackages: observed.installedPackages,
      capsule: {
        project: observed.cache.project,
        renderer: observed.renderer,
        runtimeFilesDigest: observed.cache.runtimeFilesDigest,
        assertOriginalUnchanged: () => observed.assertUnchanged(),
      },
    };
  } catch (error) {
    if (error instanceof SiteBuildError) throw error;
    throw new SiteBuildError("input");
  }
}
