import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { isDeepStrictEqual } from "node:util";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildFileDigest,
  npBuildContractLimitsV1,
  npBuildDirectionLimitsV1,
  npParseAgentDesignDirectionSetV1,
  npParseAgentSiteBriefV1,
  npParseAgentSiteBlueprintV1,
  npParseBuildJsonV1,
  npRequireAgentBuildCommandOutputV1,
  npRequireAgentBuildRenderFixtureRefV1,
  npRequireAgentBuildRenderFixtureV1,
  npRequireAgentBuildSourceTreeV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  npRequireBuildPreviewReportForBlueprintV1,
  npRequireBuildVerificationForBlueprintV1,
  npRequireBuildVerificationObservationForResultV1,
  type NpAgentBuildVerificationResultV1,
  type NpAgentBuildVerificationObservationV1,
} from "@nexpress/core/agent-contract";
import { projectSiteBuildBrowserDiagnosticV1 } from "./browser-request-diagnostic.js";
import { SiteArtifactFiles, SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildRenderContextV1 } from "./render-context.js";
import {
  siteBuildDraftFromSealedDirectionsV1,
  validatePreparedSiteBuildDirectionsV1,
} from "./direction-render.js";
import { observeSiteBuildDirtyPathsV1 } from "./repository-status.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { prepareSiteBuildRepositoryEditPlanV1 } from "./repository-edit-plan.js";
import {
  NpSiteBuildGeneratorControllerErrorV1,
  runSiteBuildGeneratorControllerV1,
} from "./generator-controller.js";
import { requireSiteBuildGenerationContextV1 } from "./generation-context.js";
import { observeSiteBuildCandidateV1 } from "./candidate-observation.js";
import { freezePreparedSiteBuildRenderProjectV1 } from "./render-capsule.js";
import { prepareSiteBuildCandidateRenderSourcesV1 } from "./linux-project.js";
import { createSiteBuildRenderRuntimeCacheV1 } from "./render-runtime-cache.js";
import {
  renderPreparedSiteBuildFinalPreviewV1,
  type NpSiteBuildFinalPreviewProgressV1,
} from "./final-preview.js";
import { SiteBuildLinuxSandboxFailureV1, type NpSiteBuildLinuxAuditV1 } from "./linux-sandbox.js";
import {
  publishSiteBuildFinalArtifactsV1,
  publishSiteBuildGeneratorAuditV1,
} from "./render-artifacts.js";
import {
  retainSiteBuildGeneratorEvidenceV1,
  observeSiteBuildGeneratorAuditFileV1,
  type NpSiteBuildGeneratorObservationEvidenceV1,
} from "./generator-evidence.js";
import { observePreparedSiteBuildDoctorV1 } from "./doctor-observation.js";
import type {
  NpSiteBuildCommandObserverContextV1,
  NpSiteBuildCommandObservedEvidenceV1,
} from "./command-executor.js";
import { NpSiteBuildCommandExecutionErrorV1 } from "./command-executor.js";
import { batchSiteBuildPreviewObservationsV1 } from "./generator-observation-batches.js";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const decode = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const fail = (reason: SiteBuildError["reason"] = "conflict"): never => {
  throw new SiteBuildError(reason);
};
const equal = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);
type Observation = NpSiteBuildGeneratorObservationEvidenceV1;
const safeNativeAudit = (audit: NpSiteBuildLinuxAuditV1) => ({
  status: audit.status,
  reason: audit.reason,
  rootExitCode: audit.rootExitCode,
  rootSignal: audit.rootSignal,
  tracedProcesses: audit.tracedProcesses,
  reapedProcesses: audit.reapedProcesses,
  descendantsReaped: audit.descendantsReaped,
  argumentsFrozen: audit.argumentsFrozen,
  ownIpcReclaimed: audit.ownIpcReclaimed,
  forbiddenAttempts: audit.forbiddenAttempts,
});

type SourcePreconditionConflict = {
  path: string;
  expectedHash: string | null;
  currentHash: string | null;
  plannedHash: string;
  status: "already-matches-plan" | "modified" | "missing";
};

/** Diagnostic only: records come from parsed file-plan paths and observed source digests. */
export class NpSiteBuildGenerateSourcePreconditionConflictV1 extends SiteBuildError {
  readonly scope = "source-file-plan-preconditions";
  readonly sourceWrites = 0;
  readonly requiresNewReviewedPlan = true;
  readonly conflicts: readonly Readonly<SourcePreconditionConflict>[];
  constructor(conflicts: SourcePreconditionConflict[]) {
    super("conflict");
    this.conflicts = Object.freeze(conflicts.map((conflict) => Object.freeze({ ...conflict })));
  }
}

/** A fresh run is required after reviewing the new exact hash; no automatic acknowledgement. */
export class NpSiteBuildGenerateEnvironmentMismatchV1 extends SiteBuildError {
  constructor(
    readonly expected: string,
    readonly current: string,
    readonly retainedPaths: readonly string[],
  ) {
    super("conflict");
  }
}

/** Retention does not erase a controller cleanup or partial-publication failure. */
export class NpSiteBuildGenerateFailureV1 extends NpSiteBuildGeneratorControllerErrorV1 {
  constructor(
    error: NpSiteBuildGeneratorControllerErrorV1,
    readonly retainedPaths: readonly string[],
  ) {
    super(
      error.reason,
      error.stage,
      error.sourcePublication,
      error.privateCopy,
      error.publicationFailure,
      error.failureEvidence,
    );
  }
}

