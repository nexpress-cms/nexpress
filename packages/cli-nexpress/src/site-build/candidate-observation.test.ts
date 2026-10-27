import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npBuildInstalledCatalogDigestV1,
  npRequireAgentBuildDirectionRendererV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentDesignDirectionDraftSetV1,
  npRequireAgentDesignDirectionDraftV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBuildSourceTreeV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import rendererVector from "../../../core/src/build-contract/__fixtures__/renderer-v1.json" with { type: "json" };
import executionVector from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import { SiteBuildError } from "./artifact-io.js";
import { observeSiteBuildCandidateV1 } from "./candidate-observation.js";
import {
  runSiteBuildLinuxSandboxV1,
  type NpSiteBuildLinuxSandboxImageV1,
} from "./linux-sandbox.js";
import { createSiteBuildRepositorySeedFilesV1 } from "./repository-seed.js";

vi.mock("./linux-sandbox.js", () => ({ runSiteBuildLinuxSandboxV1: vi.fn() }));
const sandbox = vi.mocked(runSiteBuildLinuxSandboxV1);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sourceHash = (text: string | Uint8Array) =>
  npBuildFileDigest("np.build-source-file.v1", typeof text === "string" ? Buffer.from(text) : text);
type SourceRow = NpAgentBuildSourceTreeV1["files"][number];
const source = (files: SourceRow[]): NpAgentBuildSourceTreeV1 => ({
  schemaVersion: "np.agent-build-source-tree.v1",
  files: files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))),
});
const row = async (path: string, text: string): Promise<SourceRow> => ({
  path,
  kind: "file",
  mode: "100644",
  digest: await sourceHash(text),
});
// Transport double ONLY. These tests do not run or authenticate Linux, App,
// original-source mapping, native image creation, actual seed, DB or browser.
const audit = {
  schemaVersion: "np.site-build-linux-audit.v1" as const,
  status: "passed" as const,
  reason: "none",
  rootExitCode: 0,
  rootSignal: 0,
  tracedProcesses: 1,
  reapedProcesses: 1,
  descendantsReaped: true,
  argumentsFrozen: true,
  ownIpcReclaimed: true,
  forbiddenAttempts: 0,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const renderer = npRequireAgentBuildDirectionRendererV1(
    JSON.parse(rendererVector.structured[0].canonical),
  );
  renderer.packages.push({
    name: "@nexpress/theme-default",
    version: "0.4.6",
    contentDigest: renderer.packages[0].contentDigest,
  });
  renderer.packages.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  const configRow = await row("src/nexpress.config.ts", "export default {};\n");
  const dirtyRow = await row("src/operator-dirty.ts", "unrelated dirty content\n");
  const artifactRow = await row(
    ".nexpress/site/brief.json",
    "original artifact remains outside renderer\n",
  );
  const fixtureRow = await row(".nexpress/site/fixtures/home.json", "synthetic fixture bytes\n");
  const metadataBefore = await row(".np-build-runtime.json", "actual baseline runtime metadata\n");
  const metadataAfter = await row(".np-build-runtime.json", "actual candidate runtime metadata\n");
  renderer.projectSources = source([configRow, dirtyRow, fixtureRow, metadataBefore]);
  const catalog = JSON.parse(rendererVector.catalog.canonical);
  catalog.sourceCapsule = renderer;
  catalog.themes[0].package = "@nexpress/theme-default";
  catalog.themes[0].id = "default";
  const baselineDiscovery = await npBuildInstalledCatalogDigestV1(catalog);
  const baselineRendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    renderer,
  );
  const sealedDirections = npRequireAgentDesignDirectionSetV1(structuredClone(directionVector.set));
  sealedDirections.discoveryFingerprint = baselineDiscovery;
  sealedDirections.comparisonInputs.projectionInputs.discoveryFingerprint = baselineDiscovery;
  sealedDirections.comparisonInputs.sampleContent[0].data = {
    schemaVersion: "np.agent-build-render-fixture-ref.v1",
    stagedArtifactPath: fixtureRow.path,
    digest: await npBuildFileDigest(
      "np.build-staged-artifact.v1",
      Buffer.from("synthetic fixture bytes\n"),
    ),
    pageDocumentId: "00000000-0000-4000-8000-000000000001",
  };
  sealedDirections.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    sealedDirections.comparisonInputs,
  );
  for (const direction of sealedDirections.directions) {
    direction.discoveryFingerprint = baselineDiscovery;
    direction.comparisonInputsDigest = sealedDirections.comparisonInputsDigest;
    const { previewArtifact: _preview, projectionDigest: _projection, ...body } = direction;
    direction.projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      npBuildDirectionProjectionV1(
        npRequireAgentDesignDirectionDraftV1({
          ...body,
          schemaVersion: "np.agent-design-direction-draft.v1",
        }),
      ),
    );
    for (const viewport of ["desktop", "mobile"] as const)
      Object.assign(direction.previewArtifact[viewport], {
        rendererFingerprint: baselineRendererFingerprint,
        comparisonInputsDigest: sealedDirections.comparisonInputsDigest,
        directionProjectionDigest: direction.projectionDigest,
      });
  }
  const blueprint = npRequireAgentSiteBlueprintV1(
    JSON.parse(
      canonical.structured.find((item) => item.purpose === "np.build-site-blueprint.v1")!.canonical,
    ),
  );
  blueprint.briefHash = sealedDirections.briefHash;
  blueprint.discoveryFingerprint = baselineDiscovery;
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    sealedDirections,
  );
  blueprint.selectedDirectionId = sealedDirections.directions[0].id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    sealedDirections.directions[0],
  );
  blueprint.selectedDirectionProjectionDigest = sealedDirections.directions[0].projectionDigest;
  const artifact = {
    schemaVersion: "np.site-build-seed.v1",
    theme: { id: "default", ...blueprint.theme },
    seed: blueprint.seed,
    navigation: blueprint.navigation,
  };
  const repositorySeedBytes = encode(artifact);
  const seedFiles = await createSiteBuildRepositorySeedFilesV1({
    configPath: "src/nexpress.config.ts",
    seedArtifactBytes: repositorySeedBytes,
  });
  const home = await row("src/home.ts", "export const home = 'reviewed';\n");
  blueprint.filePlan[0].contentHash = home.digest;
  for (const file of seedFiles.files)
    blueprint.filePlan.push({
      path: file.path,
      owner: "seed",
      source: "staged",
      action: "create",
      expectedHash: null,
      contentHash: file.contentHash,
      rationale: "Reviewed ordinary seed source",
      stagedArtifactPath: `.nexpress/site/files/${file.path === "site-build.seed.json" ? "seed.json" : "seed.ts"}`,
      generatedByCommandId: null,
    });
  const additions: SourceRow[] = [
    home,
    ...seedFiles.files.map((file) => ({
      path: file.path,
      kind: "file" as const,
      mode: "100644" as const,
      digest: file.contentHash,
    })),
  ];
  const candidateRenderer = structuredClone(renderer);
  candidateRenderer.projectSources = source([
    configRow,
    dirtyRow,
    fixtureRow,
    metadataAfter,
    ...additions,
  ]);
  const rawBefore = source([configRow, dirtyRow, artifactRow]);
  const rawAfter = source([...rawBefore.files, ...additions]);
  const environment = npRequireAgentBuildRenderEnvironmentV1(
    JSON.parse(executionVector.structured[3].canonical),
  );
  if (environment.sandbox !== "np.linux-build-sandbox.v1") throw Error("Fixture Linux environment");
  const image: NpSiteBuildLinuxSandboxImageV1 = {
    schemaVersion: "np.site-build-linux-sandbox-image.v1",
    imageId: environment.linux.imageId,
    baseImageId: environment.linux.imageId,
    recipeDigest: environment.linux.imageRecipeSha256,
    supervisorSha256: environment.linux.supervisor.binarySha256,
    supervisorSourceSha256: environment.linux.supervisor.sourceSha256,
    fontconfigSha256: environment.linux.fontconfigSha256,
    driverFiles: environment.linux.driverFiles,
  };
  const candidateRendererFingerprint = await npBuildCanonicalDigest(
    "np.build-direction-renderer.v1",
    candidateRenderer,
  );
  const currentCatalog = structuredClone(catalog);
  currentCatalog.sourceCapsule = candidateRenderer;
  const currentDiscovery = await npBuildInstalledCatalogDigestV1(currentCatalog);
  const comparisonInputs = structuredClone(sealedDirections.comparisonInputs);
  comparisonInputs.projectionInputs.discoveryFingerprint = currentDiscovery;
  const comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    comparisonInputs,
  );
  const candidateDraft = npRequireAgentDesignDirectionDraftSetV1({
    schemaVersion: "np.agent-design-direction-draft-set.v1",
    briefHash: sealedDirections.briefHash,
    comparisonInputs,
    comparisonInputsDigest,
    discoveryFingerprint: currentDiscovery,
    directions: sealedDirections.directions.map((direction) => ({
      ...npBuildDirectionProjectionV1(direction),
      schemaVersion: "np.agent-design-direction-draft.v1",
      discoveryFingerprint: currentDiscovery,
      comparisonInputsDigest,
    })),
  });
  const blueprintHash = await npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  const baselineOutput = {
    schemaVersion: "np.site-build-candidate-baseline.v1",
    catalog,
    fingerprint: baselineDiscovery,
    blueprintHash,
    expectedCollectionDefinitions: [],
    callbackOwners: [],
  };
  const report = {
    scope: "declarations-only",
    blueprintHash,
    discoveryFingerprint: baselineDiscovery,
    expectedCollectionDefinitions: [],
  };
  const input = {
    image,
    brief: directionVector.brief,
    sealedDirections,
    blueprint,
    config: "src/nexpress.config.ts" as const,
    generationContext: {
      schemaVersion: "np.site-build-generation-context.v1",
      implementation: "np.site-build-generation.v1",
      selectedDirectionHash: blueprint.selectedDirectionHash,
      comparisonInputsDigest: sealedDirections.comparisonInputsDigest,
      selectedRenderEnvironmentFingerprint: await npBuildCanonicalDigest(
        "np.build-render-environment.v1",
        environment,
      ),
      clock: structuredClone(environment.clock),
    },
    comparisonEnvironment: environment,
    baselineRuntime: {
      project: "/unit-only/baseline",
      renderer,
      runtimeFilesDigest: environment.linux.runtimeFilesSha256,
      clock: structuredClone(environment.clock),
      assertUnchanged: vi.fn(async () => {}),
    },
    candidateRuntime: {
      project: "/unit-only/candidate",
      renderer: candidateRenderer,
      runtimeFilesDigest: "a".repeat(64),
      clock: structuredClone(environment.clock),
      assertUnchanged: vi.fn(async () => {}),
    },
    baselineOriginalSource: { manifest: rawBefore, assertUnchanged: vi.fn(async () => {}) },
    candidateSource: { manifest: rawAfter, assertUnchanged: vi.fn(async () => {}) },
  };
  sandbox.mockImplementation(async (request) => {
    await Promise.resolve();
    const body = JSON.parse(new TextDecoder().decode(request.inputBytes));
    if (body.mode === "blueprint")
      return {
        audit: structuredClone(audit),
        artifacts: new Map([
          ["blueprint.json", encode(blueprint)],
          ["blueprint-report.json", encode(report)],
          ["candidate-baseline.json", encode(baselineOutput)],
          ["repository-seed.json", repositorySeedBytes],
        ]),
      };
    return {
      audit: structuredClone(audit),
      artifacts: new Map([
        [
          "candidate.json",
          encode({
            scope: "post-apply-declarations-only",
            baselineDiscoveryFingerprint: baselineDiscovery,
            currentDiscoveryFingerprint: currentDiscovery,
            baselineRendererFingerprint,
            currentRendererFingerprint: candidateRendererFingerprint,
            blueprintHash,
            sourceValidationScope: "host-observed-render-profile-manifests",
            originalRawSourceCas: "required-from-host",
            runtimeMetadataDerivation: body.sourceDelta.runtimeMetadata,
            runtimeMetadataObservation: "host-live-byte-owner-required",
            catalog: currentCatalog,
            actualCollectionDefinitions: [],
            callbackOwners: [],
            candidateDraft,
            selectedDirectionId: blueprint.selectedDirectionId,
            seedValidation: "exact-actual-definitions-match-validated-baseline",
            runtimeEvidence: "unverified",
          }),
        ],
      ]),
    };
  });
  return {
    input,
    baselineOutput,
    report,
    repositorySeedBytes,
    candidateDraft,
    blueprintHash,
    baselineRendererFingerprint,
    candidateRendererFingerprint,
  };
}
beforeEach(() => {
  sandbox.mockReset();
});

