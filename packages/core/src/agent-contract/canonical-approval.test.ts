import { describe, expect, it } from "vitest";
import {
  npAgentApprovalCanonicalDiscriminatorCasesV1,
  npAgentApprovalDecisionCanonicalExcludedKeysV1,
  npAgentApprovalDecisionCanonicalIncludedKeysV1,
  npAgentApprovalDecisionCanonicalNoneReauthenticationIncludedKeysV1,
  npAgentApprovalDecisionCanonicalRecentReauthenticationIncludedKeysV1,
  npAgentApprovalRevocationCanonicalExcludedKeysV1,
  npAgentApprovalRevocationCanonicalIncludedKeysV1,
  npAgentApprovalStatementCanonicalActionTargetIncludedKeysV1,
  npAgentApprovalStatementCanonicalChangeSetTargetIncludedKeysV1,
  npAgentApprovalStatementCanonicalExcludedKeysV1,
  npAgentApprovalStatementCanonicalIncludedKeysV1,
  npAgentApprovalStatementCanonicalNoneReauthenticationIncludedKeysV1,
  npAgentApprovalStatementCanonicalPrincipalRequesterIncludedKeysV1,
  npAgentApprovalStatementCanonicalRecentReauthenticationIncludedKeysV1,
  npAgentApprovalStatementCanonicalRollbackTargetIncludedKeysV1,
  npAgentApprovalStatementCanonicalStaffRequesterIncludedKeysV1,
  npAnalyzeAgentApprovalDecisionCanonical,
  npAnalyzeAgentApprovalRevocationCanonical,
  npAnalyzeAgentApprovalStatementCanonical,
  npBuildAgentApprovalDecisionCanonicalBytes,
  npBuildAgentApprovalRevocationCanonicalBytes,
  npBuildAgentApprovalStatementCanonicalBytes,
  npDigestAgentApprovalDecisionCanonical,
  npDigestAgentApprovalRevocationCanonical,
  npDigestAgentApprovalStatementCanonical,
  npMacAgentApprovalDecisionCanonical,
  npMacAgentApprovalRevocationCanonical,
  npMacAgentApprovalStatementCanonical,
  npRequireAgentApprovalDecisionCanonical,
  npRequireAgentApprovalDecisionCanonicalForStatement,
  npRequireAgentApprovalRevocationCanonical,
  npRequireAgentApprovalRevocationCanonicalForBindings,
  npRequireAgentApprovalStatementCanonical,
  npVerifyAgentApprovalDecisionCanonicalMac,
  npVerifyAgentApprovalRevocationCanonicalMac,
  npVerifyAgentApprovalStatementCanonicalMac,
} from "./canonical-approval.js";
import {
  npAgentApprovalDecisions,
  npAgentApprovalRevocationKinds,
  npAgentApprovalRisks,
  npAgentCanonicalBodyMaxBytesV1,
  type NpAgentApprovalDecisionBindingV1,
  type NpAgentApprovalDecisionCanonicalV1,
  type NpAgentApprovalIntegrityKeyV1,
  type NpAgentApprovalRevocationCanonicalV1,
  type NpAgentApprovalStatementBindingV1,
  type NpAgentApprovalStatementCanonicalV1,
  type NpAgentContractResult,
} from "./types.js";

const decoder = new TextDecoder();
const approvalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const principalId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const userId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const changeSetId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const rollbackPlanId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd5";
const actionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd6";
const runId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd7";
const agentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd8";
const previewId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd9";
const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const digestC = "cj1:sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const statementGoldenHash = "cj1:sha256:d13EthJaPQ66ZJEya8MsOb6y8JAThlkbW7C2Ls_NnGA";
const decisionGoldenHash = "cj1:sha256:9UtTOd9OZoewBHH9dkAHxAGvqNbROMel6Gca_9QDWHQ";
const revocationGoldenHash = "cj1:sha256:YCyjbJiO6mce7YK05EygY6U6TFyo27Gk1Ooa93seHgM";
const statementGoldenMac = "cj1:hmac-sha256:test-key-1:2hHFHX3OgEG_DiSdhw8to298I5ucS0OFX4tmaUV2Rbo";
const decisionGoldenMac = "cj1:hmac-sha256:test-key-1:qsTdpw42pCNH4UWzkplROKm_xWx8rbVgmYCovcb4HYI";
const revocationGoldenMac =
  "cj1:hmac-sha256:test-key-1:3ib97kZJUiL8x_D1gvm8o0dOJaqs6vBL_cWLgMCEPio";
