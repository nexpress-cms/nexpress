import { describe, expect, it, vi } from "vitest";
import {
  npAnalyzeSettingRecord,
  npAnalyzeSettingValue,
  npClassifySettingKey,
} from "../settings/contract.js";
import { NP_AGENT_RUNTIME_JOBS_SETTING_KEY as settingKey } from "../settings/types.js";
import {
  NP_AGENT_RUNTIME_JOBS_SETTING_KEY,
  npAnalyzeAgentRuntimeJobStateV1,
  npCreateAgentRuntimeJobStateV1,
  npRequireAgentRuntimeJobStateV1,
} from "./runtime-job-state-contract.js";
const uuid = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
describe("private Runtime jobs metadata", () => {
  it("creates independent empty metadata without runtime authority", () => {
    const first = npCreateAgentRuntimeJobStateV1();
    const second = npCreateAgentRuntimeJobStateV1();
    expect(npRequireAgentRuntimeJobStateV1(first)).toEqual(first);
    expect(Object.values(first.cursors)).toEqual(Array(7).fill(null));
    first.cursors.events = uuid;
    expect(second.cursors.events).toBeNull();
    expect(Object.keys(first)).toEqual(["schemaVersion", "cursors"]);
  });
  it("accepts canonical site cursors and UUID row cursors", () => {
    const state = npCreateAgentRuntimeJobStateV1();
    state.cursors = {
      eventSites: "default",
      scheduleSites: "site-b",
      retentionSites: "site-c",
      events: uuid,
      runs: uuid,
      triggers: uuid,
      retention: uuid,
    };
    expect(npRequireAgentRuntimeJobStateV1(state)).toEqual(state);
  });
  it("requires all exact fields and canonical identifiers", () => {
    const state = npCreateAgentRuntimeJobStateV1();
    for (const key of Object.keys(state.cursors)) {
      const cursors: Record<string, unknown> = { ...state.cursors };
      delete cursors[key];
      expect(npAnalyzeAgentRuntimeJobStateV1({ ...state, cursors }).ok).toBe(false);
      expect(
        npAnalyzeAgentRuntimeJobStateV1({
          ...state,
          cursors: { ...state.cursors, [key]: "INVALID ID" },
        }).ok,
      ).toBe(false);
    }
    for (const value of [
      { ...state, schemaVersion: "np.agent-runtime-jobs.v2" },
      { ...state, enabled: true },
      { ...state, credential: "private" },
      { ...state, cursors: { ...state.cursors, token: "private" } },
      { ...state, cursors: null },
    ])
      expect(npAnalyzeAgentRuntimeJobStateV1(value).ok).toBe(false);
  });
  it("rejects unsafe input without invoking getters", () => {
    const getter = vi.fn();
    const value = Object.defineProperty(npCreateAgentRuntimeJobStateV1(), "cursors", {
      enumerable: true,
      get: getter,
    });
    expect(npAnalyzeAgentRuntimeJobStateV1(value).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(npAnalyzeAgentRuntimeJobStateV1(Object.create(null)).ok).toBe(false);
  });
  it("registers one exact setting while returning opaque validation errors", () => {
    expect(settingKey).toBe(NP_AGENT_RUNTIME_JOBS_SETTING_KEY);
    expect(npClassifySettingKey(settingKey)).toBe("agents-runtime-jobs");
    expect(npAnalyzeSettingValue(settingKey, npCreateAgentRuntimeJobStateV1())).toEqual([]);
    expect(npAnalyzeSettingRecord("site-a", settingKey, npCreateAgentRuntimeJobStateV1())).toEqual(
      [],
    );
    expect(
      npAnalyzeSettingRecord("_system", settingKey, npCreateAgentRuntimeJobStateV1()).length,
    ).toBeGreaterThan(0);
    const issues = npAnalyzeSettingValue(settingKey, { token: "private-token-value" });
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("private-token-value");
  });
});
