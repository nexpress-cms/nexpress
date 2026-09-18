import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npVerifyCancelledChangeSetAttributionV1 as verify } from "./cancelled-changeset-source-release.js";
import { npAgentReleaseActionDigestV1 } from "./source-release-read.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npBuildAgentChangeSetCapabilityDefinitionCanonicalV1 } from "../agent-contract/installed-capability-contract.js";
import { npDigestAgentCapabilityRegistryCanonical } from "../agent-contract/canonical-capability-registry.js";
import { npDigestAgentAuthorizationContextCanonical } from "../agent-contract/canonical-authorization-context.js";
import { npDigestAgentInvocationRequestCanonical } from "../agent-contract/canonical-idempotency-request.js";
import { npDigestAgentChangeSetDraftInputV1 } from "../agent-contract/changeset-wire-contract.js";

type Proof = Parameters<typeof verify>[0];
type Action = Proof["action"];
type Invocation = Proof["invocation"];
const uuid = (n: number) => `11111111-1111-4111-8111-${n.toString().padStart(12, "0")}`;
const id = uuid(1),
  principalId = uuid(2),
  versionId = uuid(3),
  actionId = uuid(4),
  invocationId = uuid(5),
  changeSetId = uuid(6),
  auditId = uuid(7),
  releaseId = uuid(8);
const digest = `cj1:sha256:${"A".repeat(43)}`;
const siteId = "cancelled-source-test";
const at = new Date("2026-01-01T00:00:00.000Z");
const deadlineAt = "2026-01-01T00:05:00.000Z";
const releasedAt = new Date("2026-09-01T00:00:00.000Z");
const hash = (domain: string, value: unknown) =>
  `cj1:sha256:${createHash("sha256").update(`${domain}\0`).update(serializeAgentCanonicalJson(value)).digest("base64url")}`;