const key: NpAgentApprovalIntegrityKeyV1 = {
  owner: "approval-integrity",
  id: "test-key-1",
  bytes: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
};

function statement(
  overrides: Partial<NpAgentApprovalStatementCanonicalV1> = {},
): NpAgentApprovalStatementCanonicalV1 {
  return {
    version: "np.agent-approval-statement.v1",
    siteId: "docs-site",
    approvalId,
    requester: { kind: "principal", principalId, fingerprint: "sha256:principal-v1" },
    target: { kind: "changeset", changeSetId, planHash: digestA },
    capabilityId: "changeset.apply",
    capabilityContractVersion: 1,
    capabilityFingerprint: digestB,
    requiredScopes: ["changeset:apply", "content:publish"],
    requiredHumanCapabilities: ["admin.manage", "content.publish"],
    requiredHumanPredicates: ["is-super-admin"],
    policyHashes: [digestA, digestB],
    requiresLivePreview: true,
    previewId,
    previewDigest: digestC,
    risk: "sensitive",
    reauthentication: { mode: "recent", assurance: "staff-primary", maxAgeSeconds: 60 },
    createdAt: "2026-08-23T00:00:00.000Z",
    expiresAt: "2026-08-23T01:00:00.000Z",
    ...overrides,
  };
}

function decision(
  statementHash: string,
  overrides: Partial<NpAgentApprovalDecisionCanonicalV1> = {},
): NpAgentApprovalDecisionCanonicalV1 {
  return {
    schemaVersion: "np.agent-approval-decision.v1",
    siteId: "docs-site",
    approvalId,
    approvalGeneration: 3,
    statementHash,
    decision: "approve",
    deciderFingerprint: "sha256:decider-v1",
    currentHumanCapabilities: ["admin.manage", "content.publish", "site.access"],
    reason: "Reviewed exact plan and preview",
    reauthentication: {
      mode: "recent",
      assurance: "staff-primary",
      maxAgeSeconds: 60,
      reauthenticatedAt: "2026-08-23T00:09:30.000Z",
      sessionFactFingerprint: digestC,
    },
    decidedAt: "2026-08-23T00:10:00.000Z",
    ...overrides,
  };
}

function revocation(
  statementHash: string,
  decisionHash: string | null,
  overrides: Partial<NpAgentApprovalRevocationCanonicalV1> = {},
): NpAgentApprovalRevocationCanonicalV1 {
  return {
    schemaVersion: "np.agent-approval-revocation.v1",
    siteId: "docs-site",
    approvalId,
    approvalGeneration: 3,
    statementHash,
    decisionHash,
    revocationKind: "human",
    revokerFingerprint: "sha256:revoker-v1",
    revocationCode: "OPERATOR_REVOKED",
    revocationReason: "Target is no longer intended",
    revokedAt: "2026-08-23T00:20:00.000Z",
    ...overrides,
  };
}

async function bindings(): Promise<{
  statementBinding: NpAgentApprovalStatementBindingV1;
  decisionBinding: NpAgentApprovalDecisionBindingV1;
}> {
  const body = statement();
  const statementHash = await npDigestAgentApprovalStatementCanonical(body);
  const statementBinding = { statement: body, statementHash, approvalGeneration: 3 };
  const decisionBody = decision(statementHash);
  const decisionHash = await npDigestAgentApprovalDecisionCanonical(decisionBody, statementBinding);
  return {
    statementBinding,
    decisionBinding: { decision: decisionBody, decisionHash },
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code, path })]));
}

