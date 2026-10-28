import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  npBuildCanonicalBytes,
  npBuildCanonicalDigest,
  npBuildDirectionProjectionV1,
  npBuildFileDigest,
  npBuildPreviewCheckIdsV1,
  npRequireAgentBuildRenderEnvironmentV1,
  npRequireAgentDesignDirectionDraftV1,
  npRequireAgentDesignDirectionSetV1,
  npRequireAgentSiteBlueprintV1,
  type NpAgentBuildPreviewReportV1,
  type NpAgentBuildVerificationResultBodyV1,
  type NpAgentSiteBlueprintV1,
} from "@nexpress/core/agent-contract";
import canonical from "../../../core/src/build-contract/__fixtures__/canonical-v1.json" with { type: "json" };
import directionsVector from "../../../core/src/build-contract/__fixtures__/direction-v1.json" with { type: "json" };
import environmentVector from "../../../core/src/build-contract/__fixtures__/execution-v1.json" with { type: "json" };
import {
  NpSiteBuildGenerateEnvironmentMismatchV1,
  NpSiteBuildGenerateFailureV1,
  NpSiteBuildGenerateSourcePreconditionConflictV1,
  runSiteBuildGenerateV1,
} from "./generator-command.js";
import {
  NpSiteBuildGeneratorControllerErrorV1,
  type NpSiteBuildGeneratorControllerInputV1,
  type NpSiteBuildGeneratorVerificationContextV1,
} from "./generator-controller.js";
import {
  NpSiteBuildCommandExecutionErrorV1,
  type NpSiteBuildCommandExecutionReceiptV1,
  type NpSiteBuildCommandObserverContextV1,
} from "./command-executor.js";
import type { NpSiteBuildCommandNextSummaryV1 } from "./next-build-command.js";
import { SiteBuildError } from "./artifact-io.js";
import { SiteBuildLinuxSandboxFailureV1 } from "./linux-sandbox.js";
import type * as CandidateModule from "./candidate-observation.js";
import type * as ControllerModule from "./generator-controller.js";
import type * as EvidenceModule from "./generator-evidence.js";
import { readSiteSourceTreeV1 } from "./source-tree.js";
import { runSiteBuildHandoffExportV1 } from "./handoff-command.js";
import { runSiteCommandV1 } from "./command.js";

const hooks = vi.hoisted(() => ({
  context: vi.fn(),
  comparison: vi.fn(),
  drafts: vi.fn(),
  dirty: vi.fn(),
  plan: vi.fn(),
  controller: vi.fn(),
  origin: vi.fn(),
  freeze: vi.fn(),
  cache: vi.fn(),
  candidate: vi.fn(),
  doctor: vi.fn(),
  preview: vi.fn(),
  retain: vi.fn(),
  publishFinal: vi.fn(),
  publishAudit: vi.fn(),
}));
vi.mock("./render-context.js", () => ({ observeSiteBuildRenderContextV1: hooks.context }));
vi.mock("./direction-render.js", () => ({
  siteBuildDraftFromSealedDirectionsV1: hooks.drafts,
  validatePreparedSiteBuildDirectionsV1: hooks.comparison,
}));
vi.mock("./repository-status.js", () => ({ observeSiteBuildDirtyPathsV1: hooks.dirty }));
vi.mock("./repository-edit-plan.js", () => ({ prepareSiteBuildRepositoryEditPlanV1: hooks.plan }));
vi.mock("./generator-controller.js", async (original) => ({
  ...(await original<typeof ControllerModule>()),
  runSiteBuildGeneratorControllerV1: hooks.controller,
}));
vi.mock("./linux-project.js", () => ({ prepareSiteBuildCandidateRenderSourcesV1: hooks.origin }));
vi.mock("./render-capsule.js", () => ({ freezePreparedSiteBuildRenderProjectV1: hooks.freeze }));
vi.mock("./render-runtime-cache.js", () => ({ createSiteBuildRenderRuntimeCacheV1: hooks.cache }));
vi.mock("./candidate-observation.js", () => ({ observeSiteBuildCandidateV1: hooks.candidate }));
vi.mock("./doctor-observation.js", () => ({ observePreparedSiteBuildDoctorV1: hooks.doctor }));
vi.mock("./final-preview.js", () => ({ renderPreparedSiteBuildFinalPreviewV1: hooks.preview }));
vi.mock("./generator-evidence.js", async (original) => ({
  ...(await original<typeof EvidenceModule>()),
  retainSiteBuildGeneratorEvidenceV1: hooks.retain,
}));
vi.mock("./render-artifacts.js", () => ({
  publishSiteBuildFinalArtifactsV1: hooks.publishFinal,
  publishSiteBuildGeneratorAuditV1: hooks.publishAudit,
}));

const roots: string[] = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function put(root: string, path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), bytes);
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  for (const hook of Object.values(hooks)) hook.mockReset();
});