function argsValue(values: Map<string, string>) {
  const args = new Map(values),
    required = ["--brief", "--directions", "--blueprint", "--runtime", "--out"],
    optional = ["--execute", "--acknowledge-plan"];
  if (
    required.some((key) => !args.get(key)) ||
    [...args].some(([key, value]) => ![...required, ...optional].includes(key) || !value) ||
    (args.has("--execute") && args.get("--execute") !== "true") ||
    args.has("--execute") !== args.has("--acknowledge-plan")
  )
    fail("arguments");
  const out = args.get("--out")!;
  if (
    out.length > 240 ||
    !/^\.nexpress\/site\/review\/final\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/u.test(out)
  )
    fail("path");
  return { args, out, execute: args.has("--execute") };
}

async function acknowledge(
  execute: boolean,
  hash: string,
  summary: { files: number; migrations: number },
) {
  if (!execute) return "dry-run" as const;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "noninteractive-process" as const;
  process.stdout.write(
    `Reviewed plan ${hash}\n${summary.files} source files; ${summary.migrations} migration files. Local verification runs first; production migration, Git and deployment are not performed.\n`,
  );
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ((await prompt.question(`Type exactly: apply ${hash}\n`)) !== `apply ${hash}`)
      fail("arguments");
  } finally {
    prompt.close();
  }
  return "interactive-tty" as const;
}

/** Source-owning callback result, not a claim that an arbitrary shell/process ran. */
async function observerFile(
  context: NpSiteBuildCommandObserverContextV1,
  body: unknown,
): Promise<NpSiteBuildCommandObservedEvidenceV1> {
  const files = await SiteArtifactFiles.at(context.project);
  const prefix = `.nexpress/site/audit/generator-observer-${randomUUID()}`;
  const report = encode(body),
    output = npRequireAgentBuildCommandOutputV1({
      schemaVersion: "np.agent-build-command-output.v1",
      stdout: { base64url: "", truncated: false },
      stderr: { base64url: "", truncated: false },
    });
  const outputBytes = npBuildCanonicalBytes("np.build-command-output.v1", output).canonicalJsonUtf8;
  const path = `${prefix}/report.json`,
    outputPath = `${prefix}/output.json`;
  await publishSiteBuildGeneratorAuditV1({
    project: context.project,
    artifacts: [
      { path, bytes: report },
      { path: outputPath, bytes: outputBytes },
    ],
    manifest: {
      path: `${prefix}/manifest.json`,
      bytes: encode({
        schemaVersion: "np.site-build-generator-observer-files.v1",
        commandId: context.command.id,
        sourceTreeDigest: context.source.digest,
        files: [
          { path, sha256: sha(report), bytes: report.length },
          { path: outputPath, sha256: sha(outputBytes), bytes: outputBytes.length },
        ],
      }),
    },
  });
  const assertUnchanged = async () => {
    if (
      sha(await files.read(path, 2 * 1024 * 1024)) !== sha(report) ||
      sha(await files.read(outputPath, 768 * 1024)) !== sha(outputBytes) ||
      (await readSiteSourceTreeV1(context.project)).digest !== context.source.digest
    )
      fail();
  };
  await assertUnchanged();
  return {
    commandId: context.command.id,
    exitCode: 0,
    sourceTreeDigest: context.source.digest,
    file: { path, bytes: report.length, sha256: sha(report) },
    output: { path: outputPath, bytes: outputBytes.length, sha256: sha(outputBytes) },
    assertUnchanged,
  };
}

/**
 * Production composition over fixed owners. Default dry-run executes the same
 * commands/native declarations/Doctor/browser checks and retains evidence; only
 * publication of ordinary repository source requires execute+exact plan hash.
 * No provider, package installation, production migration, Git write or deploy.
 */
