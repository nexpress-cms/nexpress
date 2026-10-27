import { isDeepStrictEqual } from "node:util";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npBuildInstalledCatalogDigestV1,
  npBuildInstalledBlockDefinitionFingerprintsV1,
  npParseAgentSiteBlueprintV1,
  npParseBuildCandidateTransportJsonV1,
  npRequireAgentBuildCollectionDefinitionV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildInstalledCatalogV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentBuildRenderFixtureRefV1,
  npRequireAgentBuildSourceTreeV1,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireBuildBlueprintForBriefV1,
  npRequireBuildDirectionSetForBriefV1,
  npRequireBuildReadyBriefV1,
  type NpAgentBuildCollectionDefinitionV1,
  type NpAgentBuildDirectionRendererV1,
  type NpAgentBuildSourceTreeV1,
} from "@nexpress/core/agent-contract";
import { SiteBuildError } from "./artifact-io.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxAuditV1,
  type NpSiteBuildLinuxSandboxImageV1,
} from "./linux-sandbox.js";
import { requireSiteBuildRepositorySeedFilesV1 } from "./repository-seed.js";
import { requireSiteBuildGenerationContextV1 } from "./generation-context.js";
import {
  assertSiteBuildObservationActiveV1,
  type NpSiteBuildObservationCancellationV1,
} from "./observation-deadline.js";

type Source = NpAgentBuildSourceTreeV1;
type SourceFile = Source["files"][number];
type FileState = Pick<SourceFile, "mode" | "digest">;
type Change = { path: string; before: FileState | null; after: FileState };
type Clock = { now: string; randomSeed: string };
const metadataPath = ".np-build-runtime.json";
const maximum = 8 * 1024 * 1024;
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const fail = (reason: "input" | "conflict" | "unavailable" = "conflict"): never => {
  throw new SiteBuildError(reason);
};
const equal = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);

/**
 * An actual runtime producer must hold its cache/package/source lease AND its
 * original originInputs/raw-source mapping lease. JSON or a no-op callback is
 * not provenance. The generator owns that mapping, fixed omission policy and
 * preparation rewrites; this observer never accepts caller-selected omissions.
 * Controller original and current raw-source CAS leases are supplied separately
 * and composed with the runtime owners.
 */
export interface NpSiteBuildCandidateRuntimeV1 {
  project: string;
  renderer: NpAgentBuildDirectionRendererV1;
  runtimeFilesDigest: string;
  clock: Clock;
  assertUnchanged(): Promise<void>;
}
/** Controller-owned raw snapshot/CAS lease, before render-copy omissions. */
export interface NpSiteBuildCandidateSourceV1 {
  manifest: Source;
  assertUnchanged(): Promise<void>;
}
interface CallbackOwner {
  slug: string;
  callbacks: string[];
  owner: "@nexpress/app/config-defaults.defaultCollections" | "source-capsule";
}
export interface NpSiteBuildCandidateSourceDeltaV1 {
  schemaVersion: "np.site-build-candidate-source-delta.v1";
  scope: "render-profile-filtered";
  originalSource: Source;
  baselineRendererFingerprint: string;
  candidateRendererFingerprint: string;
  runtimeMetadata: {
    schemaVersion: "np.site-build-candidate-runtime-metadata-derivation.v1";
    owner: "np.site-build-runtime-reference.v1";
    path: ".np-build-runtime.json";
    before: { rendererFingerprint: string; sourceFile: SourceFile };
    after: { rendererFingerprint: string; sourceFile: SourceFile };
  };
  changes: Change[];
}

