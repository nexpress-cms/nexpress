import { describe, expect, it, vi } from "vitest";
import {
  npRequireAgentAutomaticGuardianLimitAuthorizationV1,
  npRequireAgentAutomaticGuardianLimitDeploymentV1,
  type NpAgentAutomaticGuardianLimitAuthorizationV1,
  type NpAgentAutomaticGuardianLimitDeploymentV1,
} from "./automatic-guardian-limit-contract.js";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const digest = `cj1:sha256:${"A".repeat(43)}`;
function deployment(): NpAgentAutomaticGuardianLimitDeploymentV1 {
  return {
    schemaVersion: "np.agent-automatic-guardian-limit-deployment.v1",
    policyId: "reviewed-auth-limit",
    policyVersion: 1,
    siteId: "default",
    principalIds: [id(1)],
    rule: {
      kind: "staff-escalated-auth-rule.v1",
      detectorId: "guardian.login-failures",
      detectorVersion: 1,
      minimumSeverity: "high",
      maximumEvidenceAgeSeconds: 600,
      maximumEscalationAgeSeconds: 600,
    },
    actionScopes: ["auth.member", "auth.staff"],
    limits: { restrictionSeconds: 300, actionsPerHour: 5, activeRestrictions: 5 },
    qualification: {
      source: "production-human-review",
      policyVersion: 1,
      reviewArtifactDigest: digest,
      legitimateImpactReviewArtifactDigest: digest,
      shadowArtifactDigest: digest,
      shadowStartedAt: "2026-09-01T00:00:00.000Z",
      shadowEndedAt: "2026-09-15T00:00:00.000Z",
      compensationTestArtifactDigest: digest,
    },
    issuedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-30T00:00:00.000Z",
  };
}
function evidence(): NpAgentAutomaticGuardianLimitAuthorizationV1 {
  return {
    schemaVersion: "np.agent-automatic-guardian-limit-authorization.v1",
    policyId: "reviewed-auth-limit",
    policyVersion: 1,
    deploymentDigest: digest,
    policyDigest: digest,
    siteId: "default",
    principalId: id(1),
    ruleKind: "staff-escalated-auth-rule.v1",
    incidentId: id(2),
    incidentVersion: 2,
    incidentFingerprint: digest,
    incidentUpdatedAt: "2026-10-18T00:02:00.000Z",
    incidentSeverity: "high",
    signalId: id(3),
    detectorId: "guardian.login-failures",
    detectorVersion: 1,
    signalEvidenceDigest: digest,
    sourceEventIds: [10, 11, 12, 13, 14].map(id),
    sourceFactsDigest: digest,
    sourceWindow: { startedAt: "2026-10-18T00:00:00.000Z", endedAt: "2026-10-18T00:01:00.000Z" },
    sourceBaselineSeverity: "medium",
    observedCount: 5,
    countBasis: "at-least",
    staffEscalation: {
      timelineEntryId: id(4),
      transitionVersion: 2,
      fromSeverity: "medium",
      toSeverity: "high",
      createdAt: "2026-10-18T00:02:00.000Z",
      evidenceDigest: digest,
    },
    subject: {
      kind: "opaque_actor_bucket",
      purpose: "network-address",
      projectionVersion: 1,
      projectionFingerprint: digest,
      keyId: "auth-key-v1",
      bucket: "A".repeat(43),
    },
    actionScopes: ["auth.staff"],
    authorizedAt: "2026-10-18T00:03:00.000Z",
    expiresAt: "2026-10-18T00:08:00.000Z",
  };
}
describe("automatic Guardian limit closed artifact and historical proof shapes", () => {
  it("copies a closed artifact while making no production qualification claim", () => {
    const input = deployment(),
      parsed = npRequireAgentAutomaticGuardianLimitDeploymentV1(input);
    expect(parsed).toEqual(input);
    input.actionScopes.length = 0;
    expect(parsed.actionScopes).toEqual(["auth.member", "auth.staff"]);
    expect(parsed).not.toHaveProperty("qualified");
    expect(parsed).not.toHaveProperty("enabled");
  });
  it.each(["root", "rule", "limits", "qualification"] as const)(
    "rejects extra %s authority/prose fields",
    (part) => {
      const d = deployment();
      const bad =
        part === "root"
          ? { ...d, enabled: true }
          : { ...d, [part]: { ...d[part], modelApproval: true } };
      expect(() => npRequireAgentAutomaticGuardianLimitDeploymentV1(bad)).toThrow();
    },
  );
  it("rejects getters, aliases and oversized input without executing accessors", () => {
    const d = deployment(),
      get = vi.fn(() => "secret");
    Object.defineProperty(d, "policyId", { enumerable: true, get });
    expect(() => npRequireAgentAutomaticGuardianLimitDeploymentV1(d)).toThrow();
    expect(get).not.toHaveBeenCalled();
    const value = deployment();
    expect(() =>
      npRequireAgentAutomaticGuardianLimitDeploymentV1({ ...value, policyId: "a".repeat(40000) }),
    ).toThrow();
    expect(() =>
      npRequireAgentAutomaticGuardianLimitDeploymentV1({
        ...value,
        actionScopes: value.principalIds,
      }),
    ).toThrow();
  });
  it.each([
    "ttl",
    "principal-order",
    "scope-order",
    "scope",
    "rule",
    "version",
    "shadow",
    "expiry",
  ])("rejects invalid %s", (part) => {
    const d = deployment();
    if (part === "ttl") d.limits.restrictionSeconds = 901;
    if (part === "principal-order") d.principalIds = [id(2), id(1)];
    if (part === "scope-order") d.actionScopes = ["auth.staff", "auth.member"];
    if (part === "scope")
      Object.defineProperty(d, "actionScopes", { value: ["agent.gateway"], enumerable: true });
    if (part === "rule")
      Object.defineProperty(d.rule, "kind", { value: "model-confidence.v1", enumerable: true });
    if (part === "version") d.qualification.policyVersion = 2;
    if (part === "shadow") d.qualification.shadowEndedAt = d.qualification.shadowStartedAt;
    if (part === "expiry") d.expiresAt = "2026-11-01T00:00:00.000Z";
    expect(() => npRequireAgentAutomaticGuardianLimitDeploymentV1(d)).toThrow();
  });
  it("keeps exact medium lower-bound observations distinct from current staff high escalation", () => {
    const parsed = npRequireAgentAutomaticGuardianLimitAuthorizationV1(evidence());
    expect(parsed).toMatchObject({
      sourceBaselineSeverity: "medium",
      observedCount: 5,
      countBasis: "at-least",
      incidentSeverity: "high",
      staffEscalation: { fromSeverity: "medium", toSeverity: "high" },
    });
  });
  it.each([
    "source-high",
    "count",
    "scope",
    "target",
    "escalation",
    "future",
    "generation",
    "expiry",
    "raw",
  ])("rejects forged or inconsistent proof %s", (part) => {
    const e = evidence();
    if (part === "source-high")
      Object.defineProperty(e, "sourceBaselineSeverity", { value: "high", enumerable: true });
    if (part === "count") e.sourceEventIds.pop();
    if (part === "scope")
      Object.defineProperty(e, "actionScopes", {
        value: ["auth.member", "auth.staff"],
        enumerable: true,
      });
    if (part === "target")
      Object.defineProperty(e, "subject", {
        value: { kind: "authenticated_principal", principalKind: "staff", principalId: id(5) },
        enumerable: true,
      });
    if (part === "escalation") e.staffEscalation.toSeverity = "critical";
    if (part === "future") e.staffEscalation.createdAt = "2026-10-18T00:04:00.000Z";
    if (part === "generation") e.staffEscalation.transitionVersion = 3;
    if (part === "expiry") e.expiresAt = "2026-10-18T00:18:01.000Z";
    const value = part === "raw" ? { ...e, rawNetworkAddress: "192.0.2.1" } : e;
    expect(() => npRequireAgentAutomaticGuardianLimitAuthorizationV1(value)).toThrow();
  });
});
