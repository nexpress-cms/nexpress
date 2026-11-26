import { describe, expect, it } from "vitest";
import {
  npAgentGuardianSourceNamespaceDigestV1,
  type NpAgentGuardianSourceClosureV1,
} from "../agent-contract/guardian-retention-contract.js";
import {
  npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1,
  npReadAgentGuardianSourceClosureFromRetainedRowV1,
} from "./guardian-source-closure.js";

async function fixture(): Promise<{ value: NpAgentGuardianSourceClosureV1 }> {
  return {
    value: {
      schemaVersion: "np.agent-guardian-source-closure.v1",
      siteId: "default",
      family: "requests",
      namespaceDigest: await npAgentGuardianSourceNamespaceDigestV1("requests"),
      closedBefore: "2026-10-18T00:00:00.000Z",
      closedAt: "2026-10-18T00:01:00.000Z",
      revision: 1,
      retentionPolicyDigest: `cj1:sha256:${"A".repeat(43)}`,
    },
  };
}

describe("Guardian retained closure row validation", () => {
  it("distinguishes absent rows from present null, undefined and malformed values", async () => {
    expect(
      await npReadAgentGuardianSourceClosureFromRetainedRowV1("default", "requests", undefined),
    ).toBeNull();
    for (const value of [null, undefined, { family: "requests" }])
      await expect(
        npReadAgentGuardianSourceClosureFromRetainedRowV1("default", "requests", { value }),
      ).rejects.toThrow();
    await expect(
      npReadAgentGuardianSourceClosureFromRetainedRowV1(
        "../private-site-marker",
        "requests",
        undefined,
      ),
    ).rejects.toThrow();
  });

  it("requires the exact site, family and current stable namespace digest", async () => {
    const row = await fixture();
    expect(
      await npReadAgentGuardianSourceClosureFromRetainedRowV1("default", "requests", row),
    ).toEqual(row.value);
    for (const value of [
      { ...row.value, siteId: "other-site" },
      { ...row.value, family: "http" },
      { ...row.value, namespaceDigest: `cj1:sha256:${"B".repeat(43)}` },
    ])
      await expect(
        npReadAgentGuardianSourceClosureFromRetainedRowV1("default", "requests", { value }),
      ).rejects.toMatchObject({ code: "GUARDIAN_SOURCE_CLOSURE_INVALID", status: 409 });
  });

  it("preserves the strict cutoff and validates occurrence UTC even without a closure", async () => {
    const row = await fixture();
    expect(
      await npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
        "default",
        "requests",
        "2026-10-17T23:59:59.999Z",
        row,
      ),
    ).toBe(true);
    expect(
      await npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
        "default",
        "requests",
        row.value.closedBefore,
        row,
      ),
    ).toBe(false);
    expect(
      await npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
        "default",
        "requests",
        "2026-10-17T23:59:59.999Z",
        undefined,
      ),
    ).toBe(false);
    await expect(
      npIsAgentGuardianSourceDeliveryClosedFromRetainedRowV1(
        "default",
        "requests",
        "2026-10-17T23:59:59Z",
        undefined,
      ),
    ).rejects.toThrow();
  });
});