describe("candidate native orchestration (all native transport calls mocked)", () => {
  it("gets the baseline only from the first native job and supplies exact raw/render delta plus separate metadata derivation", async () => {
    const { input, baselineOutput } = await fixture();
    const result = await observeSiteBuildCandidateV1(input);
    expect(sandbox).toHaveBeenCalledTimes(2);
    const baselineJob = sandbox.mock.calls[0][0],
      candidateJob = sandbox.mock.calls[1][0];
    expect(baselineJob.project).toBe(input.baselineRuntime.project);
    expect(baselineJob.artifacts.map((file) => file.name)).toEqual([
      "blueprint.json",
      "blueprint-report.json",
      "candidate-baseline.json",
      "repository-seed.json",
    ]);
    const job = JSON.parse(new TextDecoder().decode(candidateJob.inputBytes));
    expect(job.baseline).toEqual(baselineOutput);
    expect(
      job.sourceDelta.originalSource.files.some(
        (file: SourceRow) => file.path === ".np-build-runtime.json",
      ),
    ).toBe(false);
    expect(
      job.sourceDelta.originalSource.files.some(
        (file: SourceRow) => file.path === ".nexpress/site/fixtures/home.json",
      ),
    ).toBe(true);
    expect(job.sourceDelta.runtimeMetadata.before.sourceFile.path).toBe(".np-build-runtime.json");
    expect(job.sourceDelta.changes.map((change: { path: string }) => change.path)).toEqual([
      "scripts/seed-content.ts",
      "site-build.seed.json",
      "src/home.ts",
    ]);
    expect(result.fixtureSource).toBe("unchanged");
    expect(result.baseline.seedFiles.files.map((file) => file.path)).toEqual([
      "site-build.seed.json",
      "scripts/seed-content.ts",
    ]);
    expect(result.candidate.result.runtimeEvidence).toBe("unverified");
    for (const owner of [
      input.baselineRuntime,
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      expect(owner.assertUnchanged.mock.calls.length).toBeGreaterThanOrEqual(5);
    await result.assertUnchanged();
    input.candidateSource.assertUnchanged.mockRejectedValueOnce(new SiteBuildError("conflict"));
    await expect(result.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("retains native output byte leases rather than accepting changed in-memory artifacts", async () => {
    const { input } = await fixture();
    const result = await observeSiteBuildCandidateV1(input);
    result.candidate.artifacts[0].bytes[0] ^= 1;
    await expect(result.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("keeps completed declaration leases valid after their observer budget ends", async () => {
    const { input } = await fixture();
    let remainingMs = 1_000;
    const result = await observeSiteBuildCandidateV1({
      ...input,
      remainingMs: () => remainingMs,
    });
    expect(sandbox).toHaveBeenCalledTimes(2);
    remainingMs = 0;
    await expect(result.assertUnchanged()).resolves.toBeUndefined();
    input.candidateSource.assertUnchanged.mockRejectedValueOnce(new SiteBuildError("conflict"));
    await expect(result.assertUnchanged()).rejects.toMatchObject({ reason: "conflict" });
  });

  it("rejects an expired budget while native observation is still active", async () => {
    const { input } = await fixture();
    const transport = sandbox.getMockImplementation();
    if (!transport) throw new Error("Missing native transport double");
    let remainingMs = 1_000;
    sandbox.mockImplementation(async (request) => {
      const result = await transport(request);
      remainingMs = 0;
      return result;
    });
    await expect(
      observeSiteBuildCandidateV1({ ...input, remainingMs: () => remainingMs }),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(sandbox).toHaveBeenCalledTimes(1);
    for (const owner of [
      input.baselineRuntime,
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      expect(owner.assertUnchanged.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("supports lease aliases sharing one non-reentrant original-source owner", async () => {
    const { input } = await fixture();
    let running = false;
    const originalSource = vi.fn(async () => {
      // Match the edit-plan owner's guard while its asynchronous check is live.
      if (running) throw new SiteBuildError("conflict");
      running = true;
      try {
        await Promise.resolve();
      } finally {
        running = false;
      }
    });
    for (const owner of [
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      owner.assertUnchanged.mockImplementation(originalSource);

    const result = await observeSiteBuildCandidateV1(input);
    await result.assertUnchanged();
    expect(sandbox).toHaveBeenCalledTimes(2);
    const checks = input.baselineRuntime.assertUnchanged.mock.calls.length;
    for (const owner of [
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      expect(owner.assertUnchanged).toHaveBeenCalledTimes(checks);
    expect(originalSource).toHaveBeenCalledTimes(checks * 3);
  });

  it.each([
    "raw-extra",
    "render-extra",
    "raw-delete",
    "raw-mode",
    "old-hash",
    "metadata-plan",
    "metadata-same",
    "fixture-changed",
    "fixture-extra",
  ])("rejects %s before either native call", async (kind) => {
    const { input } = await fixture();
    if (kind === "raw-extra")
      input.candidateSource.manifest.files.push(await row("src/unplanned.ts", "extra"));
    if (kind === "render-extra")
      input.candidateRuntime.renderer.projectSources.files.push(
        await row("src/unplanned.ts", "extra"),
      );
    if (kind === "raw-delete")
      input.candidateSource.manifest.files = input.candidateSource.manifest.files.filter(
        (file) => file.path !== "src/operator-dirty.ts",
      );
    if (kind === "raw-mode")
      input.candidateSource.manifest.files.find(
        (file) => file.path === "src/operator-dirty.ts",
      )!.mode = "100755";
    if (kind === "old-hash") {
      input.blueprint.filePlan[0].action = "update";
      input.blueprint.filePlan[0].expectedHash = await sourceHash("invented old source");
    }
    if (kind === "metadata-plan") input.blueprint.filePlan[0].path = ".np-build-runtime.json";
    if (kind === "metadata-same")
      input.candidateRuntime.renderer.projectSources.files.find(
        (file) => file.path === ".np-build-runtime.json",
      )!.digest = input.baselineRuntime.renderer.projectSources.files.find(
        (file) => file.path === ".np-build-runtime.json",
      )!.digest;
    if (kind === "fixture-changed")
      input.candidateRuntime.renderer.projectSources.files.find(
        (file) => file.path === ".nexpress/site/fixtures/home.json",
      )!.digest = await sourceHash("other fixture");
    if (kind === "fixture-extra")
      input.candidateRuntime.renderer.projectSources.files.push(
        await row(".nexpress/site/fixtures/extra.json", "extra fixture"),
      );
    input.candidateSource.manifest = source(input.candidateSource.manifest.files);
    input.candidateRuntime.renderer.projectSources = source(
      input.candidateRuntime.renderer.projectSources.files,
    );
    await expect(
      observeSiteBuildCandidateV1(input).then(
        () => "accepted",
        () => "rejected",
      ),
    ).resolves.toBe("rejected");
    expect(sandbox).not.toHaveBeenCalled();
  });

  it.each(["candidate-clock", "generation-clock", "environment", "packages"])(
    "rejects %s provenance binding drift before execution",
    async (kind) => {
      const { input } = await fixture();
      if (kind === "candidate-clock") input.candidateRuntime.clock.now = "2026-01-02T00:00:00.000Z";
      if (kind === "generation-clock") input.generationContext.clock.randomSeed = "b".repeat(64);
      if (kind === "environment")
        input.generationContext.selectedRenderEnvironmentFingerprint = `nb1:sha256:${"A".repeat(43)}`;
      if (kind === "packages") input.candidateRuntime.renderer.packages[0].version = "0.4.7";
      await expect(observeSiteBuildCandidateV1(input)).rejects.toBeDefined();
      expect(sandbox).not.toHaveBeenCalled();
    },
  );

  it("awaits every live lease check even when one rejects and never runs a native job", async () => {
    const { input } = await fixture();
    input.baselineRuntime.assertUnchanged.mockRejectedValueOnce(new SiteBuildError("conflict"));
    await expect(observeSiteBuildCandidateV1(input)).rejects.toMatchObject({ reason: "conflict" });
    for (const owner of [
      input.baselineRuntime,
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      expect(owner.assertUnchanged).toHaveBeenCalledTimes(1);
    expect(sandbox).not.toHaveBeenCalled();
  });

  it.each([
    "missing-output",
    "blueprint-mismatch",
    "baseline-mismatch",
    "report-extra",
    "seed-bytes",
    "failed-audit",
  ])("rejects %s native baseline output without running the candidate", async (kind) => {
    const { input } = await fixture();
    const original = sandbox.getMockImplementation()!;
    sandbox.mockImplementation(async (request) => {
      const result = await original(request);
      if (kind === "missing-output") result.artifacts.delete("repository-seed.json");
      if (kind === "blueprint-mismatch") {
        const value = JSON.parse(new TextDecoder().decode(result.artifacts.get("blueprint.json")));
        value.risks = [
          {
            id: "unexpected",
            category: "content",
            severity: "low",
            summary: "Changed",
            mitigation: "Review",
            blocking: false,
          },
        ];
        result.artifacts.set("blueprint.json", encode(value));
      }
      if (kind === "baseline-mismatch") {
        const value = JSON.parse(
          new TextDecoder().decode(result.artifacts.get("candidate-baseline.json")),
        );
        value.fingerprint = "invented";
        result.artifacts.set("candidate-baseline.json", encode(value));
      }
      if (kind === "report-extra") {
        const value = JSON.parse(
          new TextDecoder().decode(result.artifacts.get("blueprint-report.json")),
        );
        value.executed = true;
        result.artifacts.set("blueprint-report.json", encode(value));
      }
      if (kind === "seed-bytes")
        result.artifacts.set(
          "repository-seed.json",
          Buffer.concat([result.artifacts.get("repository-seed.json")!, Buffer.from("\n")]),
        );
      if (kind === "failed-audit") result.audit.status = "failed";
      return result;
    });
    await expect(
      observeSiteBuildCandidateV1(input).then(
        () => "accepted",
        () => "rejected",
      ),
    ).resolves.toBe("rejected");
    expect(sandbox).toHaveBeenCalledTimes(1);
    for (const owner of [
      input.baselineRuntime,
      input.candidateRuntime,
      input.baselineOriginalSource,
      input.candidateSource,
    ])
      expect(owner.assertUnchanged.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    "extra",
    "runtime-claim",
    "metadata",
    "renderer",
    "callback-owner",
    "comparison-content",
    "duplicate-key",
  ])("rejects %s candidate result instead of trusting its JSON claims", async (kind) => {
    const { input } = await fixture();
    const original = sandbox.getMockImplementation()!;
    sandbox.mockImplementation(async (request) => {
      const result = await original(request);
      if (!result.artifacts.has("candidate.json")) return result;
      const bytes = result.artifacts.get("candidate.json")!;
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (kind === "extra") value.approved = true;
      if (kind === "runtime-claim") value.runtimeEvidence = "passed";
      if (kind === "metadata")
        value.runtimeMetadataDerivation.after.sourceFile.digest =
          await sourceHash("forged metadata");
      if (kind === "renderer") value.currentRendererFingerprint = value.baselineRendererFingerprint;
      if (kind === "callback-owner")
        value.callbackOwners = [
          { slug: "phantom", callbacks: ["/access/read"], owner: "source-capsule" },
        ];
      if (kind === "comparison-content") {
        value.candidateDraft.comparisonInputs.informationArchitecture[0].purpose =
          "Changed authored comparison";
        value.candidateDraft.comparisonInputsDigest = await npBuildCanonicalDigest(
          "np.build-design-comparison-inputs.v1",
          value.candidateDraft.comparisonInputs,
        );
        for (const direction of value.candidateDraft.directions)
          direction.comparisonInputsDigest = value.candidateDraft.comparisonInputsDigest;
      }
      result.artifacts.set(
        "candidate.json",
        kind === "duplicate-key"
          ? Buffer.from(
              `{"scope":"post-apply-declarations-only",${new TextDecoder().decode(bytes).slice(1)}`,
            )
          : encode(value),
      );
      return result;
    });
    await expect(
      observeSiteBuildCandidateV1(input).then(
        () => "accepted",
        () => "rejected",
      ),
    ).resolves.toBe("rejected");
    expect(sandbox).toHaveBeenCalledTimes(2);
  });

  it("forwards cancellation and awaits the actual native transport before propagating its failure", async () => {
    const { input } = await fixture();
    const controller = new AbortController(),
      entered = deferred(),
      stopped = deferred();
    sandbox.mockImplementation(async (request) => {
      expect(request.signal).toBe(controller.signal);
      entered.resolve();
      await stopped.promise;
      throw new SiteBuildError("unavailable");
    });
    const promise = observeSiteBuildCandidateV1({ ...input, signal: controller.signal });
    await entered.promise;
    controller.abort();
    let finished = false;
    void promise.catch(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    stopped.resolve();
    await expect(promise).rejects.toMatchObject({ reason: "unavailable" });
  });
});