export async function runSiteBuildGenerateV1(values: Map<string, string>, cwd: string) {
  const { args, out, execute } = argsValue(values);
  const project = await realpath(cwd),
    files = await SiteArtifactFiles.at(project),
    runId = randomUUID();
  const inputs = new Map<string, { bytes: Uint8Array; max: number }>();
  const read = async (path: string, max: number) => {
    const bytes = await files.read(path, max);
    inputs.set(path, { bytes: new Uint8Array(bytes), max });
    return bytes;
  };
  const brief = npRequireBuildReadyBriefV1(
    npParseAgentSiteBriefV1(
      decode(await read(args.get("--brief")!, npBuildContractLimitsV1.brief.bytes)),
    ),
  );
  const directions = await npRequireBuildDirectionSetForBriefV1(
    brief,
    npParseAgentDesignDirectionSetV1(
      decode(await read(args.get("--directions")!, npBuildDirectionLimitsV1.set.bytes)),
    ),
    "sealed",
  );
  const blueprint = await npRequireBuildBlueprintForBriefV1(
    brief,
    npParseAgentSiteBlueprintV1(
      decode(await read(args.get("--blueprint")!, npBuildContractLimitsV1.blueprint.bytes)),
    ),
  );
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  if (execute && args.get("--acknowledge-plan") !== blueprintHash) fail("arguments");
  const preview = blueprint.commands.filter((command) => command.template === "preview-render");
  const verifies = blueprint.commands.filter((command) => command.template === "verify");
  const builds = blueprint.commands.filter((command) => command.template === "build");
  const doctors = blueprint.commands.filter((command) => command.template === "doctor");
  if (
    preview.length !== 1 ||
    verifies.length !== 1 ||
    builds.length !== 1 ||
    doctors.length !== 1 ||
    blueprint.commands.at(-1)?.id !== verifies[0].id ||
    blueprint.commands.indexOf(builds[0]) >= blueprint.commands.indexOf(doctors[0]) ||
    blueprint.commands.indexOf(doctors[0]) >= blueprint.commands.indexOf(preview[0]) ||
    blueprint.commands.some(
      (command, index) =>
        ["format", "schema-generate", "migration-generate"].includes(command.template) &&
        index > blueprint.commands.indexOf(builds[0]),
    )
  )
    fail("unavailable");
  if (
    [
      ...preview[0].artifacts.map((artifact) => artifact.path),
      preview[0].verificationResultPath,
      ...inputs.keys(),
      args.get("--runtime")!,
    ].some((path) => path.toLowerCase() === out.toLowerCase())
  )
    fail("path");
  // Diagnose stale source preconditions before an old runtime can hide them.
  // This read grants no no-op success or execution authority: the existing
  // fresh observations and controller/publication CAS checks still run below.
  const preconditionSource = await readSiteSourceTreeV1(project);
  const currentFiles = new Map(preconditionSource.manifest.files.map((file) => [file.path, file]));
  const conflicts: SourcePreconditionConflict[] = [];
  for (const planned of blueprint.filePlan) {
    const current = currentFiles.get(planned.path);
    if (
      (current?.digest ?? null) !== planned.expectedHash ||
      (planned.action === "create") !== !current
    )
      conflicts.push({
        path: planned.path,
        expectedHash: planned.expectedHash,
        currentHash: current?.digest ?? null,
        plannedHash: planned.contentHash,
        status: !current
          ? "missing"
          : current.digest === planned.contentHash
            ? "already-matches-plan"
            : "modified",
      });
  }
  if (conflicts.length) throw new NpSiteBuildGenerateSourcePreconditionConflictV1(conflicts);
  const drafts = siteBuildDraftFromSealedDirectionsV1(directions);
  const fixtures: Array<{ path: string; bytes: Uint8Array }> = [];
  const refs = new Map<string, string>();
  for (const sample of directions.comparisonInputs.sampleContent) {
    const ref = npRequireAgentBuildRenderFixtureRefV1(sample.data),
      prior = refs.get(ref.stagedArtifactPath);
    if (prior && prior !== ref.digest) fail();
    if (prior) continue;
    refs.set(ref.stagedArtifactPath, ref.digest);
    const bytes = await read(ref.stagedArtifactPath, 4 * 1024 * 1024);
    if ((await npBuildFileDigest("np.build-staged-artifact.v1", bytes)) !== ref.digest) fail();
    npRequireAgentBuildRenderFixtureV1(npParseBuildJsonV1(decode(bytes)));
    fixtures.push({ path: ref.stagedArtifactPath, bytes });
  }
  await read(args.get("--runtime")!, 4 * 1024 * 1024);
  const baseline = await observeSiteBuildRenderContextV1({
    cwd: project,
    files,
    runtimePath: args.get("--runtime")!,
    brief,
    drafts,
  });
  const config =
    baseline.observed.config === "src/nexpress.config.ts" ||
    baseline.observed.config === "nexpress.config.ts"
      ? baseline.observed.config
      : fail("unavailable");
  if (baseline.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint) fail();
  // Independently rerender even for --execute. A previous dry-run is no execution grant.
  const comparison = await validatePreparedSiteBuildDirectionsV1({
    ...baseline.context,
    sealedSet: directions,
    artifactProject: project,
  });
  const assertInputs = async () => {
    for (const [path, input] of inputs)
      if (!Buffer.from(await files.read(path, input.max)).equals(input.bytes)) fail();
    await baseline.context.capsule.assertOriginalUnchanged();
  };
  const original = await readSiteSourceTreeV1(project),
    dirty = await observeSiteBuildDirtyPathsV1(project);
  const preflight = await prepareSiteBuildRepositoryEditPlanV1({
    scope: "private-build-copy",
    project,
    blueprint,
    baseline: original.manifest,
    dirtyPaths: dirty,
  });
  let privateBaseline: Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
  try {
    privateBaseline = await readSiteSourceTreeV1(preflight.project);
  } catch (error) {
    await preflight.close();
    throw error;
  }
  let candidate: Awaited<ReturnType<typeof createCandidate>> | undefined;
  let mismatch: NpSiteBuildGenerateEnvironmentMismatchV1 | undefined;
  let previewResult: Awaited<ReturnType<typeof renderPreparedSiteBuildFinalPreviewV1>> | undefined;
  let verification: NpAgentBuildVerificationResultV1 | undefined;
  let observation: NpAgentBuildVerificationObservationV1 | undefined;
  let retained: Awaited<ReturnType<typeof retainSiteBuildGeneratorEvidenceV1>> | undefined;
  const observations: Observation[] = [];
  const failureRetainedPaths: string[] = [];
  let controllerCompletion:
    { sourcePublication: "completed" | "not-started"; retainedPaths: string[] } | undefined;
  let failureSnapshot = 0;
  const generationContext = requireSiteBuildGenerationContextV1({
    schemaVersion: "np.site-build-generation-context.v1",
    implementation: "np.site-build-generation.v1",
    selectedDirectionHash: blueprint.selectedDirectionHash,
    comparisonInputsDigest: directions.comparisonInputsDigest,
    selectedRenderEnvironmentFingerprint: baseline.fingerprint,
    clock: baseline.observed.clock,
  });
  const add = (
    kind: Observation["kind"],
    name: string,
    bytes: Uint8Array,
    assertUnchanged: () => Promise<void>,
  ) => {
    observations.push({ kind, name, bytes: new Uint8Array(bytes), assertUnchanged });
  };
  for (const [index, audit] of comparison.audits.entries())
    add("baseline-audit", `comparison-${index}`, encode(audit), () =>
      baseline.context.capsule.assertOriginalUnchanged(),
    );
  const assertOriginal = async () => {
    await assertInputs();
    await preflight.assertOriginalUnchanged();
    if (
      (await readSiteSourceTreeV1(project)).digest !== original.digest ||
      (await readSiteSourceTreeV1(preflight.project)).digest !== privateBaseline.digest
    )
      fail();
  };
  async function createCandidate(context: NpSiteBuildCommandObserverContextV1) {
    await assertOriginal();
    if (
      context.baselineTreeDigest !== privateBaseline.digest ||
      !context.nextDerivation ||
      context.nextDerivation.sourceAfterDigest !== context.source.digest
    )
      fail("unavailable");
    const sourceInputs = await prepareSiteBuildCandidateRenderSourcesV1(context.project, {
      tarballProjectRoot: project,
    });
    let closeCapsule: (() => Promise<void>) | undefined;
    const close = async () => {
      const results = await Promise.allSettled([
        ...(closeCapsule ? [closeCapsule()] : []),
        sourceInputs.close(),
      ]);
      if (results.some((result) => result.status === "rejected")) fail("unavailable");
    };
    try {
      const capsule = await freezePreparedSiteBuildRenderProjectV1({
        project: context.project,
        sourceInputs,
        originInputs: sourceInputs.originInputs,
        fixtures,
        input: {
          mode: "catalog",
          config,
          clockNow: baseline.observed.clock.now,
          randomSeed: baseline.observed.clock.randomSeed,
        },
      });
      closeCapsule = () => capsule.close();
      const runtime = await createSiteBuildRenderRuntimeCacheV1({
        project: capsule.project,
        originalProjectRoot: context.project,
        tarballProjectRoot: project,
      });
      const assertCandidateRuntime = async () => {
        await capsule.assertOriginalUnchanged();
        await runtime.assertUnchanged();
      };
      const assertCandidateSource = async () => {
        if ((await readSiteSourceTreeV1(context.project)).digest !== context.source.digest) fail();
      };
      const assertLive = async () => {
        await assertOriginal();
        await assertCandidateRuntime();
        await assertCandidateSource();
      };
      const observed = await observeSiteBuildCandidateV1({
        image: baseline.context.image,
        brief,
        sealedDirections: directions,
        blueprint,
        config,
        generationContext,
        comparisonEnvironment: baseline.environment,
        baselineRuntime: {
          ...baseline.observed.capsule,
          clock: baseline.observed.clock,
          assertUnchanged: () => baseline.context.capsule.assertOriginalUnchanged(),
        },
        candidateRuntime: {
          project: runtime.cache.project,
          renderer: runtime.renderer,
          runtimeFilesDigest: runtime.cache.runtimeFilesDigest,
          clock: baseline.observed.clock,
          assertUnchanged: assertCandidateRuntime,
        },
        baselineOriginalSource: {
          manifest: privateBaseline.manifest,
          assertUnchanged: assertOriginal,
        },
        candidateSource: {
          manifest: context.source.manifest,
          assertUnchanged: assertCandidateSource,
        },
        signal: context.signal,
        remainingMs: context.remainingMs,
      });
      const prefix = `.nexpress/site/audit/generator-runtime-${runId}`;
      const path = `${prefix}/runtime.json`;
      const privateFiles = await SiteArtifactFiles.at(context.project);
      const runtimeBytes = encode({
        schemaVersion: "np.site-build-render-session.v1",
        config,
        cache: runtime.cache,
        renderer: runtime.renderer,
        clock: baseline.observed.clock,
      });
      await publishSiteBuildGeneratorAuditV1({
        project: context.project,
        artifacts: [{ path, bytes: runtimeBytes }],
        manifest: {
          path: `${prefix}/manifest.json`,
          bytes: encode({
            schemaVersion: "np.site-build-generator-runtime-transport.v1",
            scope: "host-live-cache-lease-required",
            blueprintHash,
            sourceTreeDigest: context.source.digest,
            path,
            sha256: sha(runtimeBytes),
            bytes: runtimeBytes.length,
          }),
        },
      });
      const current = await observeSiteBuildRenderContextV1({
        cwd: context.project,
        files: privateFiles,
        fixtureFiles: files,
        runtimePath: path,
        brief,
        drafts: observed.candidate.result.candidateDraft,
        tarballProjectRoot: project,
      });
      await assertLive();
      const assertObserved = async () => {
        await observed.assertUnchanged();
        await current.context.capsule.assertOriginalUnchanged();
      };
      for (const [kind, owner] of [
        ["baseline-audit", observed.baseline],
        ["candidate-audit", observed.candidate],
      ] as const)
        add(kind, "declarations", encode(owner.audit), assertObserved);
      for (const artifact of [...observed.baseline.artifacts, ...observed.candidate.artifacts])
        add(
          "observer-report",
          artifact.name.replace(/\.json$/u, "").replace(/[^A-Za-z0-9-]/gu, "-"),
          artifact.bytes,
          assertObserved,
        );
      return {
        context,
        capsule,
        runtime,
        observed,
        current,
        assertUnchanged: assertObserved,
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
  const ensureCandidate = async (context: NpSiteBuildCommandObserverContextV1) => {
    if (!candidate) candidate = await createCandidate(context);
    if (
      candidate.context.project !== context.project ||
      candidate.context.source.digest !== context.source.digest
    )
      fail();
    await candidate.assertUnchanged();
    // Doctor also binds this fingerprint; surface the fresh observed mismatch
    // before any command could reject it as an opaque declaration conflict.
    if (candidate.current.fingerprint !== preview[0].renderEnvironmentFingerprint) {
      mismatch = new NpSiteBuildGenerateEnvironmentMismatchV1(
        preview[0].renderEnvironmentFingerprint,
        candidate.current.fingerprint,
        await retainFailedStage(context, "environment"),
      );
      throw mismatch;
    }
    return candidate;
  };
  // Only actual producer bytes and exact completed-command files enter a failed
  // stage snapshot. It is explicitly not a complete verification receipt.
  const retainFailedStage = async (
    context: NpSiteBuildCommandObserverContextV1,
    stage: "doctor" | "environment" | "preview",
  ) => {
    const prefix = `.nexpress/site/audit/generator-${runId}-failure-${failureSnapshot++}`;
    const artifacts: Array<{ path: string; bytes: Uint8Array }> = [];
    const selected: Array<{ path: string; sha256: string; bytes: number }> = [];
    const append = (name: string, bytes: Uint8Array) => {
      const path = `${prefix}/${name}`;
      artifacts.push({ path, bytes });
      selected.push({ path, sha256: sha(bytes), bytes: bytes.length });
    };
    for (const [index, observation] of observations.entries()) {
      await observation.assertUnchanged();
      append(`observation-${index}.json`, observation.bytes);
    }
    const privateFiles = await SiteArtifactFiles.at(context.project);
    for (const [index, command] of context.completedCommands.entries()) {
      const bytes = await privateFiles.read(command.outputArtifactPath, 768 * 1024);
      const output = npRequireAgentBuildCommandOutputV1(npParseBuildJsonV1(decode(bytes)));
      if (
        !Buffer.from(
          npBuildCanonicalBytes("np.build-command-output.v1", output).canonicalJsonUtf8,
        ).equals(bytes) ||
        (await npBuildCanonicalDigest("np.build-command-output.v1", output)) !==
          command.outputDigest
      )
        fail();
      append(`command-${index}.output.json`, bytes);
      if (command.execution)
        for (const stream of ["stdout", "stderr"] as const) {
          const file = command.execution[stream],
            observed = await observeSiteBuildGeneratorAuditFileV1(
              context.project,
              file.path,
              8 * 1024 * 1024,
            ),
            raw = observed.bytes;
          if (raw.length !== file.bytes || sha(raw) !== file.sha256) fail();
          await observed.assertUnchanged();
          append(`command-${index}.${stream}.log`, raw);
        }
    }
    if (candidate) {
      await candidate.assertUnchanged();
      append("environment.json", encode(candidate.current.environment));
    }
    if (!artifacts.length) fail("unavailable");
    const publication = await publishSiteBuildGeneratorAuditV1({
      project,
      artifacts,
      manifest: {
        path: `${prefix}/manifest.json`,
        bytes: encode({
          schemaVersion: "np.site-build-generator-failure-evidence.v1",
          scope: "partial-stage-observation-only",
          blueprintHash,
          stage,
          files: selected,
        }),
      },
    });
    failureRetainedPaths.push(...publication.paths);
    return publication.paths;
  };
  const perform = async () => {
    const authorizationSource = await acknowledge(execute, blueprintHash, {
      files: blueprint.filePlan.length,
      migrations: blueprint.filePlan.filter((file) => file.owner === "migration").length,
    });
    await assertOriginal();
    const receipt = await runSiteBuildGeneratorControllerV1({
      project,
      blueprint,
      config,
      runMode: execute ? "publish" : "dry-run",
      acknowledgePlanHash: execute ? blueprintHash : null,
      generationContext,
      nextPreview: "deterministic-selected-comparison",
      prepared: {
        dependencies: join(baseline.observed.capsule.project, "node_modules"),
        baseImageId: baseline.context.image.baseImageId,
        assertUnchanged: () => baseline.context.capsule.assertOriginalUnchanged(),
      },
      registry: {
        fingerprint: baseline.commandRegistryFingerprint,
        assertUnchanged: () => baseline.context.capsule.assertOriginalUnchanged(),
      },
      observeRepository: async () => {
        await assertOriginal();
        return {
          dirtyPaths: dirty,
          assertUnchanged: async () => {
            await assertOriginal();
            if (!equal(await observeSiteBuildDirtyPathsV1(project), dirty)) fail();
          },
        };
      },
      observers: {
        doctor: async (context) => {
          const current = await ensureCandidate(context);
          const result = await observePreparedSiteBuildDoctorV1({
            context,
            brief,
            drafts: current.observed.candidate.result.candidateDraft,
            selectedDirectionId: blueprint.selectedDirectionId,
            config,
            capsule: current.current.context.capsule,
            image: current.current.context.image,
            environment: current.current.environment,
          });
          const assertDoctorUnchanged = () => result.assertUnchanged();
          for (const [key, artifact] of Object.entries(result.artifacts))
            add(
              key === "seedMaterialization"
                ? "seed-receipt"
                : key === "nativeAudit"
                  ? "candidate-audit"
                  : "observer-report",
              `doctor-${key}`,
              artifact.bytes,
              assertDoctorUnchanged,
            );
          if (result.exitCode !== 0) await retainFailedStage(context, "doctor");
          return result;
        },
        previewRender: async (context) => {
          const current = await ensureCandidate(context);
          if (current.current.fingerprint !== preview[0].renderEnvironmentFingerprint) {
            mismatch = new NpSiteBuildGenerateEnvironmentMismatchV1(
              preview[0].renderEnvironmentFingerprint,
              current.current.fingerprint,
              await retainFailedStage(context, "environment"),
            );
            throw mismatch;
          }
          const started = Date.now();
          const progress: Array<
            Omit<NpSiteBuildFinalPreviewProgressV1, "nativeAudit"> & {
              elapsedMs: number;
              nativeAudit: ReturnType<typeof safeNativeAudit> | null;
            }
          > = [];
          try {
            previewResult = await renderPreparedSiteBuildFinalPreviewV1({
              ...current.current.context,
              brief,
              reviewedDrafts: drafts,
              drafts: current.observed.candidate.result.candidateDraft,
              selectedDirectionId: blueprint.selectedDirectionId,
              blueprint,
              defaultLocale: current.observed.candidate.result.catalog.defaultLocale,
              signal: context.signal,
              remainingMs: context.remainingMs,
              observeProgress: (event) => {
                progress.push({
                  phase: event.phase,
                  pageId: event.pageId,
                  viewport: event.viewport,
                  completedCaptures: event.completedCaptures,
                  elapsedMs: Date.now() - started,
                  nativeAudit:
                    event.nativeAudit === null ? null : safeNativeAudit(event.nativeAudit),
                });
              },
            });
          } catch (error) {
            add(
              "observer-report",
              "final-preview-failure",
              encode({
                schemaVersion: "np.site-build-final-preview-failure.v1",
                scope: "partial-preview-observations-only",
                blueprintHash,
                reason: error instanceof SiteBuildError ? error.reason : "unavailable",
                cancellationObserved: context.signal.aborted,
                remainingMs: context.remainingMs(),
                progress,
                nativeFailure:
                  error instanceof SiteBuildLinuxSandboxFailureV1
                    ? {
                        audit: safeNativeAudit(error.audit),
                        driverStage: error.driverStage,
                        fixtureStage: error.fixtureStage,
                        fixtureReason: error.fixtureReason,
                        fixtureLocation: error.fixtureLocation,
                        browserPhase: error.browserPhase,
                        browserDiagnostic: projectSiteBuildBrowserDiagnosticV1(
                          error.browserDiagnostic,
                        ),
                        previewHttpDiagnostic: error.previewHttpDiagnostic
                          ? {
                              reason: error.previewHttpDiagnostic.reason,
                              status: error.previewHttpDiagnostic.status,
                            }
                          : null,
                      }
                    : null,
              }),
              current.assertUnchanged,
            );
            await retainFailedStage(context, "preview");
            throw error;
          }
          const captureObservations: Observation[] = [];
          for (const [index, audit] of previewResult.audits.entries()) {
            captureObservations.push({
              kind: "final-preview-audit",
              name: `page-${index}`,
              bytes: encode(audit.audit),
              assertUnchanged: current.assertUnchanged,
            });
            const bytes = encode(audit.seedMaterialization.receipt);
            if (
              bytes.length !== audit.seedMaterialization.bytes ||
              (await npBuildFileDigest("np.build-verification-artifact.v1", bytes)) !==
                audit.seedMaterialization.digest
            )
              fail();
            captureObservations.push({
              kind: "seed-receipt",
              name: `page-${index}`,
              bytes,
              assertUnchanged: current.assertUnchanged,
            });
          }
          observations.push(...(await batchSiteBuildPreviewObservationsV1(captureObservations)));
          add(
            "observer-report",
            "final-preview",
            encode(previewResult.report),
            current.assertUnchanged,
          );
          if (previewResult.status !== "passed") {
            await retainFailedStage(context, "preview");
            fail("unavailable");
          }
          await current.assertUnchanged();
          return observerFile(context, {
            schemaVersion: "np.site-build-generator-preview-observer.v1",
            blueprintHash,
            report: previewResult.report,
            lineage: previewResult.lineage,
          });
        },
        verify: async (context) => {
          const finalPreview = previewResult ?? fail("unavailable"),
            current = candidate ?? fail("unavailable");
          if (
            context.command.id !== verifies[0].id ||
            context.completedCommands.length !== blueprint.commands.length - 1
          )
            fail("unavailable");
          await current.assertUnchanged();
          await npRequireBuildPreviewReportForBlueprintV1(blueprint, finalPreview.report);
          return observerFile(context, {
            schemaVersion: "np.site-build-generator-verify-observer.v1",
            blueprintHash,
            reportStatus: finalPreview.status,
            commandResults: context.completedCommands.map((command) => ({
              commandId: command.commandId,
              exitCode: command.exitCode,
              outputDigest: command.outputDigest,
            })),
          });
        },
      },
      beforePrivateCleanup: async (context) => {
        // The controller invokes this only for its own failed private copy,
        // before removal. No receipt is fabricated for a partial command run.
        const executionFailure =
          context.failure instanceof NpSiteBuildCommandExecutionErrorV1 ? context.failure : null;
        const auditPath = context.execution?.auditPath ?? executionFailure?.auditPath;
        if (!auditPath) {
          if (failureRetainedPaths.length) return;
          throw new SiteBuildError("unavailable");
        }
        if (!/^\.nexpress\/site\/audit\/[A-Za-z0-9_-]{1,100}$/u.test(auditPath)) fail("path");
        const prefix = `.nexpress/site/audit/generator-${runId}-failure-${failureSnapshot++}`;
        const artifacts: Array<{ path: string; bytes: Uint8Array }> = [];
        const records: Array<{ path: string; sha256: string; bytes: number; sourcePath: string }> =
          [];
        const leases: Array<() => Promise<void>> = [];
        const append = async (path: string, name: string, limit: number, optional = false) => {
          let observed: Awaited<ReturnType<typeof observeSiteBuildGeneratorAuditFileV1>>;
          try {
            observed = await observeSiteBuildGeneratorAuditFileV1(context.project, path, limit);
          } catch (error) {
            if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
          }
          artifacts.push({ path: `${prefix}/${name}`, bytes: observed.bytes });
          records.push({
            path: `${prefix}/${name}`,
            sha256: observed.sha256,
            bytes: observed.bytes.length,
            sourcePath: path,
          });
          leases.push(observed.assertUnchanged);
        };
        await append(
          `${auditPath}/${context.execution ? "receipt" : "failure"}.json`,
          "execution.json",
          4 * 1024 * 1024,
        );
        const last = executionFailure
          ? blueprint.commands.findIndex((command) => command.id === executionFailure.commandId)
          : blueprint.commands.length - 1;
        if (last < 0 && executionFailure?.commandId !== null) fail("input");
        for (let index = 0; index <= last; index++) {
          await append(
            `${auditPath}/command-${index}.output.json`,
            `command-${index}.output.json`,
            768 * 1024,
            true,
          );
          for (const stream of ["stdout", "stderr"] as const)
            await append(
              `${auditPath}/command-${index}.${stream}.log`,
              `command-${index}.${stream}.log`,
              8 * 1024 * 1024,
              true,
            );
        }
        for (const lease of leases) await lease();
        const publication = await publishSiteBuildGeneratorAuditV1({
          project,
          artifacts,
          manifest: {
            path: `${prefix}/manifest.json`,
            bytes: encode({
              schemaVersion: "np.site-build-generator-failure-evidence.v1",
              scope: "partial-command-files-only",
              blueprintHash,
              commandId: executionFailure?.commandId ?? null,
              files: records,
            }),
          },
        });
        for (const lease of leases) await lease();
        failureRetainedPaths.push(...publication.paths);
      },
      verifyCandidate: async (context) => {
        const current = candidate ?? fail("unavailable"),
          finalPreview = previewResult ?? fail("unavailable");
        if (
          !equal(context.privateBaseline, privateBaseline) ||
          context.candidateSource.digest !== current.context.source.digest
        )
          fail("unavailable");
        await current.assertUnchanged();
        // The private copy intentionally omits credentials and planning inputs.
        // Verification addresses the ordinary repository after publication:
        // preserve those originals and replace only byte-proven planned files.
        const publishedFiles = new Map(
          context.originalSource.manifest.files.map((file) => [file.path, file]),
        );
        const candidateFiles = new Map(
          context.candidateSource.manifest.files.map((file) => [file.path, file]),
        );
        for (const planned of blueprint.filePlan) {
          const before = publishedFiles.get(planned.path),
            actual = candidateFiles.get(planned.path) ?? fail("conflict");
          if (
            (before?.digest ?? null) !== planned.expectedHash ||
            (planned.action === "create") !== !before ||
            actual.digest !== planned.contentHash ||
            actual.mode !== (before?.mode ?? "100644")
          )
            fail("conflict");
          publishedFiles.set(planned.path, actual);
        }
        const publishedSource = npRequireAgentBuildSourceTreeV1({
          schemaVersion: "np.agent-build-source-tree.v1",
          files: [...publishedFiles.values()].sort((left, right) =>
            Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
          ),
        });
        const body = {
          schemaVersion: "np.agent-build-verification-result.v1",
          blueprintHash,
          commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
          renderEnvironmentFingerprint: current.current.fingerprint,
          baselineTreeDigest: context.originalSource.digest,
          finalSourceDigest: await npBuildCanonicalDigest(
            "np.build-source-tree.v1",
            publishedSource,
          ),
          commandResults: context.execution.commands.map((command) => ({
            commandId: command.commandId,
            exitCode: command.exitCode,
          })),
          artifacts: finalPreview.artifactRecords,
        };
        const verified = await npRequireBuildVerificationForBlueprintV1(blueprint, {
          ...body,
          manifestDigest: await npBuildCanonicalDigest("np.build-verification-result.v1", body),
        });
        add(
          "observer-report",
          "original-source",
          encode(context.originalSource.manifest),
          current.assertUnchanged,
        );
        add(
          "observer-report",
          "projected-source",
          encode(publishedSource),
          current.assertUnchanged,
        );
        const retainedEvidence = await retainSiteBuildGeneratorEvidenceV1({
          context,
          runId,
          assertLiveUnchanged: current.assertUnchanged,
          observations,
        });
        retained = retainedEvidence;
        // Observation paths refer to byte-checked retained originals, never the
        // controller's disposable private-copy audit directory.
        const observedVerification = await npRequireBuildVerificationObservationForResultV1(
          verified,
          {
            schemaVersion: "np.agent-build-verification-observation.v1",
            manifestDigest: verified.manifestDigest,
            commandResults: context.execution.commands.map((command) => {
              const rows = retainedEvidence.manifest.files.filter(
                (file) =>
                  file.kind === "command-output" &&
                  file.sourcePath === command.outputArtifactPath &&
                  file.canonicalDigest === command.outputDigest,
              );
              if (rows.length !== 1) return fail();
              return {
                commandId: command.commandId,
                exitCode: command.exitCode,
                outputDigest: command.outputDigest,
                durationMs: command.durationMs,
                outputArtifactPath: rows[0].path,
              };
            }),
            startedAt: context.execution.commands[0]?.startedAt ?? fail(),
            finishedAt: context.execution.commands.at(-1)?.finishedAt ?? fail(),
          },
        );
        const verificationBytes = encode(verified),
          observationBytes = encode(observedVerification),
          observationPath = `.nexpress/site/review/final/observations-${runId}.json`;
        await publishSiteBuildFinalArtifactsV1({
          project,
          artifacts: [
            ...finalPreview.artifacts,
            { path: observationPath, bytes: observationBytes },
          ],
          manifest: { path: preview[0].verificationResultPath, bytes: verificationBytes },
        });
        const check = async () => {
          await current.assertUnchanged();
          await retainedEvidence.assertUnchanged();
          for (const artifact of [
            ...finalPreview.artifacts,
            { path: observationPath, bytes: observationBytes },
            { path: preview[0].verificationResultPath, bytes: verificationBytes },
          ]) {
            const bytes = artifact.path.endsWith(".png")
              ? await files.readFinalPreviewImage(artifact.path, 10 * 1024 * 1024)
              : await files.read(artifact.path, 4 * 1024 * 1024);
            if (!Buffer.from(bytes).equals(artifact.bytes)) fail();
          }
          await npRequireBuildVerificationForBlueprintV1(
            blueprint,
            npParseBuildJsonV1(
              decode(await files.read(preview[0].verificationResultPath, 4 * 1024 * 1024)),
            ),
          );
          await npRequireBuildVerificationObservationForResultV1(
            verified,
            npParseBuildJsonV1(decode(await files.read(observationPath, 4 * 1024 * 1024))),
          );
        };
        await check();
        verification = verified;
        observation = observedVerification;
        return {
          blueprintHash,
          originalTreeDigest: context.originalSource.digest,
          candidateTreeDigest: context.candidateSource.digest,
          retainedArtifacts: retainedEvidence.retainedArtifacts,
          assertUnchanged: check,
        };
      },
    });
    controllerCompletion = {
      sourcePublication: receipt.publication ? "completed" : "not-started",
      retainedPaths: receipt.verification.retainedArtifactsReportedByVerifier.map(
        (artifact) => artifact.path,
      ),
    };
    const finalVerification = verification ?? fail("unavailable"),
      finalRetained = retained ?? fail("unavailable"),
      finalPreview = previewResult ?? fail("unavailable");
    if (!observation) fail("unavailable");
    if (execute && finalVerification.finalSourceDigest !== receipt.originalSourceAfter.digest)
      fail("conflict");
    const result = {
      schemaVersion: "np.site-build-generate-result.v1",
      operation: "site generate",
      status: execute ? "published" : "dry-run-verified",
      blueprintHash,
      authorizationSource,
      sourcePublication: receipt.publication?.result.status ?? "not-requested",
      originalTreeDigest: receipt.originalSource.digest,
      finalSourceDigest: finalVerification.finalSourceDigest,
      privateCandidateTreeDigest: receipt.candidateSource.digest,
      verificationPath: preview[0].verificationResultPath,
      observationPath: `.nexpress/site/review/final/observations-${runId}.json`,
      manifestDigest: finalVerification.manifestDigest,
      retainedArtifacts: finalRetained.retainedArtifacts,
      privateCopy: receipt.privateCopy,
      commands: receipt.execution.commands.map((command) => ({
        commandId: command.commandId,
        exitCode: command.exitCode,
      })),
      renderedImages: finalPreview.artifacts.filter((artifact) => artifact.path.endsWith(".png"))
        .length,
    };
    const publication = await publishSiteBuildFinalArtifactsV1({
      project,
      artifacts: [],
      manifest: { path: out, bytes: encode(result) },
    });
    return { ...result, path: out, artifactPublication: publication.status };
  };
  let result: Awaited<ReturnType<typeof perform>> | undefined;
  let failure: unknown;
  let caught = false;
  try {
    result = await perform();
  } catch (error) {
    caught = true;
    failure =
      controllerCompletion && !(error instanceof NpSiteBuildGeneratorControllerErrorV1)
        ? new NpSiteBuildGenerateFailureV1(
            new NpSiteBuildGeneratorControllerErrorV1(
              error instanceof SiteBuildError ? error.reason : "unavailable",
              "verify",
              controllerCompletion.sourcePublication,
              "removed",
              null,
              "retained",
            ),
            controllerCompletion.retainedPaths,
          )
        : error;
  }
  const closed = await Promise.allSettled([
    ...(candidate ? [candidate.close()] : []),
    preflight.close(),
  ]);
  if (closed.some((value) => value.status === "rejected")) {
    const prior = failure instanceof NpSiteBuildGeneratorControllerErrorV1 ? failure : null;
    throw new NpSiteBuildGeneratorControllerErrorV1(
      "unavailable",
      "cleanup",
      prior?.sourcePublication ?? controllerCompletion?.sourcePublication ?? "not-started",
      "cleanup-failed",
      prior?.publicationFailure ?? null,
      prior?.failureEvidence ?? "not-requested",
    );
  }
  if (caught) {
    if (
      mismatch &&
      failure instanceof NpSiteBuildGeneratorControllerErrorV1 &&
      failure.privateCopy !== "cleanup-failed" &&
      failure.sourcePublication === "not-started" &&
      failure.failureEvidence !== "retention-failed"
    )
      throw mismatch;
    if (failureRetainedPaths.length && failure instanceof NpSiteBuildGeneratorControllerErrorV1)
      throw new NpSiteBuildGenerateFailureV1(failure, failureRetainedPaths);
    throw failure;
  }
  return result ?? fail("unavailable");
}