// Production-composition tests ONLY: Core parsing/digests and artifact/source
// reads are real. Controller/source publication, native App/image/Doctor/browser
// execution, capsule producers and native artifact publication are transport
// doubles. This suite is not Docker, Next, PG, CAS or actual render acceptance.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "np-generator-command-")));
  roots.push(root);
  const paths = {
    project: join(root, "ordinary"),
    preflight: join(root, "preflight"),
    candidate: join(root, "candidate"),
    frozen: join(root, "frozen"),
  };
  for (const path of Object.values(paths)) {
    await put(path, "package.json", '{"name":"synthetic-orchestration-fixture","type":"module"}\n');
    await put(path, "src/nexpress.config.ts", "export default {};\n");
    await put(path, "src/dirty.ts", "operator-owned dirty fixture\n");
  }
  await put(paths.project, ".env", "NP_SYNTHETIC_ONLY=not-an-actual-secret\n");
  const environment = npRequireAgentBuildRenderEnvironmentV1(
    JSON.parse(environmentVector.structured[3].canonical),
  );
  if (environment.sandbox !== "np.linux-build-sandbox.v1") throw Error("Linux test fixture");
  const fingerprint = await npBuildCanonicalDigest("np.build-render-environment.v1", environment);
  const directions = npRequireAgentDesignDirectionSetV1(structuredClone(directionsVector.set));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1EAAAAASUVORK5CYII=",
    "base64",
  );
  const fixtureBytes = encode({
    schemaVersion: "np.agent-build-render-fixture.v1",
    documents: [
      {
        documentId: "00000000-0000-4000-8000-000000000001",
        collection: "pages",
        locale: null,
        translationGroupId: null,
        dependsOnDocumentIds: [],
        data: { title: "Synthetic", slug: "/" },
        provenance: "demo",
      },
    ],
    navigation: [],
  });
  directions.comparisonInputs.sampleContent[0].data = {
    schemaVersion: "np.agent-build-render-fixture-ref.v1",
    stagedArtifactPath: ".nexpress/site/fixtures/home.json",
    digest: await npBuildFileDigest("np.build-staged-artifact.v1", fixtureBytes),
    pageDocumentId: "00000000-0000-4000-8000-000000000001",
  };
  directions.comparisonInputsDigest = await npBuildCanonicalDigest(
    "np.build-design-comparison-inputs.v1",
    directions.comparisonInputs,
  );
  for (const direction of directions.directions) {
    direction.comparisonInputsDigest = directions.comparisonInputsDigest;
    const { previewArtifact: _previews, projectionDigest: _projection, ...rest } = direction;
    direction.projectionDigest = await npBuildCanonicalDigest(
      "np.build-design-direction-projection.v1",
      npBuildDirectionProjectionV1(
        npRequireAgentDesignDirectionDraftV1({
          ...rest,
          schemaVersion: "np.agent-design-direction-draft.v1",
        }),
      ),
    );
    for (const viewport of ["desktop", "mobile"] as const) {
      Object.assign(direction.previewArtifact[viewport], {
        comparisonInputsDigest: directions.comparisonInputsDigest,
        directionProjectionDigest: direction.projectionDigest,
        digest: await npBuildFileDigest("np.build-preview-artifact.v1", png),
        bytes: png.length,
      });
      await put(paths.project, direction.previewArtifact[viewport].relativePath, png);
    }
  }
  const blueprint = npRequireAgentSiteBlueprintV1(JSON.parse(canonical.structured[1].canonical));
  blueprint.discoveryFingerprint = directions.discoveryFingerprint;
  const plannedBytes = Buffer.from("export const home = 'synthetic planned page';\n");
  blueprint.filePlan[0].contentHash = await npBuildFileDigest(
    "np.build-source-file.v1",
    plannedBytes,
  );
  await put(paths.candidate, blueprint.filePlan[0].path, plannedBytes);
  blueprint.briefHash = await npBuildCanonicalDigest(
    "np.build-site-brief.v1",
    directionsVector.brief,
  );
  blueprint.directionSetHash = await npBuildCanonicalDigest(
    "np.build-design-direction-set.v1",
    directions,
  );
  blueprint.selectedDirectionId = directions.directions[0].id;
  blueprint.selectedDirectionHash = await npBuildCanonicalDigest(
    "np.build-design-direction.v1",
    directions.directions[0],
  );
  blueprint.selectedDirectionProjectionDigest = directions.directions[0].projectionDigest;
  const preview = {
    id: "preview",
    cwd: "project" as const,
    template: "preview-render" as const,
    timeoutSeconds: 60,
    prerequisites: ["doctor"],
    comparisonInputsDigest: directions.comparisonInputsDigest,
    renderEnvironmentFingerprint: fingerprint,
    routes: blueprint.pages.map(({ id, route, locale, audience }) => ({
      pageId: id,
      route,
      locale,
      audience,
      fixtureIds: ["home-content"],
    })),
    viewports: directions.comparisonInputs.viewports,
    checks: [...npBuildPreviewCheckIdsV1],
    artifacts: [
      ...blueprint.pages.flatMap(({ id }) =>
        (["desktop", "mobile"] as const).map((viewport) => ({
          kind: "screenshot" as const,
          pageId: id,
          viewport,
          path: `.nexpress/site/review/final/${id}-${viewport}.png`,
        })),
      ),
      { kind: "report" as const, path: ".nexpress/site/review/final/report.json" },
    ],
    verificationResultPath: ".nexpress/site/review/final/verification.json",
  } satisfies Extract<NpAgentSiteBlueprintV1["commands"][number], { template: "preview-render" }>;
  blueprint.commands.push(
    {
      id: "build",
      cwd: "project",
      template: "build",
      workspaceFilter: null,
      timeoutSeconds: 60,
      prerequisites: ["format"],
    },
    {
      id: "doctor",
      cwd: "project",
      template: "doctor",
      production: false,
      target: null,
      timeoutSeconds: 60,
      prerequisites: ["build"],
    },
    preview,
    {
      id: "verify",
      cwd: "project",
      template: "verify",
      timeoutSeconds: 60,
      prerequisites: ["preview"],
    },
  );
  for (const id of ["build", "doctor", "preview", "verify"])
    blueprint.verification.push({
      id: `${id}-exit`,
      commandId: id,
      required: true,
      expected: "exit-zero",
      artifactPath: null,
    });
  blueprint.verification.push({
    id: "preview-review",
    commandId: "preview",
    required: true,
    expected: "review-artifact",
    artifactPath: preview.verificationResultPath,
  });
  const args = new Map([
    ["--brief", ".nexpress/site/brief.json"],
    ["--directions", ".nexpress/site/directions.json"],
    ["--blueprint", ".nexpress/site/blueprint.json"],
    ["--runtime", ".nexpress/site/runtime.json"],
    ["--out", ".nexpress/site/review/final/generate.json"],
  ]);
  const save = async () => {
    await put(paths.project, args.get("--brief")!, encode(directionsVector.brief));
    await put(paths.project, args.get("--directions")!, encode(directions));
    await put(paths.project, args.get("--blueprint")!, encode(blueprint));
    await put(paths.project, args.get("--runtime")!, "{}");
    await put(paths.project, ".nexpress/site/fixtures/home.json", fixtureBytes);
    await put(paths.project, blueprint.filePlan[0].stagedArtifactPath!, plannedBytes);
    return npBuildCanonicalDigest("np.build-site-blueprint.v1", blueprint);
  };
  const hash = await save();
  const lease = vi.fn(async () => {}),
    close = vi.fn(async () => {}),
    sourceClose = vi.fn(async () => {}),
    preflightClose = vi.fn(async () => {});
  const source = await readSiteSourceTreeV1(paths.candidate),
    baselineSource = await readSiteSourceTreeV1(paths.preflight);
  const capsule = {
    project: paths.frozen,
    renderer: {},
    runtimeFilesDigest: "a".repeat(64),
    assertOriginalUnchanged: lease,
  };
  const image = { imageId: environment.linux.imageId, baseImageId: environment.linux.imageId };
  const clock = { now: "2026-10-23T00:00:00.000Z", randomSeed: "a".repeat(64) };
  const drafts = structuredClone(directionsVector.draftSet);
  const context = {
    observed: { config: "src/nexpress.config.ts", clock, capsule },
    environment,
    fingerprint,
    commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
    context: {
      config: "src/nexpress.config.ts",
      capsule,
      image,
      environment,
      brief: directionsVector.brief,
      drafts,
      paths: {},
    },
  };
  hooks.context.mockResolvedValue(context);
  hooks.drafts.mockReturnValue(drafts);
  hooks.comparison.mockResolvedValue({ audits: [{ scope: "synthetic-transport-comparison" }] });
  hooks.dirty.mockResolvedValue(["src/dirty.ts"]);
  hooks.plan.mockResolvedValue({
    project: paths.preflight,
    assertOriginalUnchanged: lease,
    close: preflightClose,
  });
  hooks.origin.mockResolvedValue({
    project: paths.preflight,
    originInputs: { scope: "transport-double" },
    assertUnchanged: lease,
    close: sourceClose,
  });
  hooks.freeze.mockResolvedValue({ ...capsule, root: paths.frozen, close });
  hooks.cache.mockResolvedValue({
    cache: { project: paths.frozen, runtimeFilesDigest: capsule.runtimeFilesDigest },
    renderer: {},
    assertUnchanged: lease,
  });
  hooks.candidate.mockResolvedValue({
    baseline: {
      audit: { scope: "baseline-native-double" },
      artifacts: [{ name: "blueprint.json", bytes: encode({ scope: "baseline-artifact-double" }) }],
    },
    candidate: {
      audit: { scope: "candidate-native-double" },
      artifacts: [
        { name: "candidate.json", bytes: encode({ scope: "candidate-artifact-double" }) },
      ],
      result: { candidateDraft: drafts, catalog: { defaultLocale: null } },
    },
    assertUnchanged: lease,
  });
  const rawOutput = npBuildCanonicalBytes("np.build-command-output.v1", {
    schemaVersion: "np.agent-build-command-output.v1",
    stdout: {
      base64url: Buffer.from("synthetic fixed child output\n").toString("base64url"),
      truncated: false,
    },
    stderr: { base64url: "", truncated: false },
  }).canonicalJsonUtf8;
  const doctorArtifacts = Object.fromEntries(
    ["report", "seedMaterialization", "nativeAudit", "commandOutput"].map((name) => {
      const bytes =
        name === "commandOutput" ? rawOutput : encode({ scope: `synthetic-${name}-double` });
      return [
        name,
        { path: `.nexpress/site/audit/doctor/${name}.json`, bytes, sha256: sha(bytes) },
      ];
    }),
  );
  hooks.doctor.mockImplementation(
    async (input: { context: NpSiteBuildCommandObserverContextV1 }) => {
      await lease();
      return {
        commandId: input.context.command.id,
        exitCode: 0,
        sourceTreeDigest: source.digest,
        file: {
          path: ".nexpress/site/audit/doctor/manifest.json",
          bytes: 1,
          sha256: "a".repeat(64),
        },
        output: {
          path: ".nexpress/site/audit/doctor/output.json",
          bytes: rawOutput.length,
          sha256: sha(rawOutput),
        },
        artifacts: doctorArtifacts,
        assertUnchanged: lease,
      };
    },
  );
  const report: NpAgentBuildPreviewReportV1 = {
    schemaVersion: "np.agent-build-preview-report.v1",
    blueprintHash: hash,
    comparisonInputsDigest: preview.comparisonInputsDigest,
    renderEnvironmentFingerprint: fingerprint,
    routes: preview.routes.map(({ fixtureIds: _fixtures, ...route }) => ({
      ...route,
      checks: npBuildPreviewCheckIdsV1.map((id) => ({ id, status: "pass", issueIds: [] })),
    })),
    issues: [],
  };
  const previewArtifacts = preview.artifacts.map((item) => ({
    path: item.path,
    bytes: item.kind === "report" ? encode(report) : png,
  }));
  const artifactRecords: NpAgentBuildVerificationResultBodyV1["artifacts"] = await Promise.all(
    preview.artifacts.map(async (item, index) => {
      const common = {
        path: item.path,
        digest: await npBuildFileDigest(
          "np.build-verification-artifact.v1",
          previewArtifacts[index].bytes,
        ),
        bytes: previewArtifacts[index].bytes.length,
      };
      return item.kind === "report"
        ? {
            ...common,
            kind: "report" as const,
            mime: "application/json" as const,
            pageId: null,
            viewport: null,
          }
        : { ...item, ...common, mime: "image/png" as const };
    }),
  );
  const seedReceipt = { scope: "actual-owner-transport-double" },
    seedBytes = encode(seedReceipt);
  const finalPreview = {
    status: "passed",
    report,
    artifacts: previewArtifacts,
    artifactRecords,
    audits: [
      {
        pageId: "home",
        viewport: "desktop",
        audit: { scope: "preview-native-double" },
        seedMaterialization: {
          receipt: seedReceipt,
          bytes: seedBytes.length,
          digest: await npBuildFileDigest("np.build-verification-artifact.v1", seedBytes),
        },
      },
    ],
    lineage: { scope: "transport-double" },
  };
  hooks.preview.mockResolvedValue(finalPreview);
  const publish = async (input: {
    project: string;
    artifacts: Array<{ path: string; bytes: Uint8Array }>;
    manifest: { path: string; bytes: Uint8Array };
  }) => {
    for (const file of [...input.artifacts, input.manifest])
      await put(input.project, file.path, file.bytes);
    return {
      status: "written",
      paths: [...input.artifacts, input.manifest].map((file) => file.path),
    };
  };
  hooks.publishFinal.mockImplementation(publish);
  hooks.publishAudit.mockImplementation(publish);
  const retainedLease = vi.fn(async () => {});
  hooks.retain.mockImplementation(
    async (input: {
      context: NpSiteBuildGeneratorVerificationContextV1;
      observations: Array<{ assertUnchanged(): Promise<void> }>;
    }) => {
      await input.context.execution.commands.reduce(
        (promise) => promise.then(() => lease()),
        Promise.resolve(),
      );
      for (const observation of input.observations) await observation.assertUnchanged();
      for (const [index, command] of input.context.execution.commands.entries())
        await put(
          input.context.originalProject,
          `.nexpress/site/audit/generator-retained/command-${index}.output.json`,
          await readFile(join(input.context.project, command.outputArtifactPath)),
        );
      return {
        manifest: {
          files: input.context.execution.commands.map((command, index) => ({
            kind: "command-output",
            sourcePath: command.outputArtifactPath,
            canonicalDigest: command.outputDigest,
            path: `.nexpress/site/audit/generator-retained/command-${index}.output.json`,
          })),
        },
        retainedArtifacts: [
          {
            path: ".nexpress/site/audit/generator-retained/manifest.json",
            sha256: "a".repeat(64),
            bytes: 1,
          },
        ],
        assertUnchanged: retainedLease,
      };
    },
  );
  const auditPath = ".nexpress/site/audit/command-executor-test";
  hooks.controller.mockImplementation(async (input: NpSiteBuildGeneratorControllerInputV1) => {
    await input.prepared.assertUnchanged();
    await input.registry.assertUnchanged();
    await (await input.observeRepository(paths.project)).assertUnchanged();
    const commands: NpSiteBuildCommandExecutionReceiptV1["commands"] = [];
    try {
      for (const command of blueprint.commands) {
        const observerContext: NpSiteBuildCommandObserverContextV1 = {
          project: paths.candidate,
          dependencies: join(paths.frozen, "node_modules"),
          blueprint,
          blueprintHash: hash,
          command,
          source,
          baselineTreeDigest: baselineSource.digest,
          timeoutMs: 60_000,
          signal: new AbortController().signal,
          remainingMs: () => 60_000,
          completedCommands: [...commands],
          auditPath,
          // Deliberately incomplete transport summary; real owner authentication
          // and derivation byte checks have independent executor tests.
          nextDerivation: { sourceAfterDigest: source.digest } as NpSiteBuildCommandNextSummaryV1,
        };
        const observer =
          command.template === "doctor"
            ? input.observers?.doctor
            : command.template === "preview-render"
              ? input.observers?.previewRender
              : command.template === "verify"
                ? input.observers?.verify
                : undefined;
        if (observer) {
          const evidence = await observer(observerContext);
          if (evidence.exitCode !== 0) throw new SiteBuildError("unavailable");
          await evidence.assertUnchanged();
        }
        const output = {
          schemaVersion: "np.agent-build-command-output.v1",
          stdout: { base64url: "", truncated: false },
          stderr: { base64url: "", truncated: false },
        };
        await put(
          paths.candidate,
          `${auditPath}/command-${commands.length}.output.json`,
          npBuildCanonicalBytes("np.build-command-output.v1", output).canonicalJsonUtf8,
        );
        commands.push({
          commandId: command.id,
          template: command.template,
          exitCode: 0,
          startedAt: "2026-10-23T01:00:00.000Z",
          finishedAt: "2026-10-23T01:00:00.001Z",
          durationMs: 1,
          execution: null,
          outputArtifactPath: `${auditPath}/command-${commands.length}.output.json`,
          outputDigest: await npBuildCanonicalDigest("np.build-command-output.v1", output),
          evidence: null,
        });
      }
      const execution = {
        schemaVersion: "np.site-build-command-execution.v1",
        scope: "private-build-copy",
        blueprintHash: hash,
        commandRegistryFingerprint: blueprint.commandRegistryFingerprint,
        baselineTreeDigest: baselineSource.digest,
        generationContext: null,
        generationContextFingerprint: null,
        sourceBefore: source,
        sourceAfter: source,
        tools: [],
        drivers: [],
        auditPath,
        commands,
      } satisfies NpSiteBuildCommandExecutionReceiptV1;
      await put(paths.candidate, `${auditPath}/receipt.json`, encode(execution));
      const verificationContext = {
        originalProject: paths.project,
        project: paths.candidate,
        dependencies: join(paths.frozen, "node_modules"),
        blueprint,
        blueprintHash: hash,
        originalSource: await readSiteSourceTreeV1(paths.project),
        privateBaseline: baselineSource,
        candidateSource: source,
        execution,
        editPlan: {
          scope: "private-build-copy",
          blueprintHash: hash,
          baselineTreeDigest: source.digest,
          privateBaselineTreeDigest: baselineSource.digest,
          preservedDirtyPaths: ["src/dirty.ts"],
          omittedPaths: [],
          deferredCommandPaths: [],
          files: [],
        },
      } satisfies NpSiteBuildGeneratorVerificationContextV1;
      const verified = await input.verifyCandidate(verificationContext);
      await verified.assertUnchanged();
      if (input.runMode === "publish")
        for (const file of blueprint.filePlan)
          await put(paths.project, file.path, await readFile(join(paths.candidate, file.path)));
      return {
        originalSource: verificationContext.originalSource,
        originalSourceAfter: await readSiteSourceTreeV1(paths.project),
        candidateSource: source,
        execution,
        privateCopy: "removed",
        verification: { retainedArtifactsReportedByVerifier: verified.retainedArtifacts ?? [] },
        publication: input.runMode === "publish" ? { result: { status: "written" } } : null,
      };
    } catch (error) {
      await put(
        paths.candidate,
        `${auditPath}/failure.json`,
        encode({
          commandId: blueprint.commands[commands.length]?.id ?? null,
          reason: "unavailable",
        }),
      );
      let state: "retained" | "retention-failed" = "retained";
      try {
        await input.beforePrivateCleanup?.({
          project: paths.candidate,
          blueprint,
          failure: new NpSiteBuildCommandExecutionErrorV1(
            "unavailable",
            blueprint.commands[commands.length]?.id ?? null,
            auditPath,
          ),
        });
      } catch {
        state = "retention-failed";
      }
      if (error instanceof NpSiteBuildGeneratorControllerErrorV1) throw error;
      throw new NpSiteBuildGeneratorControllerErrorV1(
        "unavailable",
        "commands",
        "not-started",
        "removed",
        null,
        state,
      );
    }
  });
  return {
    paths,
    args,
    blueprint,
    directions,
    save,
    hash,
    lease,
    close,
    sourceClose,
    preflightClose,
    retainedLease,
    context,
    finalPreview,
    run: () => runSiteBuildGenerateV1(args, paths.project),
  };
}