async function fixture(key = "proposal-request-1"): Promise<Proof> {
  const definition = npBuildAgentChangeSetCapabilityDefinitionCanonicalV1("changeset.create");
  const capabilityFingerprint = await npDigestAgentCapabilityRegistryCanonical(
    definition,
    definition.capabilities,
  );
  const actorFingerprint = hash("np.agent-principal-actor.v1", { siteId, principalId });
  const input = {
    title: "Original proposal",
    summary: null,
    operations: [
      {
        clientOperationId: "op1",
        reason: null,
        kind: "document",
        operation: "create",
        resource: { collection: "posts", documentId: null },
        base: null,
        input: { document: { title: "Original" }, targetStatus: "draft" },
      },
    ],
  };
  const output = { changeSetId };
  const authorizationContextBody: Invocation["authorizationContextBody"] = {
    schemaVersion: "np.agent-authorization-context.v1",
    siteId,
    actor: { kind: "principal", principalId, actorFingerprint },
    transport: "runtime",
    gatewayExposure: null,
    authorityRef: {
      kind: "runtime-run",
      principalId,
      runId: id,
      agentVersionId: versionId,
      deadlineAt,
    },
  };
  const authorizationContextFingerprint =
    await npDigestAgentAuthorizationContextCanonical(authorizationContextBody);
  const requestBody: Invocation["requestBody"] = {
    schemaVersion: "np.agent-idempotency-request.v1",
    siteId,
    actorKind: "principal",
    actorFingerprint,
    authorizationContextFingerprint,
    operationKind: "capability",
    operationId: "changeset.create",
    contractVersion: 1,
    contractFingerprint: capabilityFingerprint,
    effectProfile: { id: "changeset.draft-create", contractVersion: 1 },
    input,
  };
  const requestHash = await npDigestAgentInvocationRequestCanonical(requestBody);
  const invocation: Invocation = {
    id: invocationId,
    siteId,
    actorKind: "principal",
    principalId,
    staffUserId: null,
    actorFingerprint: actorFingerprint,
    authorizationContextBody,
    authorizationContextFingerprint,
    authorityRef: { ...authorizationContextBody.authorityRef },
    actorDeletedAt: null,
    operationKind: "capability",
    operationId: "changeset.create",
    contractVersion: 1,
    contractFingerprint: capabilityFingerprint,
    capabilityDefinitionBody: definition,
    effectProfileId: "changeset.draft-create",
    effectContractVersion: 1,
    transport: "runtime",
    mcpExecutionMode: null,
    mcpRequestedTaskTtlMs: null,
    idempotencyKey: key,
    requestBody,
    requestHash,
    state: "completed",
    runId: id,
    resultKind: "changeset",
    resultId: changeSetId,
    outputRedacted: output,
    outputHash: hash("np.agent-changeset-result.v1", output),
    oneTimeValueIssued: false,
    oneTimeResourceId: null,
    oneTimeRecoveryOperationId: null,
    auditEventId: auditId,
    errorCode: null,
    requestedAt: at,
    completedAt: at,
    expiresAt: new Date(deadlineAt),
  };
  const action: Action = {
    id: actionId,
    siteId,
    runId: id,
    runFingerprint: digest,
    runSourceReleaseId: null,
    invocationId,
    invocationFingerprint: requestHash,
    executionInvocationId: null,
    executionInvocationFingerprint: null,
    sequence: 1,
    capabilityId: "changeset.create",
    capabilityContractVersion: 1,
    capabilityFingerprint,
    capabilityDefinitionBody: definition,
    effectProfileId: "changeset.draft-create",
    effectContractVersion: 1,
    risk: "reversible",
    state: "succeeded",
    idempotencyKey: key,
    inputRedacted: {},
    inputCanonical: input,
    requiredScopes: definition.capabilities[0].descriptor.requiredScopes,
    targetRefs: [],
    targetVersionFacts: [],
    inputHash: digest,
    outputRedacted: output,
    outputHash: hash("np.agent-runtime-changeset-output.v1", output),
    effectDigest: null,
    targetVersionDigest: null,
    verifierId: null,
    verificationState: null,
    verificationResultDigest: null,
    verificationEvidence: null,
    verifiedAt: null,
    undoRef: null,
    compensatorId: null,
    compensationResultDigest: null,
    compensationEvidence: null,
    compensatedAt: null,
    errorCode: null,
    approvalId: null,
    containmentId: null,
    enforcementAdapterId: null,
    enforcementAdapterContractVersion: null,
    enforcementAdapterFingerprint: null,
    compensatesActionId: null,
    auditEventId: auditId,
    startedAt: at,
    finishedAt: at,
    createdAt: at,
  };
  action.inputHash = await npAgentReleaseActionDigestV1(action);

  const changeSet: Proof["changeSet"] = {
    id: changeSetId,
    siteId,
    creatorKind: "runtime",
    principalId,
    createdByUserId: null,
    actorDeletedAt: null,
    actorFingerprint,
    sourceOperationId: "changeset.create",
    sourceInputHash: await npDigestAgentChangeSetDraftInputV1(input),
    sourceIdempotencyFingerprint: hash("np.agent-changeset-source-idempotency.v1", key),
    agentId: uuid(9),
    agentVersionId: versionId,
    agentConfigHash: digest,
    runId: id,
    runFingerprint: digest,
    runSourceReleaseId: null,
    invocationId,
    invocationFingerprint: requestHash,
    title: input.title,
    summary: null,
    state: "cancelled",
    draftVersion: 1,
    draftHash: digest,
    validationGeneration: 0,
    baseFingerprint: null,
    planHash: null,
    sealedPlanBody: null,
    riskSummary: null,
    policyRefs: [],
    scheduledFor: null,
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    rollbackWindowSeconds: null,
    rollbackEligibleUntil: null,
    cancellationCode: "OPERATOR_CANCELLED",
    createdAt: at,
    updatedAt: new Date("2026-01-01T00:01:00.000Z"),
    appliedAt: null,
    verifiedAt: null,
    rolledBackAt: null,
  };
  const audit: Proof["audit"] = {
    id: auditId,
    siteId,
    actorKind: "agent-principal",
    actorUserId: null,
    actorMemberId: null,
    action: "agents.changesets.create",
    targetType: "agent-changeset",
    targetId: changeSetId,
    payload: { requestHash, operationId: "changeset.create", outcome: "completed" },
    createdAt: at,
  };
  return {
    action,
    invocation,
    changeSet,
    audit,
    runId: id,
    runFingerprint: digest,
    principalId,
    agentVersionId: versionId,
    agentId: uuid(9),
    agentConfigHash: digest,
    deadlineAt,
    releasedAt,
  };
}