describe("Agent approval canonical contracts", () => {
  it("publishes all exact top-level, excluded, branch, and discriminator inventories", () => {
    expect(npAgentApprovalRisks).toEqual(["reversible", "sensitive", "destructive"]);
    expect(npAgentApprovalDecisions).toEqual(["approve", "reject"]);
    expect(npAgentApprovalRevocationKinds).toEqual([
      "human",
      "authority_loss",
      "site_deleting",
      "integrity_key_retired",
      "target_invalidated",
    ]);
    expect(npAgentApprovalStatementCanonicalIncludedKeysV1).toEqual([
      "version",
      "siteId",
      "approvalId",
      "requester",
      "target",
      "capabilityId",
      "capabilityContractVersion",
      "capabilityFingerprint",
      "requiredScopes",
      "requiredHumanCapabilities",
      "requiredHumanPredicates",
      "policyHashes",
      "requiresLivePreview",
      "previewId",
      "previewDigest",
      "risk",
      "reauthentication",
      "createdAt",
      "expiresAt",
    ]);
    expect(npAgentApprovalDecisionCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "approvalId",
      "approvalGeneration",
      "statementHash",
      "decision",
      "deciderFingerprint",
      "currentHumanCapabilities",
      "reason",
      "reauthentication",
      "decidedAt",
    ]);
    expect(npAgentApprovalRevocationCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "siteId",
      "approvalId",
      "approvalGeneration",
      "statementHash",
      "decisionHash",
      "revocationKind",
      "revokerFingerprint",
      "revocationCode",
      "revocationReason",
      "revokedAt",
    ]);
    expect(npAgentApprovalStatementCanonicalExcludedKeysV1).toEqual([
      "requiredScopesDigest",
      "requiredHumanCapabilitiesDigest",
      "requiredHumanPredicatesDigest",
      "argumentsDigest",
      "targetVersionDigest",
      "validationDigest",
      "statementHash",
      "statementMac",
      "integrityKeyId",
      "generation",
      "approvalVersion",
      "challengeGeneration",
      "challengePurpose",
      "challengeHash",
      "challengeHashKeyId",
      "state",
      "decidedAt",
      "consumedAt",
      "revokedAt",
    ]);
    expect(npAgentApprovalDecisionCanonicalExcludedKeysV1).toEqual([
      "currentHumanCapabilitiesDigest",
      "decisionHash",
      "decisionMac",
      "integrityKeyId",
      "approvalVersion",
      "challengeGeneration",
      "challenge",
      "challengeHash",
      "challengeHashKeyId",
      "challengeSessionFingerprint",
      "challengeExpiresAt",
      "challengeConsumedAt",
      "decidedByUserId",
      "state",
    ]);
    expect(npAgentApprovalRevocationCanonicalExcludedKeysV1).toEqual([
      "revocationHash",
      "revocationMac",
      "revocationIntegrityKeyId",
      "revokedByUserId",
      "approvalVersion",
      "challengeGeneration",
      "challenge",
      "challengeHash",
      "challengeHashKeyId",
      "state",
    ]);
    expect(npAgentApprovalStatementCanonicalPrincipalRequesterIncludedKeysV1).toEqual([
      "kind",
      "principalId",
      "fingerprint",
    ]);
    expect(npAgentApprovalStatementCanonicalStaffRequesterIncludedKeysV1).toEqual([
      "kind",
      "userId",
      "fingerprint",
    ]);
    expect(npAgentApprovalStatementCanonicalChangeSetTargetIncludedKeysV1).toEqual([
      "kind",
      "changeSetId",
      "planHash",
    ]);
    expect(npAgentApprovalStatementCanonicalRollbackTargetIncludedKeysV1).toEqual([
      "kind",
      "changeSetId",
      "rollbackPlanId",
      "planHash",
    ]);
    expect(npAgentApprovalStatementCanonicalActionTargetIncludedKeysV1).toEqual([
      "kind",
      "actionId",
      "runId",
      "agentId",
      "proposalHash",
    ]);
    expect(npAgentApprovalStatementCanonicalNoneReauthenticationIncludedKeysV1).toEqual(["mode"]);
    expect(npAgentApprovalStatementCanonicalRecentReauthenticationIncludedKeysV1).toEqual([
      "mode",
      "maxAgeSeconds",
      "assurance",
    ]);
    expect(npAgentApprovalDecisionCanonicalNoneReauthenticationIncludedKeysV1).toEqual(["mode"]);
    expect(npAgentApprovalDecisionCanonicalRecentReauthenticationIncludedKeysV1).toEqual([
      "mode",
      "assurance",
      "maxAgeSeconds",
      "reauthenticatedAt",
      "sessionFactFingerprint",
    ]);
    expect(npAgentApprovalCanonicalDiscriminatorCasesV1).toEqual([
      {
        caseId: "np.agent-approval-statement.v1.requester.principal",
        concreteDiscriminatorPath: "/requester/kind",
        acceptedValue: "principal",
      },
      {
        caseId: "np.agent-approval-statement.v1.requester.staff",
        concreteDiscriminatorPath: "/requester/kind",
        acceptedValue: "staff",
      },
      {
        caseId: "np.agent-approval-statement.v1.target.changeset",
        concreteDiscriminatorPath: "/target/kind",
        acceptedValue: "changeset",
      },
      {
        caseId: "np.agent-approval-statement.v1.target.changeset_rollback",
        concreteDiscriminatorPath: "/target/kind",
        acceptedValue: "changeset_rollback",
      },
      {
        caseId: "np.agent-approval-statement.v1.target.action",
        concreteDiscriminatorPath: "/target/kind",
        acceptedValue: "action",
      },
      {
        caseId: "np.agent-approval-statement.v1.reauthentication.none",
        concreteDiscriminatorPath: "/reauthentication/mode",
        acceptedValue: "none",
      },
      {
        caseId: "np.agent-approval-statement.v1.reauthentication.recent",
        concreteDiscriminatorPath: "/reauthentication/mode",
        acceptedValue: "recent",
      },
    ]);
  });

  it("accepts every statement branch and rejects branch substitution or unknown fields", () => {
    expect(npRequireAgentApprovalStatementCanonical(statement())).toEqual(statement());
    expect(
      npRequireAgentApprovalStatementCanonical(
        statement({
          requester: { kind: "staff", userId: null, fingerprint: "sha256:deleted-staff-v1" },
          target: {
            kind: "changeset_rollback",
            changeSetId,
            rollbackPlanId,
            planHash: digestB,
          },
        }),
      ),
    ).toMatchObject({ requester: { kind: "staff", userId: null } });
    expect(
      npRequireAgentApprovalStatementCanonical(
        statement({
          target: { kind: "action", actionId, runId, agentId, proposalHash: digestC },
          requiresLivePreview: false,
          previewId: null,
          previewDigest: null,
          risk: "reversible",
          reauthentication: { mode: "none" },
        }),
      ),
    ).toMatchObject({ target: { kind: "action", runId, agentId } });
    expect(
      npRequireAgentApprovalStatementCanonical(
        statement({
          requester: { kind: "staff", userId, fingerprint: "sha256:staff-v1" },
          target: { kind: "action", actionId, runId: null, agentId, proposalHash: digestC },
        }),
      ),
    ).toMatchObject({ requester: { kind: "staff", userId }, target: { runId: null, agentId } });
    expect(
      npRequireAgentApprovalStatementCanonical(
        statement({
          target: { kind: "action", actionId, runId, agentId: null, proposalHash: digestC },
        }),
      ),
    ).toMatchObject({ target: { runId, agentId: null } });

    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical({
        ...statement(),
        requester: { kind: "principal", principalId, fingerprint: "actor", userId },
      }),
      "unknown-field",
      "agent.canonical.approvalStatement.requester.userId",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical({ ...statement(), statementHash: digestA }),
      "unknown-field",
      "agent.canonical.approvalStatement.statementHash",
    );
    expectIssue(
      npAnalyzeAgentApprovalDecisionCanonical({ ...decision(digestA), decisionHash: digestB }),
      "unknown-field",
      "agent.canonical.approvalDecision.decisionHash",
    );
    expectIssue(
      npAnalyzeAgentApprovalRevocationCanonical({
        ...revocation(digestA, null),
        revocationMac: "forbidden",
      }),
      "unknown-field",
      "agent.canonical.approvalRevocation.revocationMac",
    );
  });

  it("enforces statement set ordering, preview equivalence, risk floor, times, and byte ceiling", () => {
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({ requiredScopes: ["content:publish", "changeset:apply"] }),
      ),
      "order",
      "agent.canonical.approvalStatement.requiredScopes[1]",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({ requiredHumanCapabilities: ["admin.manage", "admin.manage"] }),
      ),
      "duplicate",
      "agent.canonical.approvalStatement.requiredHumanCapabilities[1]",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(statement({ policyHashes: [digestB, digestA] })),
      "order",
      "agent.canonical.approvalStatement.policyHashes[1]",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({ requiresLivePreview: true, previewDigest: null }),
      ),
      "invalid-field",
      "agent.canonical.approvalStatement.requiresLivePreview",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({ risk: "destructive", reauthentication: { mode: "none" } }),
      ),
      "invalid-field",
      "agent.canonical.approvalStatement.reauthentication.mode",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({
          reauthentication: { mode: "recent", assurance: "staff-primary", maxAgeSeconds: 301 },
        }),
      ),
      "limit",
      "agent.canonical.approvalStatement.reauthentication.maxAgeSeconds",
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(
        statement({ expiresAt: "2026-08-23T00:00:00.000Z" }),
      ),
      "invalid-field",
      "agent.canonical.approvalStatement.expiresAt",
    );

    const hashes = Array.from(
      { length: 5_000 },
      (_, index) => `cj1:sha256:${index.toString().padStart(6, "0")}${"A".repeat(37)}`,
    );
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(statement({ policyHashes: hashes })),
      "limit",
      "agent.canonical.body",
    );
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-approval-statement.v1"]).toBe(256 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-approval-decision.v1"]).toBe(64 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-approval-revocation.v1"]).toBe(64 * 1024);
  });

  it("validates decisions context-free and against the exact statement binding", async () => {
    const { statementBinding } = await bindings();
    const body = decision(statementBinding.statementHash);
    expect(npRequireAgentApprovalDecisionCanonical(body)).toEqual(body);
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(body, statementBinding),
    ).resolves.toEqual(body);

    expectIssue(
      npAnalyzeAgentApprovalDecisionCanonical(
        decision(statementBinding.statementHash, {
          currentHumanCapabilities: ["site.access", "admin.manage"],
        }),
      ),
      "order",
      "agent.canonical.approvalDecision.currentHumanCapabilities[1]",
    );
    expectIssue(
      npAnalyzeAgentApprovalDecisionCanonical(
        decision(statementBinding.statementHash, {
          decision: "reject",
          reauthentication: {
            mode: "recent",
            assurance: "staff-primary",
            maxAgeSeconds: 60,
            reauthenticatedAt: "2026-08-23T00:09:30.000Z",
            sessionFactFingerprint: digestC,
          },
        }),
      ),
      "invalid-field",
      "agent.canonical.approvalDecision.reauthentication.mode",
    );
    expectIssue(
      npAnalyzeAgentApprovalDecisionCanonical(
        decision(statementBinding.statementHash, {
          reauthentication: {
            mode: "recent",
            assurance: "staff-primary",
            maxAgeSeconds: 60,
            reauthenticatedAt: "2026-08-23T00:08:59.999Z",
            sessionFactFingerprint: digestC,
          },
        }),
      ),
      "invalid-field",
      "agent.canonical.approvalDecision.reauthentication.reauthenticatedAt",
    );
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(
        decision(statementBinding.statementHash, {
          currentHumanCapabilities: ["admin.manage", "site.access"],
        }),
        statementBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(
        decision(statementBinding.statementHash, {
          reauthentication: {
            mode: "recent",
            assurance: "staff-primary",
            maxAgeSeconds: 30,
            reauthenticatedAt: "2026-08-23T00:09:30.000Z",
            sessionFactFingerprint: digestC,
          },
        }),
        statementBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(body, {
        ...statementBinding,
        statementHash: digestA,
      }),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(body, {
        ...statementBinding,
        statement: statement({ expiresAt: "2026-08-23T00:59:59.999Z" }),
      }),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(
        decision(statementBinding.statementHash, { approvalGeneration: 4 }),
        statementBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(
        decision(statementBinding.statementHash, {
          decidedAt: statementBinding.statement.expiresAt,
        }),
        statementBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");

    const rejectBody = decision(statementBinding.statementHash, {
      decision: "reject",
      currentHumanCapabilities: [],
      reauthentication: { mode: "none" },
    });
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(rejectBody, statementBinding),
    ).resolves.toEqual(rejectBody);

    const noReauthenticationStatement = statement({
      risk: "reversible",
      reauthentication: { mode: "none" },
    });
    const noReauthenticationBinding: NpAgentApprovalStatementBindingV1 = {
      statement: noReauthenticationStatement,
      statementHash: await npDigestAgentApprovalStatementCanonical(noReauthenticationStatement),
      approvalGeneration: 3,
    };
    const noReauthenticationDecision = decision(noReauthenticationBinding.statementHash, {
      reauthentication: { mode: "none" },
    });
    await expect(
      npRequireAgentApprovalDecisionCanonicalForStatement(
        noReauthenticationDecision,
        noReauthenticationBinding,
      ),
    ).resolves.toEqual(noReauthenticationDecision);
  });

  it("validates revocations against the exact statement and optional prior decision", async () => {
    const { statementBinding, decisionBinding } = await bindings();
    const withDecision = revocation(statementBinding.statementHash, decisionBinding.decisionHash);
    expect(npRequireAgentApprovalRevocationCanonical(withDecision)).toEqual(withDecision);
    await expect(
      npRequireAgentApprovalRevocationCanonicalForBindings(
        withDecision,
        statementBinding,
        decisionBinding,
      ),
    ).resolves.toEqual(withDecision);

    const withoutDecision = revocation(statementBinding.statementHash, null, {
      revocationKind: "target_invalidated",
      revocationCode: "PREVIEW_REQUIRED",
      revocationReason: null,
    });
    await expect(
      npRequireAgentApprovalRevocationCanonicalForBindings(withoutDecision, statementBinding, null),
    ).resolves.toEqual(withoutDecision);
    for (const revocationKind of npAgentApprovalRevocationKinds.filter(
      (kind) => kind !== "human",
    )) {
      const automatic = revocation(statementBinding.statementHash, null, {
        revocationKind,
        revocationCode: "AUTOMATIC_REVOCATION",
        revocationReason: null,
      });
      await expect(
        npRequireAgentApprovalRevocationCanonicalForBindings(automatic, statementBinding, null),
      ).resolves.toEqual(automatic);
    }

    expectIssue(
      npAnalyzeAgentApprovalRevocationCanonical({
        ...withoutDecision,
        revocationReason: "automatic prose is forbidden",
      }),
      "invalid-field",
      "agent.canonical.approvalRevocation.revocationReason",
    );
    expectIssue(
      npAnalyzeAgentApprovalRevocationCanonical({
        ...withoutDecision,
        revocationCode: "preview-required",
      }),
      "invalid-field",
      "agent.canonical.approvalRevocation.revocationCode",
    );
    await expect(
      npRequireAgentApprovalRevocationCanonicalForBindings(
        { ...withDecision, decisionHash: null },
        statementBinding,
        decisionBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalRevocationCanonicalForBindings(
        { ...withDecision, revokedAt: "2026-08-23T00:09:59.999Z" },
        statementBinding,
        decisionBinding,
      ),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npRequireAgentApprovalRevocationCanonicalForBindings(withDecision, statementBinding, {
        ...decisionBinding,
        decision: { ...decisionBinding.decision, reason: "tampered after hashing" },
      }),
    ).rejects.toThrow("Invalid Agent canonical body");
  });

  it("builds independent domain-separated bytes, SHA digests, and owner-bound HMACs", async () => {
    const { statementBinding, decisionBinding } = await bindings();
    const statementBody = statementBinding.statement;
    const decisionBody = decisionBinding.decision;
    const revocationBody = revocation(statementBinding.statementHash, decisionBinding.decisionHash);
    const statementBytes = npBuildAgentApprovalStatementCanonicalBytes(statementBody);
    const decisionBytes = await npBuildAgentApprovalDecisionCanonicalBytes(
      decisionBody,
      statementBinding,
    );
    const revocationBytes = await npBuildAgentApprovalRevocationCanonicalBytes(
      revocationBody,
      statementBinding,
      decisionBinding,
    );
    expect(decoder.decode(statementBytes.domainSeparatedUtf8)).toBe(
      `np.agent-canonical-json.v1\0np.agent-approval-statement.v1\0${decoder.decode(statementBytes.canonicalJsonUtf8)}`,
    );
    expect(decoder.decode(decisionBytes.domainSeparatedUtf8)).toContain(
      "np.agent-canonical-json.v1\0np.agent-approval-decision.v1\0",
    );
    expect(decoder.decode(revocationBytes.domainSeparatedUtf8)).toContain(
      "np.agent-canonical-json.v1\0np.agent-approval-revocation.v1\0",
    );

    const statementHash = await npDigestAgentApprovalStatementCanonical(statementBody);
    const decisionHash = await npDigestAgentApprovalDecisionCanonical(
      decisionBody,
      statementBinding,
    );
    const revocationHash = await npDigestAgentApprovalRevocationCanonical(
      revocationBody,
      statementBinding,
      decisionBinding,
    );
    expect([statementHash, decisionHash, revocationHash]).toEqual([
      statementGoldenHash,
      decisionGoldenHash,
      revocationGoldenHash,
    ]);
    expect(new Set([statementHash, decisionHash, revocationHash]).size).toBe(3);

    const statementMac = await npMacAgentApprovalStatementCanonical(statementBody, key);
    const decisionMac = await npMacAgentApprovalDecisionCanonical(
      decisionBody,
      statementBinding,
      key,
    );
    const revocationMac = await npMacAgentApprovalRevocationCanonical(
      revocationBody,
      statementBinding,
      decisionBinding,
      key,
    );
    expect([statementMac, decisionMac, revocationMac]).toEqual([
      statementGoldenMac,
      decisionGoldenMac,
      revocationGoldenMac,
    ]);
    expect(new Set([statementMac, decisionMac, revocationMac]).size).toBe(3);
    await expect(
      npVerifyAgentApprovalStatementCanonicalMac(statementBody, statementMac, key),
    ).resolves.toBe(true);
    await expect(
      npVerifyAgentApprovalDecisionCanonicalMac(decisionBody, statementBinding, decisionMac, key),
    ).resolves.toBe(true);
    await expect(
      npVerifyAgentApprovalRevocationCanonicalMac(
        revocationBody,
        statementBinding,
        decisionBinding,
        revocationMac,
        key,
      ),
    ).resolves.toBe(true);
  });

  it("fails closed for changed bytes, wrong key ids or material, and malformed keys", async () => {
    const { statementBinding, decisionBinding } = await bindings();
    const statementBody = statementBinding.statement;
    const statementMac = await npMacAgentApprovalStatementCanonical(statementBody, key);
    const changed = statement({ expiresAt: "2026-08-23T00:59:59.999Z" });
    await expect(
      npVerifyAgentApprovalStatementCanonicalMac(changed, statementMac, key),
    ).resolves.toBe(false);
    await expect(
      npVerifyAgentApprovalStatementCanonicalMac(statementBody, statementMac, {
        ...key,
        id: "other-key",
      }),
    ).resolves.toBe(false);
    await expect(
      npVerifyAgentApprovalStatementCanonicalMac(statementBody, statementMac, {
        ...key,
        bytes: new Uint8Array(32).fill(9),
      }),
    ).resolves.toBe(false);
    await expect(
      npMacAgentApprovalStatementCanonical(statementBody, { ...key, owner: "wrong-owner" }),
    ).rejects.toThrow("Invalid Agent canonical body");
    await expect(
      npMacAgentApprovalStatementCanonical(statementBody, { ...key, bytes: new Uint8Array() }),
    ).rejects.toThrow("Invalid Agent canonical body");

    const revocationBody = revocation(statementBinding.statementHash, decisionBinding.decisionHash);
    const revocationMac = await npMacAgentApprovalRevocationCanonical(
      revocationBody,
      statementBinding,
      decisionBinding,
      key,
    );
    await expect(
      npVerifyAgentApprovalRevocationCanonicalMac(
        { ...revocationBody, revocationReason: "changed" },
        statementBinding,
        decisionBinding,
        revocationMac,
        key,
      ),
    ).resolves.toBe(false);
  });

  it("rejects hostile values and explicit text limits without invoking accessors", () => {
    const accessor = statement() as NpAgentApprovalStatementCanonicalV1 & {
      statementHash?: string;
    };
    Object.defineProperty(accessor, "statementHash", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expectIssue(
      npAnalyzeAgentApprovalStatementCanonical(accessor),
      "shape",
      "agent.canonical.approvalStatement.statementHash",
    );
    expectIssue(
      npAnalyzeAgentApprovalDecisionCanonical(decision(digestA, { reason: "x".repeat(4_001) })),
      "invalid-field",
      "agent.canonical.approvalDecision.reason",
    );
    expectIssue(
      npAnalyzeAgentApprovalRevocationCanonical(
        revocation(digestA, null, { revocationReason: "x".repeat(4_001) }),
      ),
      "invalid-field",
      "agent.canonical.approvalRevocation.revocationReason",
    );
  });
});
