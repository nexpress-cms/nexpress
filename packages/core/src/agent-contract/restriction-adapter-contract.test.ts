import { describe, expect, it } from "vitest";
import {
  npAgentRestrictionSubjectKeyV1,
  npRequireAgentRestrictionCheckV1,
  npRequireAgentRestrictionDecisionV1,
  npRequireAgentRestrictionMutationResultV1,
  npRequireAgentRestrictionVerifyResultV1,
} from "./restriction-adapter-contract.js";

const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1",
  digest = `cj1:sha256:${"A".repeat(43)}`;
const subject = {
  kind: "opaque_actor_bucket" as const,
  purpose: "network-address" as const,
  projectionVersion: 1,
  projectionFingerprint: "projection-v1",
  keyId: "key-v1",
  bucket: "A".repeat(43),
};
const request = () => ({
  schemaVersion: "np.agent-restriction-check.v1",
  siteId: "default",
  subjects: [subject],
  actionScope: "auth.staff",
  observedAt: "2026-10-18T00:00:00.000Z",
});
describe("Restriction adapter wire boundaries", () => {
  it("accepts only one principal or sorted unique same-purpose opaque candidates, capped at eight", () => {
    expect(npRequireAgentRestrictionCheckV1(request()).subjects).toEqual([subject]);
    for (const subjects of [
      [],
      [subject, subject],
      [subject, { ...subject, purpose: "login-identifier" }],
      [subject, { kind: "authenticated_principal", principalKind: "staff", principalId: id }],
      Array.from({ length: 9 }, (_, i) => ({ ...subject, keyId: `key-${i}` })),
    ])
      expect(() => npRequireAgentRestrictionCheckV1({ ...request(), subjects })).toThrow();
    expect(() =>
      npRequireAgentRestrictionCheckV1({ ...request(), rawAddress: "private" }),
    ).toThrow();
  });
  it("requires deny to bind a supplied canonical subject and future expiry, and allow to disclose no target", () => {
    const check = npRequireAgentRestrictionCheckV1(request());
    const deny = {
      schemaVersion: "np.agent-restriction-decision.v1",
      decision: "deny",
      restrictionId: id,
      matchedSubjectKey: npAgentRestrictionSubjectKeyV1(subject),
      expiresAt: "2026-10-18T00:01:00.000Z",
      resultDigest: digest,
    };
    expect(npRequireAgentRestrictionDecisionV1(deny, check).decision).toBe("deny");
    for (const delta of [
      { matchedSubjectKey: "unrelated" },
      { expiresAt: check.observedAt },
      { decision: "allow" },
      { restrictionId: null },
    ])
      expect(() => npRequireAgentRestrictionDecisionV1({ ...deny, ...delta }, check)).toThrow();
  });
  it("does not label missing expiry/ref as installation or retain expiry on a removal receipt", () => {
    const receipt = {
      schemaVersion: "np.agent-restriction-mutation-result.v1",
      status: "installed",
      restrictionId: id,
      enforcementRef: `postgres:${id}`,
      effectiveExpiresAt: "2026-10-18T00:01:00.000Z",
      resultDigest: digest,
    };
    expect(npRequireAgentRestrictionMutationResultV1(receipt).status).toBe("installed");
    for (const delta of [
      { effectiveExpiresAt: null },
      { enforcementRef: null },
      { status: "removed" },
      { status: "unknown" },
      { rawError: "private" },
    ])
      expect(() => npRequireAgentRestrictionMutationResultV1({ ...receipt, ...delta })).toThrow();
    expect(
      npRequireAgentRestrictionMutationResultV1({
        ...receipt,
        status: "already_absent",
        effectiveExpiresAt: null,
      }).status,
    ).toBe("already_absent");
  });
  it("keeps unknown verification separate from installed/expired evidence", () => {
    const receipt = {
      schemaVersion: "np.agent-restriction-verify-result.v1",
      state: "unknown",
      restrictionId: id,
      effectiveExpiresAt: null,
      resultDigest: digest,
    };
    expect(npRequireAgentRestrictionVerifyResultV1(receipt).state).toBe("unknown");
    expect(() =>
      npRequireAgentRestrictionVerifyResultV1({ ...receipt, state: "installed" }),
    ).toThrow();
    expect(() =>
      npRequireAgentRestrictionVerifyResultV1({
        ...receipt,
        effectiveExpiresAt: "2026-10-18T00:01:00.000Z",
      }),
    ).toThrow();
  });
});
