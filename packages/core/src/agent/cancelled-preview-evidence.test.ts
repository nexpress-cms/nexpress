import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { npVerifyAgentChangeSetPlanEvidenceV1 as verifyPlan } from "./changeset-plan-evidence.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetProposalCanonical,
} from "../agent-contract/canonical-changeset.js";
type PlanProof = Parameters<typeof verifyPlan>[0];
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const digest = `cj1:sha256:${"A".repeat(43)}`;
async function planFixture(): Promise<PlanProof> {
  const f = await previewFixture();
  const { plan } = f;
  if (plan.planKind !== "changeset") throw new Error("Expected initial plan");
  const planned = plan.body.operations[0],
    snapshot = f.snapshots[0],
    at = new Date(f.createdAt);
  planned.beforeHash = hash("np.agent-changeset-resource.v1", {
    siteId: f.siteId,
    canonicalResourceKey: planned.canonicalResourceKey,
    presence: "absent",
    value: null,
  });
  plan.body.baseFingerprint = hash("np.agent-changeset-bases.v1", {
    siteId: f.siteId,
    bases: [
      {
        ordinal: 1,
        canonicalResourceKey: planned.canonicalResourceKey,
        presence: snapshot.presence,
        base: snapshot.base,
        snapshotHash: planned.snapshotHash,
      },
    ],
  });
  plan.body.draftHash = await npDigestAgentChangeSetProposalCanonical({
    schemaVersion: "np.agent-changeset-proposal.v1",
    siteId: f.siteId,
    changeSetId: f.changeSetId,
    draftVersion: 1,
    title: "Evidence",
    summary: null,
    operations: [
      {
        ordinal: 1,
        operation: planned.operation,
        canonicalResourceKey: planned.canonicalResourceKey,
      },
    ],
  });
  const planHash = await npDigestAgentChangeSetPlanCanonical(plan);
  const changeSet: PlanProof["changeSet"] = {
    id: f.changeSetId,
    siteId: f.siteId,
    creatorKind: "staff",
    principalId: null,
    createdByUserId: f.changeSetId,
    actorDeletedAt: null,
    actorFingerprint: digest,
    sourceOperationId: "agents.changesets.create",
    sourceInputHash: digest,
    sourceIdempotencyFingerprint: digest,
    agentId: null,
    agentVersionId: null,
    agentConfigHash: null,
    runId: null,
    runFingerprint: null,
    runSourceReleaseId: null,
    invocationId: f.changeSetId,
    invocationFingerprint: digest,
    title: "Evidence",
    summary: null,
    state: "cancelled",
    draftVersion: 1,
    draftHash: plan.body.draftHash,
    validationGeneration: 1,
    baseFingerprint: plan.body.baseFingerprint,
    planHash,
    sealedPlanBody: plan,
    riskSummary: plan.body.risk,
    policyRefs: [],
    scheduledFor: null,
    expiresAt: new Date(plan.body.expiresAt),
    rollbackWindowSeconds: plan.body.rollbackWindowSeconds,
    rollbackEligibleUntil: null,
    cancellationCode: "OPERATOR_CANCELLED",
    createdAt: at,
    updatedAt: at,
    appliedAt: null,
    verifiedAt: null,
    rolledBackAt: null,
  };
  const operations: PlanProof["operations"] = [
    {
      id: f.changeSetId,
      siteId: f.siteId,
      changesetId: f.changeSetId,
      ordinal: 1,
      clientOperationId: planned.operation.clientOperationId,
      resourceKind: "setting",
      resourceKey: planned.canonicalResourceKey,
      operation: "replace",
      input: planned.operation,
      baseVersion: null,
      beforeHash: planned.beforeHash,
      beforeSnapshot: snapshot,
      snapshotHash: planned.snapshotHash,
      afterHash: null,
      state: "valid",
      issues: [],
      resultDigest: null,
      createdAt: at,
      updatedAt: at,
    },
  ];
  const authorityRef = {
    kind: "runtime-run" as const,
    principalId: f.changeSetId,
    runId: f.changeSetId,
    agentVersionId: f.changeSetId,
    deadlineAt: f.expiresAt,
  };
  const attempt: NonNullable<PlanProof["attempt"]> = {
    id: f.changeSetId,
    siteId: f.siteId,
    changesetId: f.changeSetId,
    generation: 1,
    draftVersion: 1,
    draftHash: changeSet.draftHash,
    admittingInvocationId: f.changeSetId,
    authorizationContextBody: {
      schemaVersion: "np.agent-authorization-context.v1",
      siteId: f.siteId,
      actor: { kind: "principal", principalId: f.changeSetId, actorFingerprint: digest },
      transport: "runtime",
      gatewayExposure: null,
      authorityRef,
    },
    authorizationContextFingerprint: digest,
    authorityRef,
    requesterKind: "principal",
    requesterId: f.changeSetId,
    requesterFingerprint: digest,
    state: "ready",
    issues: [],
    riskSummary: plan.body.risk,
    resultDigest: hash("np.agent-changeset-validation-result.v1", {
      generation: 1,
      draftHash: changeSet.draftHash,
      planHash,
      issues: [],
    }),
    errorCode: null,
    createdAt: at,
    startedAt: at,
    finishedAt: at,
    expiresAt: changeSet.expiresAt,
  };
  return { changeSet, operations, attempt };
}

