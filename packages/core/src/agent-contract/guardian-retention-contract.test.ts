import { describe, expect, it } from "vitest";
import {
  npRequireAgentGuardianSourceClosureV1,
  npAgentGuardianSourceNamespaceDigestV1,
  npAgentGuardianRetentionFamiliesV1,
} from "./guardian-retention-contract.js";
const sha = `cj1:sha256:${"A".repeat(43)}`;
describe("Guardian historical delivery closure", () => {
  it("keeps source namespaces stable without rotating key or source payload inputs", async () => {
    const values = await Promise.all(
      npAgentGuardianRetentionFamiliesV1.map(npAgentGuardianSourceNamespaceDigestV1),
    );
    expect(new Set(values).size).toBe(npAgentGuardianRetentionFamiliesV1.length);
    const golden = {
      requests: "cj1:sha256:lNdauXMzuo_cG2d0iJvggiBInqgVejyVW4Bz3mo1ef8",
      "security-transitions": "cj1:sha256:Z23G1sY_ceh0jpB5-jFAexyyaa7YxA35VEq8fahwAS4",
      content: "cj1:sha256:mTVzJZ_5dbAZGaw0ZzI4HRu2g3m_pPoRYVYxJuUhYPw",
      sentry: "cj1:sha256:FFMqQuxoaBr6ID7IzKNEK4CWyPp4Xkxj5aI9YIGF8VY",
      runtime: "cj1:sha256:wKohgBvy6r5R2Pz2OHaZaNY7Iw3NeqXd3XzmkWl55M0",
      http: "cj1:sha256:KGhKE-d6LgVAZP4SMU2eYHY57fTObi1DraJruWiv_go",
    };
    expect(values).toEqual(npAgentGuardianRetentionFamiliesV1.map((family) => golden[family]));
    expect(await npAgentGuardianSourceNamespaceDigestV1("content")).toBe(values[2]);
  });
  it("accepts only bounded window-aligned, site-bound closure metadata", () => {
    const value = {
      schemaVersion: "np.agent-guardian-source-closure.v1",
      siteId: "default",
      family: "content",
      namespaceDigest: sha,
      closedBefore: "2026-10-01T00:00:00.000Z",
      closedAt: "2026-10-18T00:00:00.000Z",
      revision: 1,
      retentionPolicyDigest: sha,
    };
    expect(npRequireAgentGuardianSourceClosureV1(value)).toEqual(value);
    for (const change of [
      { closedBefore: "2026-10-01T00:00:01.000Z" },
      { closedAt: "2026-09-01T00:00:00.000Z" },
      { revision: 0 },
      { complete: true },
      { family: "arbitrary" },
    ])
      expect(() => npRequireAgentGuardianSourceClosureV1({ ...value, ...change })).toThrow();
  });
});
