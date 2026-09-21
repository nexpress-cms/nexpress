import { describe, expect, it } from "vitest";
import { npAnalyzeSettingRecord } from "../settings/contract.js";
import {
  npNextAgentMaintenanceReceiptV1,
  npRequireAgentMaintenanceReceiptV1,
  NP_AGENT_MAINTENANCE_RECEIPT_KEY,
} from "./maintenance-evidence-contract.js";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const at = "2026-09-21T00:00:00.000Z";
const input = {
  cursor: null,
  nextCursor: a,
  startedAt: at,
  completedAt: at,
  examined: 25,
  pruned: 26,
};
describe("maintenance receipt continuity", () => {
  it("requires a continuous cursor pass from its start, preserving an earlier completion", () => {
    const started = npNextAgentMaintenanceReceiptV1(null, input);
    expect(started.lastCompletedSweepAt).toBeNull();
    const completed = npNextAgentMaintenanceReceiptV1(started, {
      ...input,
      cursor: a,
      nextCursor: null,
      examined: 0,
      pruned: 0,
    });
    expect(completed.lastCompletedSweepAt).toBe(at);
    expect(npNextAgentMaintenanceReceiptV1(completed, input).lastCompletedSweepAt).toBe(at);
    expect(
      npNextAgentMaintenanceReceiptV1(null, { ...input, cursor: a, nextCursor: null })
        .lastCompletedSweepAt,
    ).toBeNull();
    expect(
      npNextAgentMaintenanceReceiptV1(started, { ...input, cursor: b, nextCursor: null })
        .lastCompletedSweepAt,
    ).toBeNull();
  });
  it("rejects clock reversal, extra private data and malformed traversal metadata", () => {
    const receipt = npNextAgentMaintenanceReceiptV1(null, input);
    expect(() =>
      npNextAgentMaintenanceReceiptV1(receipt, { ...input, startedAt: "2026-09-20T00:00:00.000Z" }),
    ).toThrow();
    expect(() =>
      npRequireAgentMaintenanceReceiptV1({ ...receipt, token: "not-allowed" }),
    ).toThrow();
    expect(() =>
      npRequireAgentMaintenanceReceiptV1({ ...receipt, expectedCursor: null }),
    ).toThrow();
    expect(npAnalyzeSettingRecord("test-site", NP_AGENT_MAINTENANCE_RECEIPT_KEY, receipt)).toEqual(
      [],
    );
    expect(
      npAnalyzeSettingRecord("_system", NP_AGENT_MAINTENANCE_RECEIPT_KEY, receipt),
    ).not.toEqual([]);
    expect(npAnalyzeSettingRecord("test-site", NP_AGENT_MAINTENANCE_RECEIPT_KEY, {})).not.toEqual(
      [],
    );
  });
});
