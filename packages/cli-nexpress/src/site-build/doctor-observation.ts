import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npParseBuildJsonV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  type NpAgentBuildRenderEnvironmentV1,
} from "@nexpress/core/agent-contract";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import type {
  NpSiteBuildCommandObservedEvidenceV1,
  NpSiteBuildCommandObserverContextV1,
} from "./command-executor.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxSandboxImageV1,
} from "./linux-sandbox.js";
import { assertSiteBuildObservationActiveV1 } from "./observation-deadline.js";
import type { NpFrozenPreparedSiteBuildRenderProjectV1 } from "./render-capsule.js";
import { publishSiteBuildGeneratorAuditV1 } from "./render-artifacts.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason: "input" | "conflict" | "unavailable" = "input"): never => {
  throw new SiteBuildError(reason);
};
const same = isDeepStrictEqual;
const REPORT_LIMIT = 256 * 1024;
const SEED_LIMIT = 1024 * 1024;
const OUTPUT_LIMIT = 768 * 1024;
type Check = {
  id: string;
  state: "ok" | "warn" | "error";
  label: string;
  detail?: string;
  hint?: string;
  pluginIds?: string[];
};
interface DoctorReport {
  schemaVersion: "np.doctor.v1";
  ok: boolean;
  blocksDeploy: boolean;
  nextCommand: string | null;
  projectNextCommand: string | null;
  mode: "dev";
  target: null;
  summary: { total: number; errors: number; warnings: number };
  checks: Check[];
}
type Artifact = { path: string; bytes: Uint8Array; sha256: string };
export interface NpSiteBuildDoctorObservationV1 extends NpSiteBuildCommandObservedEvidenceV1 {
  artifacts: {
    report: Artifact;
    seedMaterialization: Artifact;
    nativeAudit: Artifact;
    commandOutput: Artifact;
  };
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    return fail();
  return row;
}
function text(value: unknown, limit = 16_384): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value) <= limit &&
    !value.includes("\0")
  );
}
function json(bytes: Uint8Array, maximum: number): unknown {
  if (!bytes.length || bytes.length > maximum) return fail();
  try {
    return npParseBuildJsonV1(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail();
  }
}
function doctorReport(bytes: Uint8Array): DoctorReport {
  const report = record(json(bytes, REPORT_LIMIT), [
    "schemaVersion",
    "ok",
    "blocksDeploy",
    "nextCommand",
    "projectNextCommand",
    "mode",
    "target",
    "summary",
    "checks",
  ]);
  if (
    report.schemaVersion !== "np.doctor.v1" ||
    report.mode !== "dev" ||
    report.target !== null ||
    !Array.isArray(report.checks) ||
    !report.checks.length ||
    report.checks.length > 128 ||
    ![report.nextCommand, report.projectNextCommand].every(
      (value) => value === null || text(value, 1024),
    )
  )
    return fail();
  const ids = new Set<string>();
  const checks: Check[] = report.checks.map((value: unknown) => {
    const row = record(value, ["id", "state", "label"], ["detail", "hint", "pluginIds"]);
    if (
      !text(row.id, 128) ||
      !/^[a-zA-Z0-9._-]+$/u.test(row.id) ||
      ids.has(row.id) ||
      !text(row.label) ||
      !["ok", "warn", "error"].includes(String(row.state)) ||
      [row.detail, row.hint].some((value) => value !== undefined && !text(value)) ||
      (row.pluginIds !== undefined &&
        (!Array.isArray(row.pluginIds) ||
          row.pluginIds.length > 128 ||
          row.pluginIds.some((value) => !text(value, 128))))
    )
      return fail();
    ids.add(row.id);
    return row as Check;
  });
  const summary = record(report.summary, ["total", "errors", "warnings"]);
  const errors = checks.filter((check) => check.state === "error").length;
  const warnings = checks.filter((check) => check.state === "warn").length;
  if (
    summary.total !== checks.length ||
    summary.errors !== errors ||
    summary.warnings !== warnings ||
    report.ok !== (errors === 0) ||
    report.blocksDeploy !== errors > 0
  )
    return fail();
  // Missing/unknown core checks cannot masquerade as a successfully run Doctor.
  for (const id of [
    "node.version",
    "env.file",
    "env.database_url",
    "env.np_secret",
    "env.site_url",
    "routes.contract",
    "i18n.contract",
    "storage.contract",
    "storage.local_directory",
    "database.reachable",
    "auth.contract",
    "settings.contract",
    "collections.contract",
    "migrations.applied",
  ])
    if (!ids.has(id)) return fail();
  const environment = checks.find((check) => check.id === "env.file")!;
  if (
    environment.label !== "Explicit environment input file present" ||
    (environment.state === "ok" && environment.detail !== "custom environment input")
  )
    return fail();
  return report as unknown as DoctorReport;
}

/**
 * Trusted in-process native Doctor owner. The caller supplies the actual current
 * catalog-derived drafts and candidate-to-runtime source mapping lease; JSON alone
 * establishes neither. Every run uses a fresh private DB, ordinary App checks,
 * explicit synthetic environment input and native reaping. No browser is launched.
 * Report errors/warnings are retained unchanged. This owner publishes audit bytes,
 * never repository source, production configuration or execution authority.
 */
export async function observePreparedSiteBuildDoctorV1(options: {
  context: NpSiteBuildCommandObserverContextV1;
  brief: unknown;
  drafts: unknown;
  selectedDirectionId: string;
  config: string;
  capsule: Pick<
    NpFrozenPreparedSiteBuildRenderProjectV1,
    "project" | "renderer" | "runtimeFilesDigest" | "assertOriginalUnchanged"
  >;
  image: NpSiteBuildLinuxSandboxImageV1;
  environment: NpAgentBuildRenderEnvironmentV1;
}): Promise<NpSiteBuildDoctorObservationV1> {
  const context = options.context;
  assertSiteBuildObservationActiveV1(context);
  if (
    context.command.template !== "doctor" ||
    context.command.production ||
    context.command.target !== null
  )
    return fail("unavailable");
  const brief = npRequireBuildReadyBriefV1(options.brief);
  const blueprint = await npRequireBuildBlueprintForBriefV1(brief, context.blueprint);
  const drafts = await npRequireBuildDirectionSetForBriefV1(brief, options.drafts, "draft");
  const renderer = npRequireAgentBuildDirectionRendererV1(options.capsule.renderer);
  const environment = npRequireAgentBuildRenderEnvironmentV1(options.environment);
  const command = blueprint.commands.find((entry) => entry.id === context.command.id);
  const preview = blueprint.commands.find((entry) => entry.template === "preview-render");
  const selected = drafts.directions.find((entry) => entry.id === options.selectedDirectionId);
  if (
    !command ||
    command.template !== "doctor" ||
    command.production ||
    command.target !== null ||
    !same(command, context.command) ||
    !preview ||
    !selected ||
    options.selectedDirectionId !== blueprint.selectedDirectionId ||
    !/^(?:src\/)?nexpress\.config\.[cm]?[jt]s$/u.test(options.config)
  )
    return fail("unavailable");
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const projection = {
    ...npBuildDirectionProjectionV1(selected),
    discoveryFingerprint: blueprint.discoveryFingerprint,
    comparisonInputsDigest: preview.comparisonInputsDigest,
  };
  if (
    blueprintHash !== context.blueprintHash ||
    (await npBuildCanonicalDigest("np.build-design-direction-projection.v1", projection)) !==
      blueprint.selectedDirectionProjectionDigest ||
    (await npBuildCanonicalDigest("np.build-render-environment.v1", environment)) !==
      preview.renderEnvironmentFingerprint
  )
    return fail("conflict");
  const project = await realpath(context.project);
  const frozenProject = options.capsule.project,
    runtime = options.capsule.runtimeFilesDigest;
  const imageSnapshot = encode(options.image),
    rendererSnapshot = encode(renderer);
  const checkLive = async (checkBudget = true) => {
    if (checkBudget) assertSiteBuildObservationActiveV1(context);
    await options.capsule.assertOriginalUnchanged();
    const current = await readSiteSourceTreeV1(project);
    if (
      current.digest !== context.source.digest ||
      !same(current.manifest, context.source.manifest) ||
      environment.sandbox !== "np.linux-build-sandbox.v1" ||
      options.capsule.project !== frozenProject ||
      options.capsule.runtimeFilesDigest !== runtime ||
      !rendererSnapshot.equals(encode(options.capsule.renderer)) ||
      !imageSnapshot.equals(encode(options.image))
    )
      return fail("conflict");
    const linux = environment.linux,
      image = options.image;
    if (
      linux.imageId !== image.imageId ||
      linux.imageRecipeSha256 !== image.recipeDigest ||
      linux.supervisor.binarySha256 !== image.supervisorSha256 ||
      linux.supervisor.sourceSha256 !== image.supervisorSourceSha256 ||
      linux.fontconfigSha256 !== image.fontconfigSha256 ||
      !same(linux.driverFiles, image.driverFiles) ||
      linux.runtimeFilesSha256 !== runtime
    )
      return fail("conflict");
    if (checkBudget) assertSiteBuildObservationActiveV1(context);
  };
  await checkLive();
  const result = await runSiteBuildLinuxSandboxV1({
    image: options.image,
    project: frozenProject,
    signal: context.signal,
    inputBytes: encode({
      mode: "doctor",
      config: options.config,
      renderer,
      brief,
      drafts,
      blueprint,
      directionId: selected.id,
      clockNow: environment.clock.now,
      randomSeed: environment.clock.randomSeed,
    }),
    artifacts: [
      { name: "doctor-report.json", maxBytes: REPORT_LIMIT },
      { name: "doctor-command-output.json", maxBytes: OUTPUT_LIMIT },
      { name: "seed-materialization.json", maxBytes: SEED_LIMIT },
    ],
  });
  await checkLive();
  const audit = result.audit;
  if (
    audit.status !== "passed" ||
    audit.rootExitCode !== 0 ||
    audit.rootSignal !== 0 ||
    audit.forbiddenAttempts !== 0 ||
    !audit.descendantsReaped ||
    !audit.argumentsFrozen ||
    !audit.ownIpcReclaimed ||
    audit.tracedProcesses < 1 ||
    audit.tracedProcesses !== audit.reapedProcesses
  )
    return fail("unavailable");
  const reportBytes = result.artifacts.get("doctor-report.json"),
    outputBytes = result.artifacts.get("doctor-command-output.json"),
    seedBytes = result.artifacts.get("seed-materialization.json");
  if (result.artifacts.size !== 3 || !reportBytes || !outputBytes || !seedBytes) return fail();
  const report = doctorReport(reportBytes);
  const commandOutput = npRequireAgentBuildCommandOutputV1(json(outputBytes, OUTPUT_LIMIT));
  const stdout = Buffer.from(commandOutput.stdout.base64url, "base64url");
  if (
    commandOutput.stdout.truncated ||
    commandOutput.stderr.truncated ||
    !stdout
      .subarray(-reportBytes.length - 1)
      .equals(Buffer.concat([Buffer.from(reportBytes), Buffer.from("\n")]))
  )
    return fail();
  const seed = record(json(seedBytes, SEED_LIMIT), [
    "scope",
    "documents",
    "theme",
    "navigation",
    "media",
    "transaction",
    "pendingCacheInvalidations",
    "cacheInvalidations",
  ]);
  const documents = record(seed.documents, ["created", "unchanged"]),
    navigation = record(seed.navigation, ["created", "unchanged"]),
    media = record(seed.media, ["staged", "referenceOnlyRetained", "fetched", "uploaded"]);
  const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  if (
    seed.scope !== "ordinary-site-build-seed" ||
    !same(
      documents.created,
      blueprint.seed.documents.map((entry) => entry.documentId),
    ) ||
    !same(documents.unchanged, []) ||
    !["written", "unchanged"].includes(String(seed.theme)) ||
    !same(navigation.created, blueprint.navigation.map((entry) => entry.location).sort(compare)) ||
    !same(navigation.unchanged, []) ||
    media.staged !== "unsupported-allocated-id-owner-required" ||
    !same(
      media.referenceOnlyRetained,
      blueprint.seed.media.map((entry) => entry.mediaId),
    ) ||
    media.fetched !== 0 ||
    media.uploaded !== 0 ||
    seed.transaction !== "individual-facade-commits" ||
    !same(seed.pendingCacheInvalidations, []) ||
    !Array.isArray(seed.cacheInvalidations)
  )
    return fail();
  const prefix = `.nexpress/site/audit/generator-doctor-${randomUUID()}`;
  const artifact = (name: string, bytes: Uint8Array): Artifact => ({
    path: `${prefix}/${name}`,
    bytes: new Uint8Array(bytes),
    sha256: sha(bytes),
  });
  const artifacts = {
    report: artifact("doctor-report.json", reportBytes),
    seedMaterialization: artifact("seed-materialization.json", seedBytes),
    nativeAudit: artifact("native-audit.json", encode(audit)),
    commandOutput: artifact("command-output.json", outputBytes),
  };
  const criticalReady = [
    "env.file",
    "database.reachable",
    "routes.contract",
    "i18n.contract",
    "collections.contract",
    "migrations.applied",
    "storage.local_directory",
  ].every((id) => report.checks.find((check) => check.id === id)?.state === "ok");
  const exitCode = report.ok && criticalReady ? 0 : 1;
  const manifest = artifact(
    "manifest.json",
    encode({
      schemaVersion: "np.site-build-native-doctor-observation.v1",
      scope: "private-synthetic-environment",
      commandId: command.id,
      blueprintHash,
      sourceTreeDigest: context.source.digest,
      rendererFingerprint: await npBuildCanonicalDigest("np.build-direction-renderer.v1", renderer),
      runtimeFilesDigest: runtime,
      renderEnvironmentFingerprint: preview.renderEnvironmentFingerprint,
      reviewedComparisonInputsDigest: preview.comparisonInputsDigest,
      currentComparisonInputsDigest: drafts.comparisonInputsDigest,
      environmentFile: "/np/output/doctor-environment.input",
      storageDirectory: "/np/output/storage",
      doctorOk: report.ok,
      criticalChecksReady: criticalReady,
      exitCode,
      artifacts: Object.values(artifacts).map(({ path, sha256, bytes }) => ({
        path,
        sha256,
        bytes: bytes.length,
      })),
    }),
  );
  await checkLive();
  await publishSiteBuildGeneratorAuditV1({
    project,
    artifacts: Object.values(artifacts).map(({ path, bytes }) => ({ path, bytes })),
    manifest: { path: manifest.path, bytes: manifest.bytes },
  });
  const files = await SiteArtifactFiles.at(project);
  const leases = await Promise.all(
    [...Object.values(artifacts), manifest].map(async (file) => {
      const identity = await lstat(join(project, file.path), { bigint: true });
      if (
        !identity.isFile() ||
        identity.isSymbolicLink() ||
        identity.nlink !== 1n ||
        !Buffer.from(await files.read(file.path, 2 * 1024 * 1024)).equals(Buffer.from(file.bytes))
      )
        return fail("conflict");
      return async () => {
        const current = await lstat(join(project, file.path), { bigint: true });
        if (
          ["dev", "ino", "mode", "size", "nlink", "mtimeNs", "ctimeNs"].some(
            (key) =>
              current[key as keyof typeof current] !== identity[key as keyof typeof identity],
          ) ||
          !Buffer.from(await files.read(file.path, 2 * 1024 * 1024)).equals(Buffer.from(file.bytes))
        )
          return fail("conflict");
      };
    }),
  );
  const assertUnchanged = async () => {
    // Completion ends the run budget, not the lifetime of retained evidence.
    await checkLive(false);
    for (const lease of leases) await lease();
  };
  await assertUnchanged();
  assertSiteBuildObservationActiveV1(context);
  return {
    commandId: command.id,
    exitCode,
    sourceTreeDigest: context.source.digest,
    file: { path: manifest.path, bytes: manifest.bytes.length, sha256: manifest.sha256 },
    output: {
      path: artifacts.commandOutput.path,
      bytes: outputBytes.length,
      sha256: artifacts.commandOutput.sha256,
    },
    artifacts,
    assertUnchanged,
  };
}
