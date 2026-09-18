import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { npVerifyClosedApprovalEvidenceV1 as verify } from "./closed-approval-evidence.js";
import { previewFixture } from "./changeset-preview-test-fixture.js";
import { serializeAgentCanonicalJson } from "../agent-contract/canonical-foundation.js";
import { npDigestAgentChangeSetPlanCanonical } from "../agent-contract/canonical-changeset.js";
import {
  npRequireAgentApprovalStatementCanonical,
  npDigestAgentApprovalStatementCanonical,
  npMacAgentApprovalStatementCanonical,
  npRequireAgentApprovalDecisionCanonicalForStatement,
  npDigestAgentApprovalDecisionCanonical,
  npMacAgentApprovalDecisionCanonical,
} from "../agent-contract/canonical-approval.js";
const id = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const hash = `cj1:sha256:${"A".repeat(43)}`;
const key = {
  owner: "approval-integrity" as const,
  id: "test-key",
  bytes: new Uint8Array(32).fill(17),
};
type Proof = Parameters<typeof verify>[0];
async function fixture(reject = false): Promise<Proof> {
  const p = await previewFixture();
  if (p.plan.planKind !== "changeset") throw new Error("Expected initial plan");
  p.plan.body.expiresAt = "2026-09-01T02:00:00.000Z";
  const planHash = await npDigestAgentChangeSetPlanCanonical(p.plan);
  const s = npRequireAgentApprovalStatementCanonical({
    version: "np.agent-approval-statement.v1",
    siteId: p.siteId,
    approvalId: id,
    requester: { kind: "principal", principalId: id, fingerprint: hash },
    target: { kind: "changeset", changeSetId: p.changeSetId, planHash, scheduledFor: null },
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: hash,
    requiredScopes: p.plan.body.requiredScopes,
    requiredHumanCapabilities: p.plan.body.requiredHumanCapabilities,
    requiredHumanPredicates: p.plan.body.requiredHumanPredicates,
    policyHashes: p.plan.body.policyHashes,
    requiresLivePreview: true,
    previewId: p.previewId,
    previewDigest: hash,
    risk: "sensitive",
    reauthentication: { mode: "recent", assurance: "staff-primary", maxAgeSeconds: 300 },
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T01:00:00.000Z",
  });
  const a: Proof["approval"] = {
    id,
    siteId: p.siteId,
    targetKind: "changeset",
    targetId: p.changeSetId,
    targetChangesetId: p.changeSetId,
    targetActionId: null,
    targetRollbackPlanId: null,
    generation: 1,
    version: 2,
    planHash,
    capabilityId: s.capabilityId,
    capabilityContractVersion: s.capabilityContractVersion,
    capabilityFingerprint: s.capabilityFingerprint,
    requiredScopes: s.requiredScopes,
    requiredHumanCapabilities: s.requiredHumanCapabilities,
    requiredHumanPredicates: s.requiredHumanPredicates,
    policyHashes: s.policyHashes,
    requiresLivePreview: true,
    previewId: s.previewId,
    previewDigest: s.previewDigest,
    requiredReauthMode: "recent-staff-primary",
    requiredReauthMaxAgeSeconds: 300,
    statementBody: s,
    statementHash: await npDigestAgentApprovalStatementCanonical(s),
    statementMac: await npMacAgentApprovalStatementCanonical(s, key),
    integrityKeyId: key.id,
    challengeGeneration: 0,
    challengePurpose: null,
    challengeHash: null,
    challengeHashKeyId: null,
    challengeIssuedToUserId: null,
    challengeSessionFingerprint: null,
    challengeExpiresAt: null,
    challengeConsumedAt: null,
    state: "expired",
    risk: s.risk,
    requesterKind: "principal",
    requestedByPrincipalId: id,
    requestedByUserId: null,
    requesterFingerprint: hash,
    requestedAt: new Date(s.createdAt),
    expiresAt: new Date(s.expiresAt),
    decidedByUserId: null,
    deciderFingerprint: null,
    decisionBody: null,
    decisionHash: null,
    decisionMac: null,
    decisionReauthFingerprint: null,
    decisionReauthenticatedAt: null,
    decidedAt: null,
    reason: null,
    revocationKind: null,
    revokedByUserId: null,
    revokerFingerprint: null,
    revocationCode: null,
    revocationReason: null,
    revocationBody: null,
    revocationHash: null,
    revocationMac: null,
    revocationIntegrityKeyId: null,
    revokedAt: null,
    consumedAt: null,
  };
  if (reject) {
    const fingerprint = `cj1:sha256:${createHash("sha256")
      .update("np.agent-staff-actor.v1\0")
      .update(serializeAgentCanonicalJson({ siteId: a.siteId, userId }))
      .digest("base64url")}`;
    const binding = {
      statement: s,
      statementHash: a.statementHash,
      approvalGeneration: a.generation,
    };
    const d = await npRequireAgentApprovalDecisionCanonicalForStatement(
      {
        schemaVersion: "np.agent-approval-decision.v1",
        siteId: a.siteId,
        approvalId: a.id,
        approvalGeneration: 1,
        statementHash: a.statementHash,
        decision: "reject",
        deciderFingerprint: fingerprint,
        currentHumanCapabilities: s.requiredHumanCapabilities,
        reason: "Not needed",
        reauthentication: { mode: "none" },
        decidedAt: "2026-09-01T00:10:00.000Z",
      },
      binding,
    );
    Object.assign(a, {
      state: "rejected",
      version: 3,
      challengeGeneration: 1,
      challengeConsumedAt: new Date(d.decidedAt),
      decidedByUserId: userId,
      deciderFingerprint: fingerprint,
      decisionBody: d,
      decisionHash: await npDigestAgentApprovalDecisionCanonical(d, binding),
      decisionMac: await npMacAgentApprovalDecisionCanonical(d, binding, key),
      decisionReauthFingerprint: null,
      decisionReauthenticatedAt: null,
      decidedAt: new Date(d.decidedAt),
      reason: d.reason,
    });
  }
  return {
    changeSet: {
      id: p.changeSetId,
      siteId: p.siteId,
      planHash,
      sealedPlanBody: p.plan,
      expiresAt: new Date(p.plan.body.expiresAt),
    },
    approval: a,
    previews: [
      {
        id: p.previewId,
        siteId: p.siteId,
        changesetId: p.changeSetId,
        planHash,
        digest: hash,
        createdAt: new Date("2026-08-31T23:58:00.000Z"),
        completedAt: new Date("2026-08-31T23:59:00.000Z"),
        expiresAt: new Date("2026-09-01T02:00:00.000Z"),
      },
    ],
    releasedAt: new Date("2026-09-02T00:00:00.000Z"),
  };
}
describe("closed approval structural history", () => {
  it.each([false, true])(
    "accepts original elapsed closed evidence, rejected=%s",
    async (reject) => {
      expect(await verify(await fixture(reject))).toBe(true);
    },
  );
  it.each(["pending", "approved", "consumed", "revoked"])("pins %s", async (state) => {
    const f = await fixture();
    f.approval.state = state;
    expect(await verify(f)).toBe(false);
  });
  it("pins expired evidence with any prior decision", async () => {
    const f = await fixture(true);
    f.approval.state = "expired";
    expect(await verify(f)).toBe(false);
  });
  it("pins expired formerly approved evidence even with canonical approve hashes", async () => {
    const f = await fixture(true);
    const a = f.approval;
    const binding = {
      statement: a.statementBody,
      statementHash: a.statementHash,
      approvalGeneration: a.generation,
    };
    const d = await npRequireAgentApprovalDecisionCanonicalForStatement(
      {
        ...a.decisionBody!,
        decision: "approve",
        reauthentication: {
          mode: "recent",
          assurance: "staff-primary",
          maxAgeSeconds: 300,
          sessionFactFingerprint: hash,
          reauthenticatedAt: "2026-09-01T00:09:00.000Z",
        },
      },
      binding,
    );
    a.state = "expired";
    a.decisionBody = d;
    a.decisionHash = await npDigestAgentApprovalDecisionCanonical(d, binding);
    a.decisionMac = await npMacAgentApprovalDecisionCanonical(d, binding, key);
    a.decisionReauthFingerprint = hash;
    a.decisionReauthenticatedAt = new Date("2026-09-01T00:09:00.000Z");
    expect(await verify(f)).toBe(false);
  });
  it("pins rejected evidence while its original replay deadline is live", async () => {
    const f = await fixture(true);
    f.releasedAt = new Date("2026-09-01T00:20:00.000Z");
    expect(await verify(f)).toBe(false);
  });
  it.each([
    "statementHash",
    "statementMac",
    "integrityKeyId",
    "requesterFingerprint",
    "capabilityFingerprint",
  ] as const)("rejects mismatched %s", async (field) => {
    const f = await fixture();
    f.approval[field] = "changed";
    expect(await verify(f)).toBe(false);
  });
  it("checks decision canonical digest and its row attribution", async () => {
    const f = await fixture(true);
    f.approval.reason = "other";
    expect(await verify(f)).toBe(false);
    f.approval.reason = f.approval.decisionBody!.reason;
    f.approval.decisionHash = hash;
    expect(await verify(f)).toBe(false);
  });
  it("pins uncleared challenges, even when expired", async () => {
    const f = await fixture();
    f.approval.challengeExpiresAt = f.approval.expiresAt;
    expect(await verify(f)).toBe(false);
  });
  it("pins consumed or partially revoked evidence", async () => {
    const f = await fixture();
    f.approval.consumedAt = f.approval.expiresAt;
    expect(await verify(f)).toBe(false);
    f.approval.consumedAt = null;
    f.approval.revocationCode = "REVOKED";
    expect(await verify(f)).toBe(false);
  });
  it("requires the retained current plan and preview", async () => {
    const f = await fixture();
    f.previews[0].planHash = hash;
    expect(await verify(f)).toBe(false);
    f.previews[0].planHash = f.changeSet.planHash!;
    f.changeSet.sealedPlanBody!.changeSetId = id;
    expect(await verify(f)).toBe(false);
  });
  it("keeps deleted decider metadata compatible with immutable fingerprint evidence", async () => {
    const f = await fixture(true);
    f.approval.decidedByUserId = null;
    expect(await verify(f)).toBe(true);
  });
  it("does not claim MAC authentication without the approval owner's keys", async () => {
    const f = await fixture();
    f.approval.statementMac = `cj1:hmac-sha256:${key.id}:${"B".repeat(43)}`;
    expect(await verify(f)).toBe(true);
  });
});
