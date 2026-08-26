import { describe, expect, it, vi } from "vitest";

import {
  npAgentActionCanonicalExcludedKeysV1,
  npAgentActionCanonicalIncludedKeysV1,
  npAgentActionTargetVersionFactIncludedKeysV1,
  npAgentCanonicalBodyMaxBytesV1,
  npAnalyzeAgentActionCanonical,
  npBuildAgentActionCanonicalBytes,
  npDigestAgentActionCanonical,
  type NpAgentActionCanonicalV1,
  type NpAgentContractResult,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const digestB = "cj1:sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const actionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const mediaId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const goldenDigest = "cj1:sha256:Ksf46Y1Q5-psIAFdY3bHuWNOLAamDJjFYg5nZdI03D8";

function action(overrides: Partial<NpAgentActionCanonicalV1> = {}): NpAgentActionCanonicalV1 {
  const targetRefs = [
    { kind: "document" as const, collection: "posts", documentId: "post-1" },
    { kind: "media" as const, mediaId },
  ];
  return {
    schemaVersion: "np.agent-action.v1",
    siteId: "docs-site",
    actionId,
    invocationFingerprint: digestA,
    runFingerprint: digestB,
    sequence: 1,
    capabilityId: "content.query",
    capabilityContractVersion: 1,
    capabilityFingerprint: digestA,
    effectProfile: { id: "read", contractVersion: 1 },
    risk: "read",
    requiredScopes: ["content:read", "site:read"],
    targetRefs,
    targetVersionFacts: targetRefs.map((targetRef) => ({
      targetRef: { ...targetRef },
      versionDigest: digestB,
    })),
    input: { collection: "posts", limit: 20 },
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent action canonical body", () => {
  it("exports exact field fixtures and the 4 MiB ceiling", () => {
    expect(npAgentActionCanonicalIncludedKeysV1).toHaveLength(15);
    expect(npAgentActionTargetVersionFactIncludedKeysV1).toEqual(["targetRef", "versionDigest"]);
    expect(npAgentActionCanonicalExcludedKeysV1).toContain("proposalHash");
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-action.v1"]).toBe(4 * 1024 * 1024);
  });

  it("builds stable bytes and the independent golden digest", async () => {
    const body = action();
    const analyzed = npAnalyzeAgentActionCanonical(body);
    expect(analyzed).toEqual({ ok: true, value: body });
    expect(npBuildAgentActionCanonicalBytes(body).purpose).toBe("np.agent-action.v1");
    expect(await npDigestAgentActionCanonical(body)).toBe(goldenDigest);
  });

  it("enforces sorted scopes, RFC 8785 targets, and same-ordinal facts", () => {
    expectIssue(
      npAnalyzeAgentActionCanonical(action({ requiredScopes: ["site:read", "content:read"] })),
      "order",
      "agent.canonical.action.requiredScopes[1]",
    );
    const reversed = [...action().targetRefs].reverse();
    expectIssue(
      npAnalyzeAgentActionCanonical(
        action({
          targetRefs: reversed,
          targetVersionFacts: reversed.map((targetRef) => ({
            targetRef: { ...targetRef },
            versionDigest: digestA,
          })),
        }),
      ),
      "order",
      "agent.canonical.action.targetRefs[1]",
    );
    expectIssue(
      npAnalyzeAgentActionCanonical(
        action({
          targetVersionFacts: [
            { targetRef: action().targetRefs[1], versionDigest: digestA },
            { targetRef: action().targetRefs[0], versionDigest: digestA },
          ],
        }),
      ),
      "invalid-field",
      "agent.canonical.action.targetVersionFacts[0].targetRef",
    );
  });

  it("rejects excluded fields, hostile accessors, and bodies beyond the ceiling", () => {
    expectIssue(
      npAnalyzeAgentActionCanonical({ ...action(), proposalHash: digestA }),
      "unknown-field",
      "agent.canonical.action.proposalHash",
    );
    const getter = vi.fn(() => digestA);
    const hostile = action() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "proposalHash", { enumerable: true, get: getter });
    expectIssue(
      npAnalyzeAgentActionCanonical(hostile),
      "shape",
      "agent.canonical.action.proposalHash",
    );
    expect(getter).not.toHaveBeenCalled();
    const oversized = npAnalyzeAgentActionCanonical(
      action({ input: { chunks: Array.from({ length: 17 }, () => "x".repeat(262_144)) } }),
    );
    expect(oversized.ok).toBe(false);
    if (!oversized.ok)
      expect(oversized.issues).toContainEqual(expect.objectContaining({ code: "limit" }));
  });

  it("rejects canonical input graphs beyond the shared 20,000-node limit", () => {
    const result = npAnalyzeAgentActionCanonical(
      action({
        input: {
          rows: Array.from({ length: 5_000 }, () => [0, 1, 2, 3]),
        },
      }),
    );
    expectIssue(result, "limit", "agent.canonical.action.input.rows[3992][0]");
  });
});
