import { describe, expect, it } from "vitest";

import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentCanonicalPurposeAnalyzersV1,
  npAgentCanonicalPurposeExcludedKeysV1,
  npAgentCanonicalPurposeIncludedKeysV1,
  npAgentCanonicalPurposes,
  npAnalyzeAgentCanonicalBodyV1,
  npBuildAgentCanonicalBytesV1,
  npDigestAgentActionCanonical,
  npDigestAgentCanonicalBodyV1,
  type NpAgentActionCanonicalV1,
  type NpAgentCanonicalPurposeV1,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const actionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";

function action(): NpAgentActionCanonicalV1 {
  return {
    schemaVersion: "np.agent-action.v1",
    siteId: "docs-site",
    actionId,
    invocationFingerprint: digestA,
    runFingerprint: null,
    sequence: 1,
    capabilityId: "site.inspect",
    capabilityContractVersion: 1,
    capabilityFingerprint: digestA,
    effectProfile: { id: "read", contractVersion: 1 },
    risk: "read",
    requiredScopes: ["site:read"],
    targetRefs: [],
    targetVersionFacts: [],
    input: {},
  };
}

describe("Agent canonical purpose registry", () => {
  it("closes analyzer, included, excluded, and size registries over the same 32 purposes", () => {
    const expected = [...npAgentCanonicalPurposes];
    expect(expected).toHaveLength(32);
    expect(expected).toEqual([...expected].sort());
    expect(Object.keys(npAgentCanonicalPurposeAnalyzersV1)).toEqual(expected);
    expect(Object.keys(npAgentCanonicalPurposeIncludedKeysV1)).toEqual(expected);
    expect(Object.keys(npAgentCanonicalPurposeExcludedKeysV1)).toEqual(expected);
    expect(Object.keys(npAgentCanonicalBodyMaxBytesV1)).toEqual(expected);
  });

  it("keeps every field fixture unique and included/excluded sets disjoint", () => {
    for (const purpose of npAgentCanonicalPurposes) {
      const included = npAgentCanonicalPurposeIncludedKeysV1[purpose];
      const excluded = npAgentCanonicalPurposeExcludedKeysV1[purpose];
      expect(new Set(included).size, `${purpose} included`).toBe(included.length);
      expect(new Set(excluded).size, `${purpose} excluded`).toBe(excluded.length);
      expect(
        included.filter((key) => new Set<string>(excluded).has(key)),
        purpose,
      ).toEqual([]);
    }
  });

  it("dispatches typed analysis, bytes, and SHA helpers to the exact purpose analyzer", async () => {
    const body = action();
    expect(npAnalyzeAgentCanonicalBodyV1("np.agent-action.v1", body)).toEqual({
      ok: true,
      value: body,
    });
    expect(npBuildAgentCanonicalBytesV1("np.agent-action.v1", body).body).toEqual(body);
    expect(await npDigestAgentCanonicalBodyV1("np.agent-action.v1", body)).toBe(
      await npDigestAgentActionCanonical(body),
    );
  });

  it("fails closed for a runtime purpose outside the registry", () => {
    const result = npAnalyzeAgentCanonicalBodyV1(
      "np.agent-unknown.v1" as NpAgentCanonicalPurposeV1,
      {},
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "invalid-field",
          path: "agent.canonical.purpose",
        }),
      ],
    });

    const inheritedName = npAnalyzeAgentCanonicalBodyV1(
      "toString" as NpAgentCanonicalPurposeV1,
      {},
    );
    expect(inheritedName).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "invalid-field",
          path: "agent.canonical.purpose",
        }),
      ],
    });
  });
});