function record(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("input");
  const body = value as Record<string, unknown>;
  if (!equal(Object.keys(body).sort(compare), [...expected].sort(compare))) return fail("input");
  return body;
}
function definitions(value: unknown): NpAgentBuildCollectionDefinitionV1[] {
  if (!Array.isArray(value) || value.length > 64) return fail("input");
  const result = value.map(npRequireAgentBuildCollectionDefinitionV1);
  const slug = (row: NpAgentBuildCollectionDefinitionV1) =>
    typeof row.configuration.slug === "string" ? row.configuration.slug : fail("input");
  if (result.some((row, i) => i > 0 && compare(slug(result[i - 1]), slug(row)) >= 0))
    return fail("input");
  return result;
}
function callbackOwners(
  value: unknown,
  actual: NpAgentBuildCollectionDefinitionV1[],
): CallbackOwner[] {
  if (!Array.isArray(value) || value.length > 64) return fail("input");
  const expected = actual.filter((row) => row.callbacks.length);
  if (expected.length !== value.length) return fail("input");
  return value.map((item, index) => {
    const row = record(item, ["slug", "callbacks", "owner"]);
    if (
      typeof row.slug !== "string" ||
      row.slug !== expected[index].configuration.slug ||
      !equal(row.callbacks, expected[index].callbacks) ||
      (row.owner !== "@nexpress/app/config-defaults.defaultCollections" &&
        row.owner !== "source-capsule")
    )
      return fail("input");
    return { slug: row.slug, callbacks: [...expected[index].callbacks], owner: row.owner };
  });
}
function changes(before: Source, after: Source, omitMetadata: boolean): Change[] {
  const prior = new Map(before.files.map((row) => [row.path, row]));
  const current = new Map(after.files.map((row) => [row.path, row]));
  const result: Change[] = [];
  for (const path of [...new Set([...prior.keys(), ...current.keys()])].sort(compare)) {
    if (omitMetadata && path === metadataPath) continue;
    const old = prior.get(path),
      next = current.get(path);
    if (equal(old ?? null, next ?? null)) continue;
    if (!next) return fail();
    result.push({
      path,
      before: old ? { mode: old.mode, digest: old.digest } : null,
      after: { mode: next.mode, digest: next.digest },
    });
  }
  return result;
}
function requirePlanDelta(
  changed: Change[],
  plan: Awaited<ReturnType<typeof npRequireBuildBlueprintForBriefV1>>["filePlan"],
): void {
  if (changed.length !== plan.length) fail();
  for (const change of changed) {
    const row = plan.find((entry) => entry.path === change.path);
    if (
      !row ||
      row.path === metadataPath ||
      row.expectedHash !== (change.before?.digest ?? null) ||
      row.contentHash !== change.after.digest ||
      row.action !== (change.before ? "update" : "create") ||
      change.after.mode !== (change.before?.mode ?? "100644")
    )
      fail();
  }
}
function requireAudit(value: NpSiteBuildLinuxAuditV1): void {
  if (
    value.schemaVersion !== "np.site-build-linux-audit.v1" ||
    value.status !== "passed" ||
    value.reason !== "none" ||
    value.rootExitCode !== 0 ||
    value.rootSignal !== 0 ||
    value.forbiddenAttempts !== 0 ||
    value.argumentsFrozen !== true ||
    value.descendantsReaped !== true ||
    value.ownIpcReclaimed !== true ||
    !Number.isSafeInteger(value.tracedProcesses) ||
    value.tracedProcesses < 1 ||
    value.tracedProcesses !== value.reapedProcesses
  )
    fail("unavailable");
}
function nativeJson(bytes: Uint8Array): Record<string, unknown> {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maximum)
    return fail("input");
  const parsed = npParseBuildCandidateTransportJsonV1(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("input");
  return parsed;
}

/**
 * Calls the fixed native worker twice. It never accepts a serialized baseline
 * validator result from a caller. Native image branding is enforced by the
 * sandbox owner, not by this interface or any persisted descriptor. Its return
 * establishes declarations/source binding only, never migrations, DB/seed
 * persistence, browser success, approval or publication authority.
 */