describe("cancelled ChangeSet source attribution", () => {
  it.each(["proposal-request-1", `runtime:${id}:1`])(
    "preserves live and detached proof for key %s",
    async (key) => {
      const f = await fixture(key);
      const before = structuredClone(f);
      const live = await verify(f);
      expect(live).not.toBeNull();
      expect(f).toEqual(before);
      f.action.runId = null;
      f.action.runSourceReleaseId = releaseId;
      f.changeSet.runId = null;
      f.changeSet.runSourceReleaseId = releaseId;
      expect(await verify(f)).toEqual(live);
      expect(f.invocation.idempotencyKey).toBe(key);
    },
  );
  it("binds original creation input independently of the current draft", async () => {
    const f = await fixture();
    f.changeSet.title = "Subsequently updated draft";
    f.changeSet.draftVersion = 2;
    f.changeSet.draftHash = `cj1:sha256:${"B".repeat(43)}`;
    expect(await verify(f)).not.toBeNull();
    f.changeSet.sourceInputHash = f.changeSet.draftHash;
    expect(await verify(f)).toBeNull();
  });
  const tamper: Array<[string, (f: Proof) => void]> = [
    [
      "input",
      (f) => {
        f.action.inputCanonical.title = "Changed";
      },
    ],
    [
      "auth",
      (f) => {
        f.invocation.authorizationContextBody.siteId = "other";
      },
    ],
    [
      "output",
      (f) => {
        f.invocation.outputRedacted = { changeSetId: uuid(99) };
      },
    ],
    [
      "Action output hash",
      (f) => {
        f.action.outputHash = digest;
      },
    ],
    [
      "audit",
      (f) => {
        f.audit.payload.outcome = "started";
      },
    ],
    [
      "audit site",
      (f) => {
        f.audit.siteId = "other";
      },
    ],
    [
      "fingerprint",
      (f) => {
        f.changeSet.runFingerprint = `cj1:sha256:${"B".repeat(43)}`;
      },
    ],
    [
      "expiry",
      (f) => {
        f.invocation.expiresAt = new Date("2027-01-01T00:00:00.000Z");
      },
    ],
    [
      "premature ChangeSet expiry",
      (f) => {
        f.changeSet.cancellationCode = "CHANGESET_EXPIRED";
      },
    ],
    [
      "validation history",
      (f) => {
        f.changeSet.validationGeneration = 1;
      },
    ],
    [
      "approval",
      (f) => {
        f.action.approvalId = uuid(99);
      },
    ],
    [
      "execution",
      (f) => {
        f.action.executionInvocationId = uuid(99);
        f.action.executionInvocationFingerprint = digest;
      },
    ],
    [
      "undo",
      (f) => {
        f.action.undoRef = { recovery: true };
      },
    ],
    [
      "verification",
      (f) => {
        f.action.verificationEvidence = [{ pending: true }];
      },
    ],
    [
      "compensation",
      (f) => {
        f.action.compensationEvidence = [{ pending: true }];
      },
    ],
    [
      "containment",
      (f) => {
        f.action.containmentId = uuid(99);
      },
    ],
    [
      "error",
      (f) => {
        f.action.errorCode = "UNKNOWN";
      },
    ],
    [
      "nonproducer redaction",
      (f) => {
        f.action.inputRedacted = { unexpected: true };
      },
    ],
  ];
  it.each(tamper)("rejects %s evidence", async (_name, mutate) => {
    const f = await fixture();
    mutate(f);
    expect(await verify(f)).toBeNull();
  });
  it("accepts expiry only after the original ChangeSet deadline", async () => {
    const f = await fixture();
    f.changeSet.cancellationCode = "CHANGESET_EXPIRED";
    f.changeSet.updatedAt = new Date(f.changeSet.expiresAt);
    expect(await verify(f)).not.toBeNull();
  });
});
