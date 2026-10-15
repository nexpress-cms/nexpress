import { describe, expect, it, vi } from "vitest";
import type { NpAgentAutomaticQuarantineDeploymentV1 } from "../agent-contract/automatic-quarantine-contract.js";
import {
  createAgentAutomaticQuarantineAuthorityV1,
  npIsAgentAutomaticQuarantineAuthorityV1,
} from "./automatic-quarantine-service.js";
function deployment(): NpAgentAutomaticQuarantineDeploymentV1 {
  return {
    schemaVersion: "np.agent-automatic-quarantine-deployment.v1",
    policyId: "reviewed-spam",
    policyVersion: 1,
    siteId: "default",
    locale: "ko",
    principalIds: ["10000000-0000-4000-8000-000000000001"],
    collectionSlugs: ["posts"],
    rule: {
      kind: "reviewed-blocked-domain.v1",
      domainHash: "a".repeat(64),
      minimumItems: 5,
      minimumIndependentAccounts: 3,
      maximumEvidenceAgeSeconds: 3600,
    },
    limits: { containmentSeconds: 60, actionsPerHour: 10, activeContainments: 10 },
    qualification: {
      source: "production-human-review",
      policyVersion: 1,
      locale: "ko",
      reviewArtifactDigest: `cj1:sha256:${"A".repeat(43)}`,
      reviewedPredictedPositives: 1000,
      reviewedTruePositives: 1000,
      reviewedLegitimateHardNegatives: 1000,
      shadowArtifactDigest: `cj1:sha256:${"B".repeat(43)}`,
      shadowStartedAt: "2026-09-01T00:00:00.000Z",
      shadowEndedAt: "2026-09-15T00:00:00.000Z",
      compensationTestArtifactDigest: `cj1:sha256:${"C".repeat(43)}`,
    },
    issuedAt: "2026-09-16T00:00:00.000Z",
    expiresAt: "2026-09-20T00:00:00.000Z",
  };
}
const install = (value: NpAgentAutomaticQuarantineDeploymentV1) =>
  createAgentAutomaticQuarantineAuthorityV1({
    deployment: value,
    verifyDeployment: () => Promise.resolve(false),
    resolveLocale: () => Promise.resolve(null),
  });
describe("host-only automatic quarantine installation", () => {
  it("snapshots/freeze-binds a branded exact deployment and performs no work at installation", () => {
    const value = deployment();
    const verify = vi.fn(() => Promise.resolve(true));
    const service = createAgentAutomaticQuarantineAuthorityV1({
      deployment: value,
      verifyDeployment: verify,
      resolveLocale: () => Promise.resolve("ko"),
    });
    const digest = service.deploymentDigest;
    value.rule.domainHash = "b".repeat(64);
    expect(service.deployment.rule.domainHash).toBe("a".repeat(64));
    expect(service.deploymentDigest).toBe(digest);
    expect(Object.isFrozen(service.deployment.rule)).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(npIsAgentAutomaticQuarantineAuthorityV1(service)).toBe(true);
    expect(npIsAgentAutomaticQuarantineAuthorityV1({ ...service })).toBe(false);
  });
  it.each(["root", "rule", "limits", "qualification"] as const)(
    "rejects unknown %s fields instead of retaining raw metadata",
    (part) => {
      const d = deployment();
      const value =
        part === "root"
          ? { ...d, rawSecret: "private" }
          : { ...d, [part]: { ...d[part], rawSecret: "private" } };
      expect(() => install(value)).toThrowError(
        expect.objectContaining({ code: "AUTOMATIC_QUARANTINE_BLOCKED" }),
      );
    },
  );
  it.each(["principalIds", "collectionSlugs", "rule", "qualification"] as const)(
    "safe-blocks malformed %s values",
    (field) => {
      const d = deployment();
      Object.defineProperty(d, field, { value: null, enumerable: true });
      expect(() => install(d)).toThrowError(
        expect.objectContaining({ code: "AUTOMATIC_QUARANTINE_BLOCKED" }),
      );
    },
  );
  it("binds policy version, locale and scope to distinct artifact digests", () => {
    const first = install(deployment());
    const values = [deployment(), deployment(), deployment()];
    values[0].policyVersion = 2;
    values[0].qualification.policyVersion = 2;
    values[1].locale = "en";
    values[1].qualification.locale = "en";
    values[2].collectionSlugs = ["discussions"];
    for (const value of values)
      expect(install(value).deploymentDigest).not.toBe(first.deploymentDigest);
  });
  it.each(["principals", "collections", "size", "ttl", "date"] as const)(
    "safe-blocks invalid %s shape or bounds",
    (part) => {
      const d = deployment();
      if (part === "principals") d.principalIds = [];
      if (part === "collections") d.collectionSlugs = ["bad collection"];
      if (part === "size") d.policyId = "x".repeat(40000);
      if (part === "ttl") d.limits.containmentSeconds = 86401;
      if (part === "date") d.expiresAt = "invalid";
      expect(() => install(d)).toThrowError(
        expect.objectContaining({ code: "AUTOMATIC_QUARANTINE_BLOCKED" }),
      );
    },
  );
});