export async function observeSiteBuildCandidateV1(
  input: NpSiteBuildObservationCancellationV1 & {
    image: NpSiteBuildLinuxSandboxImageV1;
    brief: unknown;
    sealedDirections: unknown;
    blueprint: unknown;
    config: "src/nexpress.config.ts" | "nexpress.config.ts";
    generationContext: unknown;
    comparisonEnvironment: unknown;
    baselineRuntime: NpSiteBuildCandidateRuntimeV1;
    candidateRuntime: NpSiteBuildCandidateRuntimeV1;
    baselineOriginalSource: NpSiteBuildCandidateSourceV1;
    candidateSource: NpSiteBuildCandidateSourceV1;
  },
) {
  assertSiteBuildObservationActiveV1(input);
  const brief = npRequireBuildReadyBriefV1(input.brief);
  const set = await npRequireBuildDirectionSetForBriefV1(brief, input.sealedDirections, "sealed");
  const blueprint = await npRequireBuildBlueprintForBriefV1(brief, input.blueprint);
  if (!["src/nexpress.config.ts", "nexpress.config.ts"].includes(input.config)) fail("input");
  const config = input.config;
  const generation = requireSiteBuildGenerationContextV1(input.generationContext);
  const environment = npRequireAgentBuildRenderEnvironmentV1(input.comparisonEnvironment);
  const baselineRenderer = npRequireAgentBuildDirectionRendererV1(input.baselineRuntime.renderer);
  const candidateRenderer = npRequireAgentBuildDirectionRendererV1(input.candidateRuntime.renderer);
  const runtimeFiles = {
    baseline: input.baselineRuntime.runtimeFilesDigest,
    candidate: input.candidateRuntime.runtimeFilesDigest,
  };
  if (Object.values(runtimeFiles).some((digest) => !/^[a-f0-9]{64}$/u.test(digest))) fail("input");
  const rawBefore = npRequireAgentBuildSourceTreeV1(input.baselineOriginalSource.manifest);
  const rawAfter = npRequireAgentBuildSourceTreeV1(input.candidateSource.manifest);
  const baselineFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    baselineRenderer,
  );
  const candidateFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    candidateRenderer,
  );
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const selected = set.directions.find((row) => row.id === blueprint.selectedDirectionId) ?? fail();
  if (
    blueprint.selectedDirectionHash !== generation.selectedDirectionHash ||
    generation.selectedDirectionHash !==
      (await npBuildCanonicalDigest("np.build-design-direction.v1", selected)) ||
    generation.comparisonInputsDigest !== set.comparisonInputsDigest ||
    generation.selectedRenderEnvironmentFingerprint !==
      (await npBuildCanonicalDigest("np.build-render-environment.v1", environment)) ||
    environment.sandbox !== "np.linux-build-sandbox.v1" ||
    environment.linux.imageId !== input.image.imageId ||
    environment.linux.runtimeFilesSha256 !== input.baselineRuntime.runtimeFilesDigest ||
    !equal(environment.clock, generation.clock) ||
    !equal(input.baselineRuntime.clock, generation.clock) ||
    !equal(input.candidateRuntime.clock, generation.clock) ||
    !equal(baselineRenderer.packages, candidateRenderer.packages) ||
    selected.previewArtifact.desktop.rendererFingerprint !== baselineFingerprint ||
    selected.previewArtifact.mobile.rendererFingerprint !== baselineFingerprint ||
    blueprint.directionSetHash !==
      (await npBuildCanonicalDigest("np.build-design-direction-set.v1", set)) ||
    blueprint.selectedDirectionProjectionDigest !== selected.projectionDigest ||
    [baselineRenderer, candidateRenderer].some(
      (renderer) => !renderer.projectSources.files.some((row) => row.path === config),
    )
  )
    fail();
  const before = baselineRenderer.projectSources;
  const after = candidateRenderer.projectSources;
  const beforeMetadata = before.files.find((row) => row.path === metadataPath) ?? fail();
  const afterMetadata = after.files.find((row) => row.path === metadataPath) ?? fail();
  if (
    beforeMetadata.mode !== "100644" ||
    afterMetadata.mode !== "100644" ||
    blueprint.filePlan.some((row) => row.path === metadataPath) ||
    rawBefore.files.some((row) => row.path === metadataPath) ||
    rawAfter.files.some((row) => row.path === metadataPath)
  )
    fail();
  const authored = changes(before, after, true);
  requirePlanDelta(authored, blueprint.filePlan);
  requirePlanDelta(changes(rawBefore, rawAfter, false), blueprint.filePlan);
  if (authored.length && beforeMetadata.digest === afterMetadata.digest) fail();
  // Only selected synthetic fixtures may inhabit this reserved source subtree.
  const fixtures = new Set(
    set.comparisonInputs.sampleContent.map(
      (sample) => npRequireAgentBuildRenderFixtureRefV1(sample.data).stagedArtifactPath,
    ),
  );
  for (const renderer of [baselineRenderer, candidateRenderer]) {
    const actual = renderer.projectSources.files.filter((row) =>
      /^\.nexpress\/site(?:\/|$)/iu.test(row.path),
    );
    if (
      actual.length !== fixtures.size ||
      actual.some((row) => !fixtures.has(row.path) || row.mode !== "100644")
    )
      fail();
  }
  for (const path of fixtures) {
    if (
      !equal(
        before.files.find((row) => row.path === path),
        after.files.find((row) => row.path === path),
      ) ||
      blueprint.filePlan.some((row) => row.path === path)
    )
      fail();
  }
  const sourceDelta: NpSiteBuildCandidateSourceDeltaV1 = {
    schemaVersion: "np.site-build-candidate-source-delta.v1",
    scope: "render-profile-filtered",
    originalSource: npRequireAgentBuildSourceTreeV1({
      ...before,
      files: before.files.filter((row) => row.path !== metadataPath),
    }),
    baselineRendererFingerprint: baselineFingerprint,
    candidateRendererFingerprint: candidateFingerprint,
    runtimeMetadata: {
      schemaVersion: "np.site-build-candidate-runtime-metadata-derivation.v1",
      owner: "np.site-build-runtime-reference.v1",
      path: metadataPath,
      before: { rendererFingerprint: baselineFingerprint, sourceFile: beforeMetadata },
      after: { rendererFingerprint: candidateFingerprint, sourceFile: afterMetadata },
    },
    changes: authored,
  };
  const leaseOwners = [
    input.baselineRuntime,
    input.baselineOriginalSource,
    input.candidateRuntime,
    input.candidateSource,
  ];
  if (leaseOwners.some((owner) => typeof owner.assertUnchanged !== "function")) fail("input");
  const leaseChecks = leaseOwners.map((owner) => owner.assertUnchanged.bind(owner));
  const projects = {
    baseline: input.baselineRuntime.project,
    candidate: input.candidateRuntime.project,
  };
  const retained: Array<{
    artifact: { name: string; bytes: Uint8Array; digest: string };
    name: string;
    digest: string;
    maxBytes: number;
  }> = [];
  const checkLive = async (checkBudget = true) => {
    // Even cancelled/failed native transport must finish its source/cache
    // checks before this owner propagates cancellation to the caller.
    // Lease aliases may share a non-reentrant original-source owner.
    let rejected = false;
    for (const check of leaseChecks) {
      try {
        await check();
      } catch {
        rejected = true;
      }
    }
    if (rejected) fail();
    if (
      !equal(
        npRequireAgentBuildDirectionRendererV1(input.baselineRuntime.renderer),
        baselineRenderer,
      ) ||
      !equal(
        npRequireAgentBuildDirectionRendererV1(input.candidateRuntime.renderer),
        candidateRenderer,
      ) ||
      !equal(npRequireAgentBuildSourceTreeV1(input.baselineOriginalSource.manifest), rawBefore) ||
      !equal(npRequireAgentBuildSourceTreeV1(input.candidateSource.manifest), rawAfter) ||
      !equal(input.baselineRuntime.clock, generation.clock) ||
      !equal(input.candidateRuntime.clock, generation.clock) ||
      input.baselineRuntime.project !== projects.baseline ||
      input.candidateRuntime.project !== projects.candidate ||
      input.baselineRuntime.runtimeFilesDigest !== runtimeFiles.baseline ||
      input.candidateRuntime.runtimeFilesDigest !== runtimeFiles.candidate
    )
      fail();
    for (const capture of retained) {
      const artifact = capture.artifact;
      if (
        artifact.name !== capture.name ||
        artifact.digest !== capture.digest ||
        !(artifact.bytes instanceof Uint8Array) ||
        artifact.bytes.byteLength > capture.maxBytes ||
        (await npBuildFileDigest("np.build-verification-artifact.v1", artifact.bytes)) !==
          capture.digest
      )
        fail();
    }
    if (checkBudget) assertSiteBuildObservationActiveV1(input);
  };
  const job = async (
    mode: "blueprint" | "candidate",
    extra: Record<string, unknown>,
    requested: Array<{ name: string; maxBytes: number }>,
  ) => {
    await checkLive();
    try {
      const body = Buffer.from(
        JSON.stringify({
          mode,
          config,
          renderer: mode === "blueprint" ? baselineRenderer : candidateRenderer,
          clockNow: generation.clock.now,
          randomSeed: generation.clock.randomSeed,
          brief,
          directions: set,
          blueprint,
          ...extra,
        }),
      );
      if (body.byteLength > maximum) fail("input");
      const result = await runSiteBuildLinuxSandboxV1({
        image: input.image,
        project: mode === "blueprint" ? projects.baseline : projects.candidate,
        inputBytes: body,
        artifacts: requested,
        signal: input.signal,
      });
      requireAudit(result.audit);
      if (
        result.artifacts.size !== requested.length ||
        requested.some((row) => !result.artifacts.has(row.name))
      )
        fail("input");
      const artifacts = [];
      for (const item of requested) {
        const value = result.artifacts.get(item.name) ?? fail("input");
        if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > item.maxBytes)
          fail("input");
        const bytes = new Uint8Array(value);
        const artifact = {
          name: item.name,
          bytes,
          digest: await npBuildFileDigest("np.build-verification-artifact.v1", bytes),
        };
        artifacts.push(artifact);
        retained.push({
          artifact,
          name: artifact.name,
          digest: artifact.digest,
          maxBytes: item.maxBytes,
        });
      }
      return { audit: result.audit, artifacts };
    } finally {
      await checkLive();
    }
  };
  const baseline = await job("blueprint", {}, [
    { name: "blueprint.json", maxBytes: 4 * 1024 * 1024 },
    { name: "blueprint-report.json", maxBytes: maximum },
    { name: "candidate-baseline.json", maxBytes: maximum },
    { name: "repository-seed.json", maxBytes: 4 * 1024 * 1024 },
  ]);
  const bytes = (name: string) =>
    baseline.artifacts.find((row) => row.name === name)?.bytes ?? fail("input");
  const returnedBlueprint = npParseAgentSiteBlueprintV1(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes("blueprint.json")),
  );
  if (
    !Buffer.from(
      npBuildCanonicalBytes("np.build-site-blueprint.v1", returnedBlueprint).canonicalJsonUtf8,
    ).equals(npBuildCanonicalBytes("np.build-site-blueprint.v1", blueprint).canonicalJsonUtf8)
  )
    fail();
  const report = record(nativeJson(bytes("blueprint-report.json")), [
    "scope",
    "blueprintHash",
    "discoveryFingerprint",
    "expectedCollectionDefinitions",
  ]);
  const observed = record(nativeJson(bytes("candidate-baseline.json")), [
    "schemaVersion",
    "catalog",
    "fingerprint",
    "blueprintHash",
    "expectedCollectionDefinitions",
    "callbackOwners",
  ]);
  const catalog = npRequireAgentBuildInstalledCatalogV1(observed.catalog);
  const fingerprint = await npBuildInstalledCatalogDigestV1(catalog);
  const expectedDefinitions = definitions(observed.expectedCollectionDefinitions);
  const owners = callbackOwners(observed.callbackOwners, catalog.collections);
  if (
    report.scope !== "declarations-only" ||
    report.blueprintHash !== blueprintHash ||
    report.discoveryFingerprint !== fingerprint ||
    observed.schemaVersion !== "np.site-build-candidate-baseline.v1" ||
    observed.blueprintHash !== blueprintHash ||
    observed.fingerprint !== fingerprint ||
    blueprint.discoveryFingerprint !== fingerprint ||
    set.discoveryFingerprint !== fingerprint ||
    !equal(catalog.sourceCapsule, baselineRenderer) ||
    !equal(definitions(report.expectedCollectionDefinitions), expectedDefinitions)
  )
    fail();
  const seedFiles = await requireSiteBuildRepositorySeedFilesV1({
    blueprint,
    configPath: config,
    seedArtifactBytes: bytes("repository-seed.json"),
  });
  const seedEnvelope = nativeJson(bytes("repository-seed.json"));
  const seedTheme = record(seedEnvelope.theme, ["id", "package", "tokens"]);
  const selectedTheme = catalog.themes.find((theme) => theme.package === selected.themeBase);
  if (
    !selectedTheme ||
    seedTheme.id !== selectedTheme.id ||
    seedTheme.package !== selectedTheme.package
  )
    fail();
  const candidateJob = await job("candidate", { baseline: observed, sourceDelta }, [
    { name: "candidate.json", maxBytes: maximum },
  ]);
  const result = record(nativeJson(candidateJob.artifacts[0].bytes), [
    "scope",
    "baselineDiscoveryFingerprint",
    "currentDiscoveryFingerprint",
    "baselineRendererFingerprint",
    "currentRendererFingerprint",
    "blueprintHash",
    "sourceValidationScope",
    "originalRawSourceCas",
    "runtimeMetadataDerivation",
    "runtimeMetadataObservation",
    "catalog",
    "actualCollectionDefinitions",
    "callbackOwners",
    "candidateDraft",
    "selectedDirectionId",
    "seedValidation",
    "runtimeEvidence",
  ]);
  const currentCatalog = npRequireAgentBuildInstalledCatalogV1(result.catalog);
  const currentFingerprint = await npBuildInstalledCatalogDigestV1(currentCatalog);
  const currentDefinitions = definitions(result.actualCollectionDefinitions);
  const currentOwners = callbackOwners(result.callbackOwners, currentDefinitions);
  const candidateDraft = npRequireAgentDesignDirectionDraftSetV1(result.candidateDraft);
  const {
    sourceCapsule: _baselineSource,
    collections: _baselineCollections,
    ...baselineInstalled
  } = catalog;
  const {
    sourceCapsule: _candidateSource,
    collections: _candidateCollections,
    ...currentInstalled
  } = currentCatalog;
  const comparisonInputs = structuredClone(set.comparisonInputs);
  comparisonInputs.projectionInputs.discoveryFingerprint = currentFingerprint;
  comparisonInputs.projectionInputs.blockDefinitionFingerprints = [
    ...new Set(
      (await npBuildInstalledBlockDefinitionFingerprintsV1(currentCatalog))
        .filter((row) => comparisonInputs.projectionInputs.themeBaseIds.includes(row.themePackage))
        .map((row) => row.fingerprint),
    ),
  ].sort(compare);
  if (
    result.scope !== "post-apply-declarations-only" ||
    result.baselineDiscoveryFingerprint !== fingerprint ||
    result.currentDiscoveryFingerprint !== currentFingerprint ||
    result.baselineRendererFingerprint !== baselineFingerprint ||
    result.currentRendererFingerprint !== candidateFingerprint ||
    result.blueprintHash !== blueprintHash ||
    result.sourceValidationScope !== "host-observed-render-profile-manifests" ||
    result.originalRawSourceCas !== "required-from-host" ||
    result.runtimeMetadataObservation !== "host-live-byte-owner-required" ||
    !equal(result.runtimeMetadataDerivation, sourceDelta.runtimeMetadata) ||
    !equal(currentCatalog.sourceCapsule, candidateRenderer) ||
    !equal(baselineInstalled, currentInstalled) ||
    !equal(currentDefinitions, currentCatalog.collections) ||
    !equal(
      currentDefinitions,
      expectedDefinitions.map((row) => ({
        ...row,
        sourceCapsuleDigest: row.callbacks.length ? candidateFingerprint : null,
      })),
    ) ||
    !equal(currentOwners, owners) ||
    (baselineFingerprint !== candidateFingerprint &&
      owners.some((owner) => owner.owner === "source-capsule")) ||
    result.selectedDirectionId !== selected.id ||
    result.seedValidation !== "exact-actual-definitions-match-validated-baseline" ||
    result.runtimeEvidence !== "unverified" ||
    candidateDraft.briefHash !== set.briefHash ||
    candidateDraft.discoveryFingerprint !== currentFingerprint ||
    !equal(candidateDraft.comparisonInputs, comparisonInputs) ||
    !equal(
      candidateDraft.directions,
      set.directions.map((direction) => ({
        ...npBuildDirectionProjectionV1(direction),
        schemaVersion: "np.agent-design-direction-draft.v1",
        discoveryFingerprint: currentFingerprint,
        comparisonInputsDigest: candidateDraft.comparisonInputsDigest,
      })),
    )
  )
    fail();
  await checkLive();
  return {
    schemaVersion: "np.site-build-candidate-observation.v1" as const,
    scope: "fresh-native-declarations-and-exact-source-delta" as const,
    blueprintHash,
    generationContext: generation,
    runtimes: {
      baseline: {
        rendererFingerprint: baselineFingerprint,
        runtimeFilesDigest: runtimeFiles.baseline,
      },
      candidate: {
        rendererFingerprint: candidateFingerprint,
        runtimeFilesDigest: runtimeFiles.candidate,
      },
    },
    sourceDelta,
    fixtureSource: "unchanged" as const,
    originalRawSource: {
      baselineDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", rawBefore),
      candidateDigest: await npBuildCanonicalDigest("np.build-source-tree.v1", rawAfter),
    },
    filteredOriginalSourceDigest: await npBuildCanonicalDigest(
      "np.build-source-tree.v1",
      sourceDelta.originalSource,
    ),
    baseline: {
      ...baseline,
      blueprint: returnedBlueprint,
      report: {
        scope: "declarations-only" as const,
        blueprintHash,
        discoveryFingerprint: fingerprint,
        expectedCollectionDefinitions: expectedDefinitions,
      },
      candidateBaseline: {
        schemaVersion: "np.site-build-candidate-baseline.v1" as const,
        fingerprint,
        blueprintHash,
        catalog,
        callbackOwners: owners,
        expectedCollectionDefinitions: expectedDefinitions,
      },
      seedFiles,
    },
    candidate: {
      ...candidateJob,
      result: {
        scope: "post-apply-declarations-only" as const,
        baselineDiscoveryFingerprint: fingerprint,
        currentDiscoveryFingerprint: currentFingerprint,
        baselineRendererFingerprint: baselineFingerprint,
        currentRendererFingerprint: candidateFingerprint,
        blueprintHash,
        sourceValidationScope: "host-observed-render-profile-manifests" as const,
        originalRawSourceCas: "required-from-host" as const,
        runtimeMetadataDerivation: sourceDelta.runtimeMetadata,
        runtimeMetadataObservation: "host-live-byte-owner-required" as const,
        catalog: currentCatalog,
        actualCollectionDefinitions: currentDefinitions,
        callbackOwners: currentOwners,
        candidateDraft,
        selectedDirectionId: selected.id,
        seedValidation: "exact-actual-definitions-match-validated-baseline" as const,
        runtimeEvidence: "unverified" as const,
      },
    },
    // Completed declarations retain their byte/source leases across commands.
    // Each later observer owns its own budget instead of reusing this one.
    assertUnchanged: () => checkLive(false),
  };
}
