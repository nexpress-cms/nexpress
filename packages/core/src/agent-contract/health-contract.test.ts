import { describe, expect, it } from "vitest";

import {
  npAgentHealthSummaryExcludedKeysV1,
  npAnalyzeAgentHealthSummaryV1,
  npRequireAgentHealthSummaryV1,
} from "./health-contract.js";

function summary() {
  return {
    schemaVersion: "np.agent-health-summary.v1",
    generatedAt: "2026-08-30T06:00:00.000Z",
    state: "warn",
    issueCount: 0,
    issues: [],
    states: [
      { entity: "connection", state: "ready", count: 2, oldestAgeSeconds: 60 },
      { entity: "vault-operation", state: "waiting_inspection", count: 1, oldestAgeSeconds: 5 },
    ],
    readiness: {
      providers: { state: "unknown", requiredCount: 1, availableCount: 0 },
      vault: { state: "ready", requiredCount: 1, availableCount: 1 },
    },
  };
}

describe("Agent health summary contract", () => {
  it("accepts one exact aggregate-only projection", () => {
    expect(npRequireAgentHealthSummaryV1(summary())).toEqual(summary());
  });

  it("rejects unknown fields, dishonest totals, ordering, and readiness", () => {
    expect(
      npAnalyzeAgentHealthSummaryV1({ ...summary(), secretRef: "vault://secret" }),
    ).toMatchObject({ ok: false, issues: [{ code: "unknown-field" }] });
    expect(npAnalyzeAgentHealthSummaryV1({ ...summary(), issueCount: 1 })).toMatchObject({
      ok: false,
    });
    const reversed = summary();
    reversed.states.reverse();
    expect(npAnalyzeAgentHealthSummaryV1(reversed)).toMatchObject({ ok: false });
    const unavailable = summary();
    unavailable.readiness.providers = {
      state: "ready",
      requiredCount: 1,
      availableCount: 0,
    };
    expect(npAnalyzeAgentHealthSummaryV1(unavailable)).toMatchObject({ ok: false });
    const unknownInventory = summary();
    unknownInventory.readiness.providers = {
      state: "unknown",
      requiredCount: 0,
      availableCount: 0,
    };
    expect(npAnalyzeAgentHealthSummaryV1(unknownInventory)).toMatchObject({ ok: true });
    unknownInventory.readiness.providers.availableCount = 1;
    expect(npAnalyzeAgentHealthSummaryV1(unknownInventory)).toMatchObject({ ok: false });
  });

  it("structurally excludes credential, locator, digest, and row identity fields", () => {
    const encoded = JSON.stringify(npRequireAgentHealthSummaryV1(summary()));
    for (const key of npAgentHealthSummaryExcludedKeysV1) {
      expect(encoded).not.toContain(`"${key}"`);
    }
  });

  it("contains hostile accessors and non-plain values", () => {
    const hostile = summary();
    Object.defineProperty(hostile, "generatedAt", {
      enumerable: true,
      get() {
        throw new Error("must not escape");
      },
    });
    expect(npAnalyzeAgentHealthSummaryV1(hostile)).toMatchObject({
      ok: false,
      issues: [{ code: "shape" }],
    });
    expect(npAnalyzeAgentHealthSummaryV1(Object.create(summary()))).toMatchObject({ ok: false });
  });
});
