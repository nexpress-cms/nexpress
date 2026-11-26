import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { types } from "node:util";
import {
  npBuildCanonicalDigest,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBuildSourceTreeV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import { materializeSiteBuildCandidateDependenciesV1 } from "./candidate-dependencies.js";
import {
  executeSiteBuildBlueprintCommandsV1,
  type NpSiteBuildCommandExecutionReceiptV1,
  type NpSiteBuildCommandExecutorInputV1,
  type NpSiteBuildCommandObservedEvidenceV1,
} from "./command-executor.js";
import {
  prepareSiteBuildRepositoryEditPlanV1,
  type NpSiteBuildPrivateRepositoryEditPlanV1,
  type NpSiteBuildRepositoryEditPlanReceiptV1,
} from "./repository-edit-plan.js";
import {
  NpSiteBuildRepositoryPublicationErrorV1,
  prepareSiteBuildRepositoryPublicationV1,
  type NpSiteBuildRepositoryPublicationV1,
} from "./repository-publication.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";

type Source = Awaited<ReturnType<typeof readSiteSourceTreeV1>>;
type Materialized = Awaited<ReturnType<typeof materializeSiteBuildCandidateDependenciesV1>>;
export interface NpSiteBuildGeneratorRetainedArtifactV1 {
  /** Reported by the verifier that owns create-only publication and byte verification. */
  path: string;
  sha256: string;
  bytes: number;
}
export interface NpSiteBuildGeneratorVerificationContextV1 {
  originalProject: string;
  project: string;
  dependencies: string;
  blueprint: NpAgentSiteBlueprintV1;
  blueprintHash: string;
  /** Original raw profile, including credentials omitted from the private copy. */
  originalSource: Source;
  /** Captured BEFORE staged apply, after the private-copy omission policy. */
  privateBaseline: Source;
  candidateSource: Source;
  editPlan: NpSiteBuildRepositoryEditPlanReceiptV1;
  execution: NpSiteBuildCommandExecutionReceiptV1;
}
export interface NpSiteBuildGeneratorVerifiedCandidateV1 {
  blueprintHash: string;
  originalTreeDigest: string;
  candidateTreeDigest: string;
  retainedArtifacts?: readonly NpSiteBuildGeneratorRetainedArtifactV1[];
  /** Live actual verification/artifact/source lease, never a JSON execution grant. */
  assertUnchanged(): Promise<void>;
}
export interface NpSiteBuildGeneratorControllerInputV1 {
  project: string;
  blueprint: unknown;
  config: NpSiteBuildCommandExecutorInputV1["config"];
  /** Only trusted host code may select publication after its user-facing approval flow. */
  runMode?: "dry-run" | "publish";
  acknowledgePlanHash?: string | null;
  /** Host observes actual dirty/Git preconditions. This controller never invokes Git. */
  observeRepository(project: string): Promise<{
    dirtyPaths: readonly string[];
    assertUnchanged(): Promise<void>;
  }>;
  prepared: {
    dependencies: string;
    baseImageId: string;
    assertUnchanged(): Promise<void>;
  };
  registry: NpSiteBuildCommandExecutorInputV1["registry"];
  generationContext?: NpSiteBuildCommandExecutorInputV1["generationContext"];
  nextPreview?: NpSiteBuildCommandExecutorInputV1["nextPreview"];
  observers?: NpSiteBuildCommandExecutorInputV1["observers"];
  /** Failure-only host hook. Awaited while the private copy still exists, before cleanup.
   * The hook owns bounded, create-only evidence retention; it grants no publication authority.
   * Hook failure never prevents cleanup or replaces the original execution failure.
   */
  beforePrivateCleanup?(context: {
    project: string;
    blueprint: NpAgentSiteBlueprintV1;
    failure: unknown;
    execution?: NpSiteBuildCommandExecutionReceiptV1;
  }): Promise<void>;
  /** Required for BOTH modes. Owns actual completeness and retention of external evidence. */
  verifyCandidate(
    context: NpSiteBuildGeneratorVerificationContextV1,
  ): Promise<NpSiteBuildGeneratorVerifiedCandidateV1>;
}
export interface NpSiteBuildGeneratorControllerReceiptV1 {
  schemaVersion: "np.site-build-generator-controller.v1";
  runMode: "dry-run" | "publish";
  blueprintHash: string;
  originalSource: Source;
  originalSourceAfter: Source;
  privateBaseline: Source;
  candidateSource: Source;
  dirtyPaths: string[];
  editPlan: NpSiteBuildRepositoryEditPlanReceiptV1;
  dependencies: Pick<Materialized, "profile" | "digest" | "files" | "bytes">;
  execution: NpSiteBuildCommandExecutionReceiptV1;
  verification: {
    blueprintHash: string;
    originalTreeDigest: string;
    candidateTreeDigest: string;
    retainedArtifactsReportedByVerifier: NpSiteBuildGeneratorRetainedArtifactV1[];
  };
  publication: {
    receipt: NpSiteBuildRepositoryPublicationV1["receipt"];
    result: Awaited<ReturnType<NpSiteBuildRepositoryPublicationV1["publish"]>>;
  } | null;
  privateCopy: "removed";
  /** Historical executor-relative paths are not retained by this controller. */
  privateArtifactsRetained: false;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
type Stage =
  | "input"
  | "observe"
  | "copy"
  | "stage"
  | "dependencies"
  | "commands"
  | "verify"
  | "publish-preflight"
  | "publish"
  | "cleanup";
/** A failure never triggers rollback. Native partial-publication details remain explicit. */
export class NpSiteBuildGeneratorControllerErrorV1 extends SiteBuildError {
  constructor(
    reason: SiteBuildError["reason"],
    readonly stage: Stage,
    readonly sourcePublication: "not-started" | "completed" | "partial-changes-may-remain",
    readonly privateCopy: "not-created" | "removed" | "cleanup-failed",
    readonly publicationFailure: {
      publicationState: NpSiteBuildRepositoryPublicationErrorV1["publicationState"];
      writtenPaths: string[];
      unchangedPaths: string[];
      uncertainPaths: string[];
    } | null,
    readonly failureEvidence: "not-requested" | "retained" | "retention-failed" = "not-requested",
  ) {
    super(reason);
  }
}

// Inspect data descriptors before invoking browser-safe Core parsers. Host callbacks
// and live handles are separate inputs and deliberately never serialized as grants.
function inspectJson(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  budget = { nodes: 0, bytes: 0 },
): void {
  if (++budget.nodes > 100000 || depth > 24) throw new SiteBuildError("input");
  budget.bytes += typeof value === "string" ? Buffer.byteLength(value) : 8;
  if (budget.bytes > 4 * 1024 * 1024) throw new SiteBuildError("input");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (typeof value !== "object" || types.isProxy(value) || seen.has(value))
    throw new SiteBuildError("input");
  const prototype: unknown = Object.getPrototypeOf(value),
    array = Array.isArray(value);
  if (array && value.length > 10000) throw new SiteBuildError("input");
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null)
    throw new SiteBuildError("input");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length > 20000) throw new SiteBuildError("input");
  seen.add(value);
  for (const key of Reflect.ownKeys(fields)) {
    if (
      typeof key !== "string" ||
      !("value" in fields[key]) ||
      (!fields[key].enumerable && !(array && key === "length"))
    )
      throw new SiteBuildError("input");
    budget.bytes += Buffer.byteLength(key);
    inspectJson(fields[key].value, depth + 1, seen, budget);
  }
  seen.delete(value);
}
function beforeMatchesPlan(baseline: NpAgentBuildSourceTreeV1, blueprint: NpAgentSiteBlueprintV1) {
  const before = new Map(baseline.files.map((file) => [file.path, file]));
  for (const row of blueprint.filePlan) {
    const old = before.get(row.path);
    // Already-published plans require a separately observed no-op path. Do not
    // skip commands or reinterpret a create as an update to manufacture success.
    if ((old?.digest ?? null) !== row.expectedHash || (row.action === "create") !== !old)
      throw new SiteBuildError("conflict");
  }
}
function finalMatchesPlan(
  source: Source,
  baseline: NpAgentBuildSourceTreeV1,
  blueprint: NpAgentSiteBlueprintV1,
) {
  const before = new Map(baseline.files.map((file) => [file.path, file])),
    actual = new Map(source.manifest.files.map((file) => [file.path, file])),
    planned = new Map(blueprint.filePlan.map((row) => [row.path, row]));
  for (const path of new Set([...before.keys(), ...actual.keys(), ...planned.keys()])) {
    const old = before.get(path),
      file = actual.get(path),
      row = planned.get(path);
    if (
      row
        ? !file || file.digest !== row.contentHash || file.mode !== (old?.mode ?? "100644")
        : old?.digest !== file?.digest || old?.mode !== file?.mode
    )
      throw new SiteBuildError("conflict");
  }
}
function retainedArtifacts(value: unknown): NpSiteBuildGeneratorRetainedArtifactV1[] {
  if (value === undefined) return [];
  inspectJson(value);
  if (!Array.isArray(value) || value.length > 1000) throw new SiteBuildError("input");
  const paths = new Set<string>();
  return value
    .map((row: unknown) => {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(",") !== "bytes,path,sha256"
      )
        throw new SiteBuildError("input");
      const file = row as NpSiteBuildGeneratorRetainedArtifactV1;
      if (
        typeof file.path !== "string" ||
        file.path.length > 240 ||
        !/^\.nexpress\/site\/(?:review|audit)\//u.test(file.path) ||
        file.path
          .split("/")
          .some(
            (part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9_.-]+$/u.test(part),
          ) ||
        paths.has(file.path) ||
        typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        file.bytes > 2 * 1024 * 1024 * 1024
      )
        throw new SiteBuildError("input");
      paths.add(file.path);
      return { path: file.path, sha256: file.sha256, bytes: file.bytes };
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

/**
 * Host-only coordinator: data descriptors, acknowledgement hashes and paths alone
 * grant no execution or publication authority. Root owns actual repository, image,
 * registry, selected comparison and verification leases. Dry-run runs the same
 * private commands and final verifier; only publish+exact acknowledgement can enter
 * native source publication. Root's verifier may retain evidence under excluded
 * review/audit paths. Both modes always discard this controller's candidate.
 *
 * Publication retains the native owner's same-OS-principal CAS limitation and
 * honest partial-failure semantics; there is no multi-file transaction or rollback.
 */
export async function runSiteBuildGeneratorControllerV1(
  input: NpSiteBuildGeneratorControllerInputV1,
): Promise<NpSiteBuildGeneratorControllerReceiptV1> {
  const started = Date.now();
  let stage: Stage = "input",
    plan: NpSiteBuildPrivateRepositoryEditPlanV1 | undefined,
    publication: NpSiteBuildRepositoryPublicationV1 | undefined,
    publicationResult:
      Awaited<ReturnType<NpSiteBuildRepositoryPublicationV1["publish"]>> | undefined,
    publishing = false,
    failure: unknown,
    cleanupFailed = false,
    planCleanupFailed = false,
    caught = false,
    validatedBlueprint: NpAgentSiteBlueprintV1 | undefined,
    execution: NpSiteBuildCommandExecutionReceiptV1 | undefined,
    failureEvidence: "not-requested" | "retained" | "retention-failed" = "not-requested",
    result: NpSiteBuildGeneratorControllerReceiptV1 | undefined;
  try {
    if (
      typeof input.observeRepository !== "function" ||
      typeof input.verifyCandidate !== "function" ||
      typeof input.prepared?.assertUnchanged !== "function" ||
      typeof input.registry?.assertUnchanged !== "function" ||
      (input.beforePrivateCleanup !== undefined && typeof input.beforePrivateCleanup !== "function")
    )
      throw new SiteBuildError("unavailable");
    const runMode = input.runMode ?? "dry-run";
    if (!["dry-run", "publish"].includes(runMode)) throw new SiteBuildError("arguments");
    inspectJson(input.blueprint);
    const blueprint = npRequireAgentSiteBlueprintV1(input.blueprint),
      blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
    validatedBlueprint = blueprint;
    if (
      runMode === "publish"
        ? input.acknowledgePlanHash !== blueprintHash
        : input.acknowledgePlanHash != null
    )
      throw new SiteBuildError("arguments");
    if (
      input.project !== resolve(input.project) ||
      (await realpath(input.project)) !== input.project
    )
      throw new SiteBuildError("path");
    const project = input.project;
    stage = "observe";
    const repository = await input.observeRepository(project);
    if (typeof repository.assertUnchanged !== "function") throw new SiteBuildError("unavailable");
    inspectJson(repository.dirtyPaths);
    if (
      !Array.isArray(repository.dirtyPaths) ||
      repository.dirtyPaths.length > 10000 ||
      repository.dirtyPaths.some((path) => typeof path !== "string")
    )
      throw new SiteBuildError("input");
    const dirtyPaths = [...new Set(repository.dirtyPaths)].sort((a, b) =>
        Buffer.compare(Buffer.from(a), Buffer.from(b)),
      ),
      originalSource = await readSiteSourceTreeV1(project);
    await repository.assertUnchanged();
    await input.prepared.assertUnchanged();
    await input.registry.assertUnchanged();
    if (input.registry.fingerprint !== blueprint.commandRegistryFingerprint)
      throw new SiteBuildError("conflict");
    beforeMatchesPlan(originalSource.manifest, blueprint);
    stage = "copy";
    plan = await prepareSiteBuildRepositoryEditPlanV1({
      scope: "private-build-copy",
      project,
      blueprint,
      baseline: originalSource.manifest,
      dirtyPaths,
    });
    const privateBaseline = await readSiteSourceTreeV1(plan.project);
    if (
      privateBaseline.digest !== plan.receipt.privateBaselineTreeDigest ||
      originalSource.digest !== plan.receipt.baselineTreeDigest ||
      blueprintHash !== plan.receipt.blueprintHash
    )
      throw new SiteBuildError("conflict");
    beforeMatchesPlan(privateBaseline.manifest, blueprint);
    stage = "stage";
    await plan.apply();
    stage = "dependencies";
    const materialized = await materializeSiteBuildCandidateDependenciesV1({
      scope: "private-build-copy",
      project: plan.project,
      dependencies: input.prepared.dependencies,
      assertPreparedUnchanged: () => input.prepared.assertUnchanged(),
    });
    const stagedSource = await readSiteSourceTreeV1(plan.project),
      evidence: NpSiteBuildCommandObservedEvidenceV1[] = [];
    const observers: NpSiteBuildCommandExecutorInputV1["observers"] = {};
    for (const name of ["doctor", "previewRender", "verify"] as const) {
      const observe = input.observers?.[name];
      if (observe)
        observers[name] = async (context) => {
          const observed = await observe(context);
          evidence.push(observed);
          return observed;
        };
    }
    stage = "commands";
    execution = await executeSiteBuildBlueprintCommandsV1({
      project: plan.project,
      dependencies: materialized.dependencies,
      baseImageId: input.prepared.baseImageId,
      config: input.config,
      blueprint,
      privateBaseline: privateBaseline.manifest,
      registry: input.registry,
      assertDependenciesUnchanged: () => materialized.assertUnchanged(),
      observers,
      generationContext: input.generationContext,
      nextPreview: input.nextPreview,
    });
    const candidateSource = await readSiteSourceTreeV1(plan.project);
    if (
      execution.blueprintHash !== blueprintHash ||
      execution.baselineTreeDigest !== privateBaseline.digest ||
      execution.commandRegistryFingerprint !== blueprint.commandRegistryFingerprint ||
      execution.sourceBefore.digest !== stagedSource.digest ||
      execution.sourceAfter.digest !== candidateSource.digest ||
      execution.commands.length !== blueprint.commands.length ||
      execution.commands.some(
        (row, index) =>
          row.commandId !== blueprint.commands[index].id ||
          row.template !== blueprint.commands[index].template ||
          row.exitCode !== 0,
      )
    )
      throw new SiteBuildError("conflict");
    finalMatchesPlan(candidateSource, privateBaseline.manifest, blueprint);
    const assertPreconditions = async () => {
      await repository.assertUnchanged();
      await plan!.assertOriginalUnchanged();
      await materialized.assertUnchanged();
      await input.registry.assertUnchanged();
      for (const observed of evidence) await observed.assertUnchanged();
      if (
        input.registry.fingerprint !== blueprint.commandRegistryFingerprint ||
        (await readSiteSourceTreeV1(project)).digest !== originalSource.digest ||
        (await readSiteSourceTreeV1(plan!.project)).digest !== candidateSource.digest
      )
        throw new SiteBuildError("conflict");
    };
    await assertPreconditions();
    stage = "verify";
    const verified = await input.verifyCandidate({
      originalProject: project,
      project: plan.project,
      dependencies: materialized.dependencies,
      ...structuredClone({
        blueprint,
        blueprintHash,
        originalSource,
        privateBaseline,
        candidateSource,
        editPlan: plan.receipt,
        execution,
      }),
    });
    if (!verified || typeof verified.assertUnchanged !== "function")
      throw new SiteBuildError("unavailable");
    const verification = {
      blueprintHash: verified.blueprintHash,
      originalTreeDigest: verified.originalTreeDigest,
      candidateTreeDigest: verified.candidateTreeDigest,
      retainedArtifactsReportedByVerifier: retainedArtifacts(verified.retainedArtifacts),
    };
    const assertVerified = async () => {
      if (
        verified.blueprintHash !== blueprintHash ||
        verified.originalTreeDigest !== originalSource.digest ||
        verified.candidateTreeDigest !== candidateSource.digest
      )
        throw new SiteBuildError("conflict");
      await verified.assertUnchanged();
      await assertPreconditions();
    };
    await assertVerified();
    if (runMode === "publish") {
      stage = "publish-preflight";
      publication = await prepareSiteBuildRepositoryPublicationV1({
        project,
        blueprint,
        baseline: originalSource.manifest,
        dirtyPaths,
        candidate: { project: plan.project, sourceTree: candidateSource.manifest },
      });
      if (
        publication.receipt.blueprintHash !== blueprintHash ||
        publication.receipt.baselineTreeDigest !== originalSource.digest ||
        publication.receipt.candidateTreeDigest !== candidateSource.digest
      )
        throw new SiteBuildError("conflict");
      await assertVerified();
      stage = "publish";
      publishing = true;
      publicationResult = await publication.publish();
    }
    const originalSourceAfter = await readSiteSourceTreeV1(project);
    if (publicationResult)
      finalMatchesPlan(originalSourceAfter, originalSource.manifest, blueprint);
    else if (originalSourceAfter.digest !== originalSource.digest)
      throw new SiteBuildError("conflict");
    result = {
      schemaVersion: "np.site-build-generator-controller.v1",
      runMode,
      blueprintHash,
      originalSource,
      originalSourceAfter,
      privateBaseline,
      candidateSource,
      dirtyPaths,
      editPlan: plan.receipt,
      dependencies: {
        profile: materialized.profile,
        digest: materialized.digest,
        files: materialized.files,
        bytes: materialized.bytes,
      },
      execution,
      verification,
      publication:
        publication && publicationResult
          ? { receipt: publication.receipt, result: publicationResult }
          : null,
      privateCopy: "removed",
      privateArtifactsRetained: false,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    failure = error;
    caught = true;
  } finally {
    if (caught && plan && validatedBlueprint && input.beforePrivateCleanup) {
      try {
        await input.beforePrivateCleanup({
          project: plan.project,
          blueprint: structuredClone(validatedBlueprint),
          failure,
          ...(execution ? { execution: structuredClone(execution) } : {}),
        });
        failureEvidence = "retained";
      } catch {
        failureEvidence = "retention-failed";
      }
    }
    for (const owned of [publication, plan])
      if (owned)
        try {
          await owned.close();
        } catch {
          cleanupFailed = true;
          if (owned === plan) planCleanupFailed = true;
        }
  }
  if (caught || cleanupFailed || !result) {
    const native = failure instanceof NpSiteBuildRepositoryPublicationErrorV1 ? failure : null;
    throw new NpSiteBuildGeneratorControllerErrorV1(
      failure instanceof SiteBuildError ? failure.reason : "unavailable",
      cleanupFailed && !caught ? "cleanup" : stage,
      native
        ? native.publicationState === "partial-changes-may-remain"
          ? "partial-changes-may-remain"
          : "not-started"
        : publishing && !publicationResult
          ? "partial-changes-may-remain"
          : publicationResult
            ? "completed"
            : "not-started",
      plan ? (planCleanupFailed ? "cleanup-failed" : "removed") : "not-created",
      native
        ? {
            publicationState: native.publicationState,
            writtenPaths: [...native.writtenPaths],
            unchangedPaths: [...native.unchangedPaths],
            uncertainPaths: [...native.uncertainPaths],
          }
        : null,
      failureEvidence,
    );
  }
  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.now() - started;
  return result;
}