describe("site generate production composition (mocked native transport)", () => {
  it("reports the exact already-published create on a public rerun without reobserving native runtime", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    f.args.set("--acknowledge-plan", f.hash);
    await f.run();
    const before = await readSiteSourceTreeV1(f.paths.project);
    for (const hook of Object.values(hooks)) hook.mockClear();
    const result = await runSiteCommandV1(
      [
        "generate",
        ...[...f.args].flatMap(([key, value]) => (key === "--execute" ? [key] : [key, value])),
      ],
      f.paths.project,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      reason: "conflict",
      scope: "source-file-plan-preconditions",
      sourceWrites: 0,
      requiresNewReviewedPlan: true,
      conflicts: [
        {
          path: "src/home.ts",
          expectedHash: null,
          currentHash: f.blueprint.filePlan[0].contentHash,
          plannedHash: f.blueprint.filePlan[0].contentHash,
          status: "already-matches-plan",
        },
      ],
    });
    expect(result.stderr).not.toContain(f.paths.project);
    expect(result.stderr).not.toContain("not-an-actual-secret");
    expect(result.stderr).not.toContain("output filename");
    for (const name of ["context", "comparison", "plan", "controller", "publishFinal"] as const)
      expect(hooks[name]).not.toHaveBeenCalled();
    expect(await readSiteSourceTreeV1(f.paths.project)).toEqual(before);
  });

  it.each(["update-final", "modified", "missing-update"] as const)(
    "reports %s source preconditions before runtime loading and preserves every original",
    async (kind) => {
      const f = await fixture();
      const row = f.blueprint.filePlan[0];
      if (kind !== "modified") {
        row.action = "update";
        row.expectedHash = await npBuildFileDigest(
          "np.build-source-file.v1",
          Buffer.from("old reviewed source\n"),
        );
        await f.save();
      }
      const bytes =
        kind === "update-final"
          ? await readFile(join(f.paths.candidate, row.path))
          : Buffer.from("operator-private-edit-marker\n");
      if (kind !== "missing-update") await put(f.paths.project, row.path, bytes);
      // Missing/stale runtime must not obscure a known file-plan precondition.
      await rm(join(f.paths.project, f.args.get("--runtime")!));
      const before = await readSiteSourceTreeV1(f.paths.project);
      const error = await f.run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NpSiteBuildGenerateSourcePreconditionConflictV1);
      expect(error).toMatchObject({
        reason: "conflict",
        scope: "source-file-plan-preconditions",
        sourceWrites: 0,
        requiresNewReviewedPlan: true,
        conflicts: [
          {
            path: row.path,
            expectedHash: row.expectedHash,
            currentHash:
              kind === "missing-update"
                ? null
                : await npBuildFileDigest("np.build-source-file.v1", bytes),
            plannedHash: row.contentHash,
            status:
              kind === "update-final"
                ? "already-matches-plan"
                : kind === "missing-update"
                  ? "missing"
                  : "modified",
          },
        ],
      });
      expect(JSON.stringify(error)).not.toContain("operator-private-edit-marker");
      for (const name of ["context", "comparison", "plan", "controller", "publishFinal"] as const)
        expect(hooks[name]).not.toHaveBeenCalled();
      expect(await readSiteSourceTreeV1(f.paths.project)).toEqual(before);
    },
  );
  it("exports handoff from the generator's actual singleton observation and retained command bytes", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    f.args.set("--acknowledge-plan", f.hash);
    const generated = await f.run();
    const recorded = JSON.parse(
      await readFile(
        join(f.paths.project, ".nexpress/site/review/final/verification.json"),
        "utf8",
      ),
    );
    expect(recorded.finalSourceDigest).toBe((await readSiteSourceTreeV1(f.paths.project)).digest);
    expect(generated.finalSourceDigest).toBe(recorded.finalSourceDigest);
    expect(generated.finalSourceDigest).not.toBe(generated.privateCandidateTreeDigest);
    expect(recorded.baselineTreeDigest).toBe(generated.originalTreeDigest);
    expect(await readFile(join(f.paths.project, ".env"), "utf8")).toBe(
      "NP_SYNTHETIC_ONLY=not-an-actual-secret\n",
    );
    await expect(readFile(join(f.paths.candidate, ".env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(f.paths.candidate, f.args.get("--brief")!))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const result = await runSiteBuildHandoffExportV1(
      new Map([
        ["--brief", f.args.get("--brief")!],
        ["--directions", f.args.get("--directions")!],
        ["--blueprint", f.args.get("--blueprint")!],
        ["--verification", ".nexpress/site/review/final/verification.json"],
        ["--observations", generated.observationPath],
        ["--out", ".nexpress/site/review/final/handoff.json"],
      ]),
      f.paths.project,
    );
    expect(result.verificationState).toBe("recorded-pass");
    expect(result.executedCommands).toBe(0);
    expect(result.observationScope).toBe("recorded-artifact-bytes-only");
  });
  it("keeps dry-run projected verification distinct from the unchanged ordinary source", async () => {
    const f = await fixture();
    const before = await readSiteSourceTreeV1(f.paths.project);
    const generated = await f.run();
    expect((await readSiteSourceTreeV1(f.paths.project)).digest).toBe(before.digest);
    expect(generated.finalSourceDigest).not.toBe(before.digest);
    await expect(
      runSiteBuildHandoffExportV1(
        new Map([
          ["--brief", f.args.get("--brief")!],
          ["--directions", f.args.get("--directions")!],
          ["--blueprint", f.args.get("--blueprint")!],
          ["--verification", ".nexpress/site/review/final/verification.json"],
          ["--observations", generated.observationPath],
          ["--out", ".nexpress/site/review/final/handoff.json"],
        ]),
        f.paths.project,
      ),
    ).rejects.toMatchObject({ reason: "input" });
  });
  it("runs fresh independent comparison, all commands, native candidate, Doctor and preview even for dry-run", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(result).toMatchObject({
      status: "dry-run-verified",
      authorizationSource: "dry-run",
      sourcePublication: "not-requested",
      privateCopy: "removed",
      renderedImages: 2,
    });
    expect(hooks.comparison).toHaveBeenCalledOnce();
    expect(hooks.candidate).toHaveBeenCalledOnce();
    expect(hooks.doctor).toHaveBeenCalledOnce();
    expect(hooks.preview).toHaveBeenCalledOnce();
    expect(hooks.controller.mock.calls[0][0]).toMatchObject({
      runMode: "dry-run",
      nextPreview: "deterministic-selected-comparison",
      acknowledgePlanHash: null,
    });
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.sourceClose).toHaveBeenCalledOnce();
    expect(f.preflightClose).toHaveBeenCalledOnce();
    expect(hooks.retain.mock.invocationCallOrder[0]).toBeLessThan(
      hooks.publishFinal.mock.invocationCallOrder[0],
    );
    const observation = JSON.parse(
      await readFile(join(f.paths.project, result.observationPath), "utf8"),
    );
    expect(observation.startedAt).toBe("2026-10-23T01:00:00.000Z");
    expect(
      observation.commandResults.every((row: { outputArtifactPath: string }) =>
        row.outputArtifactPath.startsWith(".nexpress/site/audit/generator-retained/"),
      ),
    ).toBe(true);
    expect(await readFile(join(f.paths.project, "src/dirty.ts"), "utf8")).toBe(
      "operator-owned dirty fixture\n",
    );
  });
  it("rejects a source change between fresh runtime and source leases before preview or publication", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    f.args.set("--acknowledge-plan", f.hash);
    const ordinaryBefore = await readSiteSourceTreeV1(f.paths.project);
    const dirtyBefore = await readFile(join(f.paths.project, "src/dirty.ts"));
    const envBefore = await readFile(join(f.paths.project, ".env"));
    const nativeCandidate = hooks.candidate.getMockImplementation()!;
    const doctor = hooks.doctor.getMockImplementation()!;
    let doctorCompleted = false;
    let changedBetweenLeases = false;
    let freshSourceRejected = false;
    hooks.doctor.mockImplementation(async (input) => {
      const result = await doctor(input);
      doctorCompleted = true;
      return result;
    });
    hooks.candidate.mockImplementation(
      async (input: Parameters<typeof CandidateModule.observeSiteBuildCandidateV1>[0]) => ({
        ...(await nativeCandidate(input)),
        assertUnchanged: async () => {
          // Exercise the actual callbacks supplied by the generator.
          await input.baselineRuntime.assertUnchanged();
          await input.baselineOriginalSource.assertUnchanged();
          await input.candidateRuntime.assertUnchanged();
          if (doctorCompleted && !changedBetweenLeases) {
            await put(f.paths.candidate, "src/dirty.ts", "changed during the live source lease\n");
            changedBetweenLeases = true;
          }
          try {
            await input.candidateSource.assertUnchanged();
          } catch (error) {
            if (
              changedBetweenLeases &&
              error instanceof SiteBuildError &&
              error.reason === "conflict"
            )
              freshSourceRejected = true;
            throw error;
          }
        },
      }),
    );
    await expect(f.run()).rejects.toMatchObject({
      sourcePublication: "not-started",
      privateCopy: "removed",
    });
    expect(changedBetweenLeases).toBe(true);
    expect(freshSourceRejected).toBe(true);
    expect(hooks.preview).not.toHaveBeenCalled();
    expect(hooks.retain).not.toHaveBeenCalled();
    expect(hooks.publishFinal).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalled();
    expect(f.sourceClose).toHaveBeenCalled();
    expect(f.preflightClose).toHaveBeenCalled();
    expect((await readSiteSourceTreeV1(f.paths.project)).digest).toBe(ordinaryBefore.digest);
    expect(await readFile(join(f.paths.project, "src/dirty.ts"))).toEqual(dirtyBefore);
    expect(await readFile(join(f.paths.project, ".env"))).toEqual(envBefore);
  });
  it("requires exact execute hash and forwards publication only after complete verification", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    f.args.set("--acknowledge-plan", f.hash);
    const result = await f.run();
    expect(result).toMatchObject({
      status: "published",
      authorizationSource: "noninteractive-process",
      sourcePublication: "written",
    });
    expect(hooks.controller.mock.calls[0][0]).toMatchObject({
      runMode: "publish",
      acknowledgePlanHash: f.hash,
    });
    expect(hooks.comparison).toHaveBeenCalledOnce();
  });
  it.each(["missing", "wrong"])(
    "rejects %s execute acknowledgement before native/context work",
    async (kind) => {
      const f = await fixture();
      f.args.set("--execute", "true");
      if (kind === "wrong") f.args.set("--acknowledge-plan", `nb1:sha256:${"A".repeat(43)}`);
      await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
      expect(hooks.context).not.toHaveBeenCalled();
      expect(hooks.controller).not.toHaveBeenCalled();
    },
  );
  it.each([
    "../leak.json",
    ".env",
    ".nexpress/site/review/final/nested/out.json",
    ".nexpress/site/review/final/../out.json",
    ".nexpress/site/audit/out.json",
  ])("rejects output path %s", async (path) => {
    const f = await fixture();
    f.args.set("--out", path);
    await expect(f.run()).rejects.toMatchObject({ reason: "path" });
    expect(hooks.controller).not.toHaveBeenCalled();
  });
  it("rejects an output alias for preview report before execution", async () => {
    const f = await fixture();
    f.args.set("--out", ".nexpress/site/review/final/report.json");
    await expect(f.run()).rejects.toMatchObject({ reason: "path" });
    expect(hooks.context).not.toHaveBeenCalled();
  });
  it("rejects unknown flags and detached acknowledgement", async () => {
    const f = await fixture();
    f.args.set("--network", "all");
    await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
    f.args.delete("--network");
    f.args.set("--acknowledge-plan", f.hash);
    await expect(f.run()).rejects.toMatchObject({ reason: "arguments" });
  });
  it("never executes after fresh independent rerender fails", async () => {
    const f = await fixture();
    hooks.comparison.mockRejectedValue(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.controller).not.toHaveBeenCalled();
  });
  it("rejects post-build source mutators instead of observing a stale runtime", async () => {
    const f = await fixture();
    const format = f.blueprint.commands.shift()!;
    format.prerequisites = ["build"];
    const build = f.blueprint.commands.find((row) => row.id === "build")!;
    build.prerequisites = [];
    f.blueprint.commands.find((row) => row.id === "doctor")!.prerequisites = ["format"];
    f.blueprint.commands.splice(1, 0, format);
    await f.save();
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
    expect(hooks.controller).not.toHaveBeenCalled();
  });
  it("rejects missing actual build before Doctor", async () => {
    const f = await fixture();
    f.blueprint.commands[1] = {
      ...f.blueprint.commands[1],
      template: "typecheck",
      workspaceFilter: null,
    };
    await f.save();
    await expect(f.run()).rejects.toMatchObject({ reason: "unavailable" });
    expect(hooks.context).not.toHaveBeenCalled();
  });
  it("retains actual environment and stage evidence on mismatch, without rerunning or approving", async () => {
    const f = await fixture();
    hooks.context
      .mockResolvedValueOnce(f.context)
      .mockResolvedValue({ ...f.context, fingerprint: `nb1:sha256:${"A".repeat(43)}` });
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateEnvironmentMismatchV1);
    expect(hooks.preview).not.toHaveBeenCalled();
    expect(hooks.doctor).not.toHaveBeenCalled();
    expect(hooks.publishAudit).toHaveBeenCalled();
    expect(hooks.retain).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledOnce();
    const env = hooks.publishAudit.mock.calls
      .flatMap(([input]) => input.artifacts)
      .find((row: { path: string }) => row.path.endsWith("/environment.json"));
    expect(JSON.parse(Buffer.from(env.bytes).toString())).toEqual(f.context.environment);
  });
  it("retains Doctor errors before private cleanup and does not claim preview success", async () => {
    const f = await fixture();
    const normal = hooks.doctor.getMockImplementation()!;
    hooks.doctor.mockImplementation(async (input) => ({ ...(await normal(input)), exitCode: 1 }));
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateFailureV1);
    expect(hooks.preview).not.toHaveBeenCalled();
    expect(
      hooks.publishAudit.mock.calls.some(
        ([input]) => JSON.parse(Buffer.from(input.manifest.bytes).toString()).stage === "doctor",
      ),
    ).toBe(true);
    expect(f.preflightClose).toHaveBeenCalledOnce();
  });
  it("fails closed for changed seed receipt bytes before issuing verification", async () => {
    const f = await fixture();
    f.finalPreview.audits[0].seedMaterialization.bytes++;
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateFailureV1);
    expect(hooks.retain).not.toHaveBeenCalled();
    expect(hooks.publishFinal).not.toHaveBeenCalled();
  });
  it("retains failed required checks and issues no verification result", async () => {
    const f = await fixture();
    hooks.preview.mockResolvedValue({ ...f.finalPreview, status: "failed" });
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateFailureV1);
    expect(hooks.retain).not.toHaveBeenCalled();
    expect(hooks.publishAudit).toHaveBeenCalled();
    expect(hooks.publishFinal).not.toHaveBeenCalled();
  });
  it.each(["native", "opaque"] as const)(
    "retains partial preview progress and safe %s failure diagnostics before cleanup",
    async (kind) => {
      const f = await fixture();
      const audit = {
        schemaVersion: "np.site-build-linux-audit.v1" as const,
        status: "failed" as const,
        reason: "root-exit",
        rootExitCode: 1,
        rootSignal: 0,
        tracedProcesses: 2,
        reapedProcesses: 2,
        descendantsReaped: true,
        argumentsFrozen: true,
        ownIpcReclaimed: true,
        forbiddenAttempts: 0,
        privateError: "private-exception-text-must-not-leak",
      };
      const browserDiagnostic = {
        reason: "request",
        loaded: true,
        inflight: 1,
        ready: 0,
        wait: {
          step: "post-font-idle",
          elapsedMs: 120_005,
          stepElapsedMs: 90_000,
          pendingCount: 1,
          truncated: false,
          pending: [
            {
              target: "api",
              query: "none",
              method: "GET",
              apiRole: "member-session",
              resourceType: "fetch",
              headersReceived: false,
              eventStream: false,
              ageMs: 89_999,
            },
          ],
        },
        request: {
          sink: "binding",
          target: "other-local",
          query: "rsc",
          method: "GET",
          privateUrl: "private-browser-url-must-not-leak",
        },
        privateError: "private-exception-text-must-not-leak",
      } as const;
      const previewHttpDiagnostic = {
        reason: "status",
        status: 503,
        privateUrl: "private-http-url-must-not-leak",
      } as const;
      hooks.preview.mockImplementation((input) => {
        input.observeProgress({
          phase: "native-completed",
          pageId: "home",
          viewport: "desktop",
          completedCaptures: 0,
          nativeAudit: { ...audit, status: "passed", rootExitCode: 0 },
        });
        input.observeProgress({
          phase: "native",
          pageId: "home",
          viewport: "mobile",
          completedCaptures: 1,
          nativeAudit: null,
        });
        throw kind === "native"
          ? new SiteBuildLinuxSandboxFailureV1(
              audit,
              "browser",
              null,
              null,
              null,
              "network-idle",
              browserDiagnostic,
              previewHttpDiagnostic,
            )
          : new Error("private-exception-text-must-not-leak");
      });
      await expect(f.run()).rejects.toMatchObject({
        reason: "unavailable",
        sourcePublication: "not-started",
        privateCopy: "removed",
      });
      const reports = hooks.publishAudit.mock.calls
        .flatMap(([input]) => input.artifacts)
        .map((row) => JSON.parse(Buffer.from(row.bytes).toString()))
        .filter((body) => body.schemaVersion === "np.site-build-final-preview-failure.v1");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        scope: "partial-preview-observations-only",
        blueprintHash: f.hash,
        reason: "unavailable",
        cancellationObserved: false,
        remainingMs: 60_000,
        progress: [
          { phase: "native-completed", completedCaptures: 0, nativeAudit: { status: "passed" } },
          {
            phase: "native",
            pageId: "home",
            viewport: "mobile",
            completedCaptures: 1,
            nativeAudit: null,
          },
        ],
        nativeFailure:
          kind === "native"
            ? {
                audit: { status: "failed" },
                driverStage: "browser",
                browserPhase: "network-idle",
              }
            : null,
      });
      if (kind === "native") {
        expect(reports[0].nativeFailure.browserDiagnostic).toEqual({
          reason: "request",
          loaded: true,
          inflight: 1,
          ready: 0,
          wait: browserDiagnostic.wait,
          request: { sink: "binding", target: "other-local", query: "rsc", method: "GET" },
        });
        expect(reports[0].nativeFailure.previewHttpDiagnostic).toEqual({
          reason: "status",
          status: 503,
        });
      }
      expect(JSON.stringify(reports[0])).not.toContain("private-exception-text-must-not-leak");
      expect(JSON.stringify(reports[0])).not.toContain("private-browser-url-must-not-leak");
      expect(JSON.stringify(reports[0])).not.toContain("private-http-url-must-not-leak");
      expect(hooks.retain).not.toHaveBeenCalled();
      expect(hooks.publishFinal).not.toHaveBeenCalled();
      expect(f.preflightClose).toHaveBeenCalledOnce();
    },
  );
  it("requires exactly one retained output for every observed command", async () => {
    const f = await fixture();
    const normal = hooks.retain.getMockImplementation()!;
    hooks.retain.mockImplementation(async (input) => {
      const result = await normal(input);
      result.manifest.files.pop();
      return result;
    });
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateFailureV1);
    expect(hooks.publishFinal).not.toHaveBeenCalled();
  });
  it("forwards original tarball origin only through host-only cache/runtime producers", async () => {
    const f = await fixture();
    await f.run();
    expect(hooks.origin.mock.calls[0][1]).toEqual({ tarballProjectRoot: f.paths.project });
    expect(hooks.freeze.mock.calls[0][0].sourceInputs).toBe(
      await hooks.origin.mock.results[0].value,
    );
    expect(hooks.cache.mock.calls[0][0]).toMatchObject({
      originalProjectRoot: f.paths.candidate,
      tarballProjectRoot: f.paths.project,
    });
    expect(hooks.context.mock.calls[1][0]).toMatchObject({
      cwd: f.paths.candidate,
      tarballProjectRoot: f.paths.project,
    });
    expect(hooks.context.mock.calls[1][0].fixtureFiles).toBe(hooks.context.mock.calls[0][0].files);
  });
  it("detects persisted verification bytes drift and prevents success result", async () => {
    const f = await fixture();
    const normal = hooks.publishFinal.getMockImplementation()!;
    hooks.publishFinal.mockImplementation(async (input) => {
      const result = await normal(input);
      if (input.manifest.path.endsWith("verification.json"))
        await put(input.project, input.manifest.path, "{}");
      return result;
    });
    await expect(f.run()).rejects.toBeInstanceOf(NpSiteBuildGenerateFailureV1);
    expect(
      hooks.publishFinal.mock.calls.some(([input]) =>
        input.manifest.path.endsWith("generate.json"),
      ),
    ).toBe(false);
  });
  it("always closes both owned copies when one cleanup fails", async () => {
    const f = await fixture();
    f.close.mockRejectedValue(new Error("synthetic cleanup"));
    await expect(f.run()).rejects.toMatchObject({
      stage: "cleanup",
      privateCopy: "cleanup-failed",
    });
    expect(f.preflightClose).toHaveBeenCalledOnce();
    expect(f.sourceClose).toHaveBeenCalledOnce();
  });
  it("closes its normalized source owner when freezing the command runtime fails", async () => {
    const f = await fixture();
    hooks.freeze.mockRejectedValue(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ sourcePublication: "not-started" });
    expect(f.sourceClose).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.preflightClose).toHaveBeenCalledOnce();
  });
  it("keeps controller partial-publication/cleanup failure instead of masking it as environment mismatch", async () => {
    const f = await fixture();
    hooks.context
      .mockResolvedValueOnce(f.context)
      .mockResolvedValue({ ...f.context, fingerprint: `nb1:sha256:${"A".repeat(43)}` });
    const normal = hooks.controller.getMockImplementation()!;
    hooks.controller.mockImplementation(async (input) => {
      try {
        return await normal(input);
      } catch {
        throw new NpSiteBuildGeneratorControllerErrorV1(
          "unavailable",
          "cleanup",
          "partial-changes-may-remain",
          "cleanup-failed",
          null,
          "retained",
        );
      }
    });
    await expect(f.run()).rejects.toMatchObject({
      sourcePublication: "partial-changes-may-remain",
      privateCopy: "cleanup-failed",
      failureEvidence: "retained",
    });
  });
  it("preserves source/input lease rejection and never falls back to cached authority", async () => {
    const f = await fixture();
    f.lease.mockRejectedValue(new SiteBuildError("conflict"));
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.preview).not.toHaveBeenCalled();
    expect(f.preflightClose).toHaveBeenCalledOnce();
  });
  it("retains actual failed-command raw files before controller disposal", async () => {
    const f = await fixture();
    hooks.controller.mockImplementation(async (input: NpSiteBuildGeneratorControllerInputV1) => {
      const auditPath = ".nexpress/site/audit/command-executor-failed";
      await put(
        f.paths.candidate,
        `${auditPath}/failure.json`,
        encode({ commandId: "build", reason: "unavailable" }),
      );
      await put(
        f.paths.candidate,
        `${auditPath}/command-1.stdout.log`,
        "actual synthetic fixed child failure output\n",
      );
      await input.beforePrivateCleanup?.({
        project: f.paths.candidate,
        blueprint: f.blueprint,
        failure: new NpSiteBuildCommandExecutionErrorV1("unavailable", "build", auditPath),
      });
      throw new NpSiteBuildGeneratorControllerErrorV1(
        "unavailable",
        "commands",
        "not-started",
        "removed",
        null,
        "retained",
      );
    });
    await expect(f.run()).rejects.toMatchObject({
      failureEvidence: "retained",
      retainedPaths: expect.arrayContaining([expect.stringMatching(/command-1\.stdout\.log$/u)]),
    });
    const artifact = hooks.publishAudit.mock.calls
      .flatMap(([input]) => input.artifacts)
      .find((row: { path: string }) => row.path.endsWith("command-1.stdout.log"));
    expect(Buffer.from(artifact.bytes).toString()).toBe(
      "actual synthetic fixed child failure output\n",
    );
    expect(hooks.candidate).not.toHaveBeenCalled();
    expect(hooks.publishFinal).not.toHaveBeenCalled();
  });
  it("never follows a substituted failed-command log symlink", async () => {
    const f = await fixture();
    hooks.controller.mockImplementation(async (input: NpSiteBuildGeneratorControllerInputV1) => {
      const auditPath = ".nexpress/site/audit/command-executor-failed";
      await put(f.paths.candidate, `${auditPath}/failure.json`, "{}");
      await put(f.paths.project, "operator.log", "unrelated operator bytes");
      await symlink(
        join(f.paths.project, "operator.log"),
        join(f.paths.candidate, `${auditPath}/command-0.stdout.log`),
      );
      await expect(
        input.beforePrivateCleanup?.({
          project: f.paths.candidate,
          blueprint: f.blueprint,
          failure: new NpSiteBuildCommandExecutionErrorV1("unavailable", "format", auditPath),
        }),
      ).rejects.toThrow();
      throw new NpSiteBuildGeneratorControllerErrorV1(
        "unavailable",
        "commands",
        "not-started",
        "removed",
        null,
        "retention-failed",
      );
    });
    await expect(f.run()).rejects.toMatchObject({ failureEvidence: "retention-failed" });
    expect(hooks.publishAudit).not.toHaveBeenCalled();
    expect(await readFile(join(f.paths.project, "operator.log"), "utf8")).toBe(
      "unrelated operator bytes",
    );
  });
  it("rechecks runtime input bytes after the independent comparison", async () => {
    const f = await fixture();
    hooks.comparison.mockImplementation(async () => {
      await put(f.paths.project, f.args.get("--runtime")!, '{"changed":true}');
      return { audits: [] };
    });
    await expect(f.run()).rejects.toMatchObject({ reason: "conflict" });
    expect(hooks.controller).not.toHaveBeenCalled();
    expect(f.preflightClose).toHaveBeenCalledOnce();
  });
  it("reports completed source publication if final --out publication later fails", async () => {
    const f = await fixture();
    f.args.set("--execute", "true");
    f.args.set("--acknowledge-plan", f.hash);
    const normal = hooks.publishFinal.getMockImplementation()!;
    hooks.publishFinal.mockImplementation(async (input) => {
      if (input.manifest.path.endsWith("generate.json")) throw new SiteBuildError("conflict");
      return await normal(input);
    });
    await expect(f.run()).rejects.toMatchObject({
      reason: "conflict",
      sourcePublication: "completed",
      privateCopy: "removed",
      failureEvidence: "retained",
      retainedPaths: expect.arrayContaining([
        ".nexpress/site/audit/generator-retained/manifest.json",
      ]),
    });
    expect(f.preflightClose).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });
});