import { npVerifyCancelledPreviewEvidenceV1 as verify } from "./cancelled-preview-evidence.js";
import {
  npDigestAgentPreviewContractCanonical,
  npDigestAgentPreviewRoutesCanonical,
} from "../agent-contract/canonical-preview.js";
import { npDigestAgentPreviewArtifactManifestCanonical } from "../agent-contract/canonical-preview-artifact.js";
import {
  npDigestAgentPreviewArtifactUploadRequestV1,
  npDigestAgentPreviewArtifactUploadSetV1,
  npDigestAgentPreviewArtifactUploadReceiptV1,
  npDigestAgentPreviewArtifactDeleteReceiptV1,
  npAgentPreviewArtifactUploadIdempotencyV1,
} from "./preview-artifact-contract.js";
type Proof = Parameters<typeof verify>[0];
async function fixture(): Promise<Proof> {
  const { changeSet } = await planFixture();
  const time = (n: number) => new Date(changeSet.createdAt.getTime() + n * 1000);
  const contract: Proof["preview"]["previewContractBody"] = {
    schemaVersion: "np.agent-preview-contract.v1",
    overlayResolverVersion: 2,
    rendererId: "next-overlay",
    rendererVersion: 3,
    rendererFingerprint: "sha256:next-overlay-v3",
    screenshotAdapterId: "playwright",
    screenshotAdapterVersion: 1,
    screenshotAdapterFingerprint: "sha256:playwright-v1",
    routeParserVersion: 2,
    checkRegistryVersion: 4,
    linkAllowlistVersion: 1,
    linkAllowlistOrigins: [],
    networkPolicyVersion: 3,
    artifactLimitsVersion: 1,
    reportSchemaVersion: 2,
    responseHeaderBuilderVersion: 1,
    cspBuilderVersion: 5,
  };
  const preview: Proof["preview"] = {
    id: "22222222-2222-4222-8222-222222222222",
    siteId: changeSet.siteId,
    changesetId: changeSet.id,
    planHash: changeSet.planHash!,
    generation: 1,
    previewContractBody: contract,
    previewContractFingerprint: await npDigestAgentPreviewContractCanonical(contract),
    admittingInvocationId: changeSet.id,
    authorizationContextBody: (await planFixture()).attempt!.authorizationContextBody,
    authorizationContextFingerprint: digest,
    authorityRef: (await planFixture()).attempt!.authorityRef,
    requesterKind: "principal",
    requesterId: changeSet.id,
    requesterFingerprint: digest,
    state: "expired",
    diffSummary: { operationCount: 1 },
    checkSummary: { checksRun: 0, screenshots: 0 },
    riskSummary: changeSet.riskSummary,
    allowedRoutes: [],
    allowedRoutesDigest: "",
    digest: null,
    expectedArtifactCount: 1,
    uploadSetDigest: null,
    artifactReservedAt: time(1),
    renderBootstrapJti: null,
    renderAttemptId: null,
    renderSessionId: null,
    renderBootstrapIssuedAt: null,
    renderBootstrapExpiresAt: null,
    renderBootstrapConsumedAt: null,
    runId: null,
    jobId: null,
    errorCode: null,
    createdAt: time(0),
    renderingStartedAt: time(1),
    completedAt: time(3),
    expiresAt: time(50),
  };
  const common = {
    siteId: preview.siteId,
    changeSetId: preview.changesetId,
    previewId: preview.id,
    generation: preview.generation,
    planHash: preview.planHash,
    previewContractFingerprint: preview.previewContractFingerprint,
  };
  preview.allowedRoutesDigest = await npDigestAgentPreviewRoutesCanonical({
    schemaVersion: "np.agent-preview-routes.v1",
    siteId: preview.siteId,
    changeSetId: preview.changesetId,
    previewId: preview.id,
    generation: 1,
    planHash: preview.planHash,
    routes: [],
  });
  const artifact: Proof["artifacts"][number] = {
    id: "33333333-3333-4333-8333-333333333333",
    siteId: preview.siteId,
    previewId: preview.id,
    ordinal: 1,
    kind: "report",
    previewContractFingerprint: preview.previewContractFingerprint,
    route: null,
    locale: null,
    viewport: null,
    reportPart: 1,
    reportTotalParts: 1,
    storageKey: "agent-preview/report",
    contentDigest: `ac1:sha256:${"A".repeat(43)}`,
    mime: "application/json",
    bytes: 100,
    storageAdapterId: "fixture",
    storageAdapterContractVersion: 1,
    storageAdapterFingerprint: digest,
    objectState: "absent",
    objectExpiresAt: preview.expiresAt,
    metadataPruneAt: time(366 * 86400),
    deleteAttempt: 1,
    deleteReceiptDigest: null,
    deleteStatus: "deleted",
    deleteErrorCode: null,
    deletedAt: time(60),
    rowVersion: 3,
    createdAt: time(1),
  };
  const entry = {
    artifactId: artifact.id,
    ordinal: 1,
    kind: artifact.kind,
    route: null,
    locale: null,
    viewport: null,
    reportPart: 1,
    reportTotalParts: 1,
    contentDigest: artifact.contentDigest,
    mime: artifact.mime,
    bytes: artifact.bytes,
  };
  const adapter = {
    storageAdapterId: artifact.storageAdapterId,
    storageAdapterContractVersion: 1,
    storageAdapterFingerprint: digest,
  };
  const requestDigest = npDigestAgentPreviewArtifactUploadRequestV1({
    schemaVersion: "np.agent-preview-artifact-upload-request.v1",
    ...common,
    ...entry,
    ...adapter,
    storageKey: artifact.storageKey,
  });
  preview.uploadSetDigest = npDigestAgentPreviewArtifactUploadSetV1({
    schemaVersion: "np.agent-preview-artifact-upload-set.v1",
    ...common,
    uploads: [{ ordinal: 1, artifactId: artifact.id, uploadRequestDigest: requestDigest }],
  });
  const upload: Proof["uploads"][number] = {
    id: "44444444-4444-4444-8444-444444444444",
    siteId: preview.siteId,
    previewId: preview.id,
    artifactId: artifact.id,
    uploadSetDigest: preview.uploadSetDigest,
    uploadRequestDigest: requestDigest,
    idempotencyKey: npAgentPreviewArtifactUploadIdempotencyV1(requestDigest),
    state: "succeeded",
    attempt: 1,
    rowVersion: 2,
    leaseUntil: null,
    callDeadlineAt: time(61),
    adapterOperationStatus: "committed",
    adapterOperationRef: "fixture-operation",
    adapterOperationReceiptDigest: null,
    adapterOperationResolvedAt: time(2),
    observedObjectState: "present",
    everObservedPresent: true,
    verifiedAt: time(2),
    lastErrorCode: null,
    createdAt: time(1),
    startedAt: time(1),
    finishedAt: time(2),
    pruneAt: time(366 * 86400),
  };
  upload.adapterOperationReceiptDigest = npDigestAgentPreviewArtifactUploadReceiptV1({
    schemaVersion: "np.agent-preview-artifact-upload-operation-receipt.v1",
    siteId: preview.siteId,
    previewId: preview.id,
    artifactId: artifact.id,
    uploadRequestDigest: requestDigest,
    idempotencyKey: upload.idempotencyKey,
    ...adapter,
    status: "committed",
    safeCode: null,
    resolvedAt: time(2).toISOString(),
  });
  artifact.deleteReceiptDigest = npDigestAgentPreviewArtifactDeleteReceiptV1({
    schemaVersion: "np.agent-artifact-delete-receipt.v1",
    siteId: preview.siteId,
    previewId: preview.id,
    artifactId: artifact.id,
    contentDigest: artifact.contentDigest,
    ...adapter,
    deleteAttempt: 1,
    status: "deleted",
    deletedAt: time(60).toISOString(),
  });
  preview.digest = await npDigestAgentPreviewArtifactManifestCanonical({
    schemaVersion: "np.agent-preview-artifact-manifest.v1",
    ...common,
    artifacts: [{ ...entry, createdAt: time(1).toISOString(), expiresAt: time(50).toISOString() }],
  });
  return {
    changeSet,
    preview,
    artifacts: [artifact],
    uploads: [upload],
    viewerLaunches: [],
    renderSessions: [],
    releasedAt: time(200),
  };
}
describe("cancelled preview evidence", () => {
  it("verifies immutable manifest and settled storage receipts after cleanup", async () => {
    const f = await fixture();
    const before = structuredClone(f);
    expect(await verify(f)).toBe(true);
    expect(f).toEqual(before);
  });
  it("rejects active render sessions and enforces expiry skew after closure", async () => {
    const f = await fixture();
    const p = f.preview;
    const at = (n: number) => new Date(f.releasedAt.getTime() - n * 1000);
    p.renderSessionId = "55555555-5555-4555-8555-555555555555";
    p.renderAttemptId = "66666666-6666-4666-8666-666666666666";
    f.renderSessions = [
      {
        id: p.renderSessionId,
        siteId: p.siteId,
        previewId: p.id,
        generation: p.generation,
        planHash: p.planHash,
        renderAttemptId: p.renderAttemptId,
        allowedRoutesDigest: p.allowedRoutesDigest,
        previewContractFingerprint: p.previewContractFingerprint,
        state: "completed",
        cookieVerifier: "rcv1:hmac-sha256:test:" + "A".repeat(43),
        cookieVerifierKeyId: "test",
        issuedAt: at(180),
        expiresAt: at(61),
        closedAt: at(100),
        closeReason: null,
        capturePlan: [
          {
            ordinal: 1,
            route: "/",
            locale: null,
            audience: "public",
            viewportName: "desktop",
            width: 1280,
            height: 720,
            deviceScaleFactor: 1,
            captureTicketDigest: "test",
            captureTicketKeyId: "test",
          },
        ],
        consumedOrdinals: [true],
      },
    ];
    expect(await verify(f)).toBe(true);
    f.renderSessions[0].expiresAt = at(59);
    expect(await verify(f)).toBe(false);
    f.renderSessions[0].expiresAt = at(61);
    f.renderSessions[0].state = "active";
    expect(await verify(f)).toBe(false);
  });
  const mutations: Array<[string, (f: Proof) => void]> = [
    [
      "unknown upload outcome",
      (f) => {
        f.uploads[0].adapterOperationStatus = "unknown";
      },
    ],
    [
      "pending cleanup",
      (f) => {
        f.artifacts[0].objectState = "delete_pending";
      },
    ],
    [
      "missing deletion receipt",
      (f) => {
        f.artifacts[0].deleteReceiptDigest = null;
      },
    ],
    [
      "altered upload receipt",
      (f) => {
        f.uploads[0].adapterOperationReceiptDigest = "auo1:sha256:" + "B".repeat(43);
      },
    ],
    [
      "missing artifact",
      (f) => {
        f.artifacts = [];
      },
    ],
    [
      "duplicate upload",
      (f) => {
        f.uploads.push({ ...f.uploads[0] });
      },
    ],
    [
      "changed manifest",
      (f) => {
        f.artifacts[0].contentDigest = "ac1:sha256:" + "B".repeat(43);
      },
    ],
    [
      "changed contract",
      (f) => {
        f.preview.previewContractBody.rendererVersion++;
      },
    ],
    [
      "live preview state",
      (f) => {
        f.preview.state = "ready";
      },
    ],
    [
      "unsupported job locator",
      (f) => {
        f.preview.jobId = f.changeSet.id;
      },
    ],
    [
      "separate run reference",
      (f) => {
        f.preview.runId = f.changeSet.id;
      },
    ],
    [
      "bootstrap skew",
      (f) => {
        f.preview.renderBootstrapExpiresAt = new Date(f.releasedAt.getTime() - 59_000);
      },
    ],
    [
      "unresolved render identity",
      (f) => {
        f.preview.renderSessionId = f.changeSet.id;
      },
    ],
  ];
  it.each(mutations)("pins %s", async (_name, mutate) => {
    const f = await fixture();
    mutate(f);
    expect(await verify(f)).toBe(false);
  });
  it("accepts terminal failure before reservation but refuses partial reserved generation", async () => {
    const f = await fixture();
    Object.assign(f.preview, {
      state: "failed",
      errorCode: "PREVIEW_FAILED",
      expectedArtifactCount: null,
      uploadSetDigest: null,
      artifactReservedAt: null,
      digest: null,
      expiresAt: null,
    });
    f.artifacts = [];
    f.uploads = [];
    expect(await verify(f)).toBe(true);
    f.preview.expectedArtifactCount = 0;
    expect(await verify(f)).toBe(false);
  });
});
