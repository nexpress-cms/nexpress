import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npVerifyAgentChangeSetPlanEvidenceV1 as verify } from "./changeset-plan-evidence.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import {
  npDigestAgentChangeSetPlanCanonical,
  npDigestAgentChangeSetProposalCanonical,
} from "../agent-contract/canonical-changeset.js";
type Proof = Parameters<typeof verify>[0];
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
const digest = `cj1:sha256:${"A".repeat(43)}`;
async function fixture(): Promise<Proof> {
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
  const changeSet: Proof["changeSet"] = {
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
  const operations: Proof["operations"] = [
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
  const attempt: NonNullable<Proof["attempt"]> = {
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
describe("shared ChangeSet plan evidence", () => {
  it("preserves cancelled sealed evidence without mutating it", async () => {
    const f = await fixture();
    const before = structuredClone(f);
    expect(await verify(f)).toBe(true);
    expect(f).toEqual(before);
  });
  it.each(["applied", "verified"])("preserves %s operation verification", async (state) => {
    const f = await fixture();
    f.changeSet.state = state;
    f.operations[0].state = state;
    f.operations[0].afterHash = digest;
    f.operations[0].resultDigest = digest;
    f.execution = {
      committedAt: new Date(),
      verificationState: state === "verified" ? "passed" : "pending",
    };
    expect(await verify(f)).toBe(true);
    f.execution = null;
    expect(await verify(f)).toBe(false);
  });
  const mutations: Array<[string, (f: Proof) => void]> = [
    [
      "draft hash",
      (f) => {
        f.changeSet.title = "Changed";
      },
    ],
    [
      "snapshot contents",
      (f) => {
        f.operations[0].beforeSnapshot!.value = { unexpected: true };
      },
    ],
    [
      "snapshot binding",
      (f) => {
        f.operations[0].snapshotHash = digest;
      },
    ],
    [
      "validation digest",
      (f) => {
        f.attempt!.resultDigest = digest;
      },
    ],
    [
      "operation order",
      (f) => {
        f.operations[0].ordinal = 2;
      },
    ],
    [
      "plan absence",
      (f) => {
        f.changeSet.sealedPlanBody = null;
      },
    ],
    [
      "pre-execution result",
      (f) => {
        f.operations[0].resultDigest = digest;
      },
    ],
  ];
  it.each(mutations)("rejects changed %s", async (_name, mutate) => {
    const f = await fixture();
    mutate(f);
    expect(await verify(f)).toBe(false);
  });
  it("verifies invalid result and per-operation issues", async () => {
    const f = await fixture();
    Object.assign(f.changeSet, {
      state: "invalid",
      sealedPlanBody: null,
      planHash: null,
      baseFingerprint: null,
      riskSummary: null,
      rollbackWindowSeconds: null,
    });
    const issues = [{ operationOrdinal: 1, code: "INVALID_INPUT" }];
    Object.assign(f.attempt!, {
      state: "invalid",
      issues,
      riskSummary: null,
      resultDigest: hash("np.agent-changeset-validation-result.v1", {
        generation: 1,
        draftHash: f.changeSet.draftHash,
        issues,
      }),
    });
    Object.assign(f.operations[0], {
      state: "invalid",
      issues,
      beforeHash: null,
      beforeSnapshot: null,
      snapshotHash: null,
    });
    expect(await verify(f)).toBe(true);
    f.operations[0].issues = [];
    expect(await verify(f)).toBe(false);
  });
});
