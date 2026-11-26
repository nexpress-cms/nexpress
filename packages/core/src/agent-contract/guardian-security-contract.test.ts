import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianSecurityEvidenceV1,
  npRequireAgentSecurityTransitionPayloadV1,
} from "./guardian-security-contract.js";

const id = "73111111-1111-4111-8111-111111111111";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const impact = () => ({ scope: "site", affectedSiteCount: 1, siteCatalogDigest: digest });
const authority = () => ({
  kind: "security.authority.changed",
  transitionId: id,
  sourceReceiptId: id,
  impact: impact(),
  transition: { kind: "site-role", userId: id, previousRole: null, currentRole: "admin" },
});
const state = (rowVersion: number) => ({
  version: 1,
  rowVersion,
  contentHash: digest,
  status: "draft",
});

describe("committed Guardian security transition contracts", () => {
  it("preserves absence, registered roles and exact deployment privilege changes", () => {
    expect(npRequireAgentSecurityTransitionPayloadV1(authority())).toEqual(authority());
    const removed = {
      ...authority(),
      transition: {
        kind: "site-role",
        userId: id,
        previousRole: "admin",
        currentRole: null,
      },
    };
    expect(npRequireAgentSecurityTransitionPayloadV1(removed)).toEqual(removed);
    const global = {
      ...authority(),
      impact: { ...impact(), scope: "deployment", affectedSiteCount: 3 },
      transition: { kind: "super-admin", userId: id, previous: false, current: true },
    };
    expect(npRequireAgentSecurityTransitionPayloadV1(global)).toEqual(global);
    for (const bad of [
      { ...global, impact: impact() },
      { ...authority(), impact: global.impact },
      { ...authority(), transition: { ...authority().transition, previousRole: "none" } },
      { ...authority(), transition: { ...authority().transition, previousRole: "admin" } },
      { ...global, transition: { ...global.transition, current: false } },
      { ...global, transition: { ...global.transition, current: "true" } },
      { ...authority(), impact: { ...impact(), affectedSiteCount: 2 } },
      { ...authority(), sourceReceiptId: "unknown" },
      { ...authority(), password: "not-an-allowed-fact" },
    ])
      expect(() => npRequireAgentSecurityTransitionPayloadV1(bad)).toThrow();
  });

  it("binds policy state to exact version/hash and rejects unchanged row versions or extra text", () => {
    const policy = {
      ...authority(),
      kind: "agent.policy.changed",
      transition: {
        kind: "agent-policy",
        policyId: id,
        agentId: null,
        previous: state(1),
        current: { ...state(2), status: "active" },
      },
    };
    expect(npRequireAgentSecurityTransitionPayloadV1(policy)).toEqual(policy);
    for (const bad of [
      { ...policy, transition: { ...policy.transition, current: state(1) } },
      { ...policy, transition: { ...policy.transition, current: { ...state(2), definition: {} } } },
      { ...policy, transition: { ...policy.transition, policyId: "foreign" } },
      { ...policy, impact: { ...impact(), scope: "deployment" } },
    ])
      expect(() => npRequireAgentSecurityTransitionPayloadV1(bad)).toThrow();
  });

  it("projects only exact immutable proof metadata and rejects forged execution or risk fields", () => {
    const proof = {
      schemaVersion: "np.agent-guardian-security-evidence.v1",
      signalId: id,
      detectorId: "guardian.authority-escalated",
      detectorVersion: 1,
      basis: "committed-transition",
      targetKind: "site-role",
      observedAt: "2026-10-18T07:00:00.000Z",
      sourceDigest: digest,
      impact: impact(),
    };
    expect(npRequireAgentGuardianSecurityEvidenceV1(proof)).toEqual(proof);
    for (const bad of [
      { ...proof, targetKind: "super-admin" },
      { ...proof, detectorId: "guardian.policy-activated" },
      { ...proof, detectorVersion: 2 },
      { ...proof, approvalId: id },
      { ...proof, userId: id },
      { ...proof, severity: "critical" },
      { ...proof, sourceDigest: "claimed" },
    ])
      expect(() => npRequireAgentGuardianSecurityEvidenceV1(bad)).toThrow();
  });
});
