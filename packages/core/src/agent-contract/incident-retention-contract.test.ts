import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentRetentionPolicyV1 } from "./incident-retention-contract.js";

describe("explicit Incident retention policy", () => {
  it("accepts bounded minimum ages and rejects missing, oversized or extra authority fields", () => {
    expect(npRequireAgentIncidentRetentionPolicyV1({ signalDays: 90, historyDays: 365 })).toEqual({
      signalDays: 90,
      historyDays: 365,
    });
    expect(npRequireAgentIncidentRetentionPolicyV1({ signalDays: 1, historyDays: 1 })).toEqual({
      signalDays: 1,
      historyDays: 1,
    });
    for (const value of [
      undefined,
      {},
      { signalDays: 0, historyDays: 365 },
      { signalDays: 91, historyDays: 365 },
      { signalDays: 90, historyDays: 366 },
      { signalDays: 90, historyDays: 365, releaseAudit: true },
    ])
      expect(() => npRequireAgentIncidentRetentionPolicyV1(value)).toThrow();
  });
});
