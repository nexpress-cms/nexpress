import { describe, expect, it } from "vitest";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "./runtime-contract.js";
import {
  npBuildAgentPolicySimulationFixtureInputV1,
  npDigestAgentPolicySimulationFixtureV1,
  npRequireAgentPolicySimulationFixtureJsonV1,
  npRequireAgentPolicySimulationReportV1,
  npSimulateAgentPolicyV1,
} from "./runtime-policy-simulation.js";
import type { NpAgentPolicyRulesV1 } from "./types.js";

const binding = {
  policyId: "00000000-0000-4000-8000-000000000001",
  policyVersion: 7,
  policyHash: `cj1:sha256:${"A".repeat(43)}`,
  fixtureHash: `cj1:sha256:${"B".repeat(43)}`,
};
function rules(): NpAgentPolicyRulesV1 {
  const result = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  result.capabilityModes = [
    { capabilityId: "content.query", mode: "approved" },
    { capabilityId: "site.inspect", mode: "guarded" },
  ];
  return result;
}

describe("bounded non-authorizing policy simulation", () => {
  it("builds one purpose-framed canonical versioned fixture", async () => {
    const { fixtureJson, fixtureHash } = await npBuildAgentPolicySimulationFixtureInputV1();
    const fixture = npRequireAgentPolicySimulationFixtureJsonV1(fixtureJson);
    expect(fixture).toEqual({
      schemaVersion: "np.agent-policy-simulation-fixture.v1",
      suite: "autonomy-and-quiet-hours",
    });
    expect(await npDigestAgentPolicySimulationFixtureV1(fixture)).toBe(fixtureHash);
    expect(await npBuildAgentPolicySimulationFixtureInputV1()).toEqual({
      fixtureJson,
      fixtureHash,
    });
    const extra = { ...fixture, facts: { content: "private" } };
    await expect(npDigestAgentPolicySimulationFixtureV1(extra)).rejects.toThrow();
    for (const invalid of [
      null,
      " ".repeat(257),
      "{",
      JSON.stringify(extra),
      JSON.stringify({ ...fixture, suite: "arbitrary" }),
      ` ${fixtureJson}`,
      fixtureJson.replace('"suite":', '"suite":"arbitrary","suite":'),
    ]) {
      expect(() => npRequireAgentPolicySimulationFixtureJsonV1(invalid)).toThrow();
    }
  });

  it("uses real restrictive autonomy meet and omits missing capabilities", () => {
    const first = rules();
    const second = rules();
    second.capabilityModes = [{ capabilityId: "content.query", mode: "guarded" }];
    const report = npSimulateAgentPolicyV1({ ...binding, layers: [first, second] });
    expect(report.cases.map((entry) => entry.autonomy)).toEqual([
      "observe",
      "advise",
      "guarded",
      "approved",
    ]);
    expect(report.cases.map((entry) => entry.capabilities)).toEqual([
      [{ capabilityId: "content.query", mode: "observe", permissions: ["read"] }],
      ...Array.from({ length: 3 }, () => [
        { capabilityId: "content.query", mode: "advise", permissions: ["read", "propose"] },
      ]),
    ]);
    expect(report).toMatchObject({ ...binding, nonAuthorizing: true });
    expect(report.limitations).toEqual([
      "authority",
      "budgets",
      "provider-readiness",
      "capability-execution",
    ]);
  });

  it("projects the actual resource, risk, data, automation and retention intersection", () => {
    const first = rules();
    const second = rules();
    first.resources.collections = ["pages", "posts"];
    second.resources.collections = ["posts"];
    first.providerDataMaximum = "sensitive-approved";
    second.providerDataMaximum = "public-only";
    first.retentionDays.runDetails = 90;
    second.retentionDays.runDetails = 12;
    first.risk.automaticActionMaximum = "reversible";
    second.risk.automaticActionMaximum = "read";
    first.automation.moderationTargetsPerRun = 20;
    second.automation.moderationTargetsPerRun = 2;
    const before = JSON.stringify([first, second]);
    const report = npSimulateAgentPolicyV1({ ...binding, layers: [first, second] });
    for (const entry of report.cases)
      expect(entry).toMatchObject({
        resources: { collections: ["posts"] },
        providerDataMaximum: "public-only",
        retentionDays: { runDetails: 12 },
        risk: { automaticActionMaximum: "read" },
        automation: { moderationTargetsPerRun: 2 },
      });
    expect(JSON.stringify([first, second])).toBe(before);
  });

  it("evaluates quiet time inclusively at starts and exclusively at ends", () => {
    const layer = rules();
    layer.automation.quietHoursUtc = [
      { startMinute: 0, endMinute: 360 },
      { startMinute: 720, endMinute: 1080 },
      { startMinute: 1439, endMinute: 1440 },
    ];
    const report = npSimulateAgentPolicyV1({ ...binding, layers: [layer] });
    expect(report.cases[0].quietTimeChecks).toEqual([
      { minuteUtc: 0, quiet: true },
      { minuteUtc: 360, quiet: false },
      { minuteUtc: 720, quiet: true },
      { minuteUtc: 1080, quiet: false },
      { minuteUtc: 1439, quiet: true },
    ]);
  });

  it("accepts the 128-window derived union rather than the eight-window storage bound", () => {
    const layers = Array.from({ length: 16 }, (_, layerIndex) => {
      const layer = rules();
      layer.automation.quietHoursUtc = Array.from({ length: 8 }, (_, windowIndex) => {
        const startMinute = (layerIndex * 8 + windowIndex) * 2;
        return { startMinute, endMinute: startMinute + 1 };
      });
      return layer;
    });
    const report = npSimulateAgentPolicyV1({ ...binding, layers });
    expect(report.cases[0].automation.quietHoursUtc).toHaveLength(128);
    expect(npRequireAgentPolicySimulationReportV1(report)).toEqual(report);
    expect(() => npSimulateAgentPolicyV1({ ...binding, layers: [...layers, rules()] })).toThrow();
  });

  it("rejects widening, falsified quiet probes, duplicate capabilities and unsafe report fields", () => {
    const report = npSimulateAgentPolicyV1({ ...binding, layers: [rules()] });
    const corruptions = [
      (value: typeof report) => {
        Object.assign(value, { nonAuthorizing: false });
      },
      (value: typeof report) => {
        value.cases[0].capabilities[0].mode = "approved";
        value.cases[0].capabilities[0].permissions = [
          "read",
          "propose",
          "request-approval",
          "execute-approved",
        ];
      },
      (value: typeof report) => {
        value.cases[0].capabilities[0].permissions.push("execute-automatic");
      },
      (value: typeof report) => {
        value.cases[0].quietTimeChecks[0].quiet = !value.cases[0].quietTimeChecks[0].quiet;
      },
      (value: typeof report) => {
        value.cases[0].capabilities.push({ ...value.cases[0].capabilities[0] });
      },
      (value: typeof report) => {
        value.cases.reverse();
      },
      (value: typeof report) => {
        value.limitations.pop();
      },
    ];
    for (const corrupt of corruptions) {
      const value = structuredClone(report);
      corrupt(value);
      expect(() => npRequireAgentPolicySimulationReportV1(value)).toThrow();
    }
    expect(() =>
      npRequireAgentPolicySimulationReportV1({ ...report, instructions: "do this" }),
    ).toThrow();
    expect(() =>
      npRequireAgentPolicySimulationReportV1({ ...report, policyId: "not-an-id" }),
    ).toThrow();
  });
});
