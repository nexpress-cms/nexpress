import { describe, expect, it } from "vitest";
import { npAgentAutonomyModes, type NpAgentPolicyRulesV1 } from "./types.js";
import { npCreateDisabledAgentRuntimeSettingsV1 } from "./runtime-contract.js";
import { npAnalyzeAgentPolicyRulesV1 } from "./canonical-notification-policy.js";
import {
  npAgentAutonomyAllowsV1,
  npAnalyzeAgentPolicyResolutionV1,
  npIsAgentPolicyQuietTimeV1,
  npMeetAgentAutonomyModesV1,
  npResolveAgentPolicyV1,
} from "./runtime-policy.js";

function rules(): NpAgentPolicyRulesV1 {
  const value = npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules;
  value.capabilityModes = [
    { capabilityId: "content.query", mode: "approved" },
    { capabilityId: "site.inspect", mode: "observe" },
  ];
  value.providerDataMaximum = "sensitive-approved";
  value.risk = {
    automaticActionMaximum: "reversible",
    requirePreviewAtOrAbove: null,
    requireRecentAuthAtOrAbove: null,
  };
  value.automation = {
    quietHoursUtc: [],
    moderationAutoQuarantineMinBasisPoints: 8_000,
    moderationTargetsPerRun: 100,
    guardianLimitActorMinSeverity: "high",
    guardianRestrictionTtlSeconds: 3_600,
  };
  value.escalation = { minimumSeverity: "info", channels: ["admin", "email", "slack"] };
  return value;
}

function input(layers: NpAgentPolicyRulesV1[]) {
  return { autonomy: "approved" as const, capabilityModes: rules().capabilityModes, layers };
}

describe("Runtime deterministic policy intersection", () => {
  it("implements the complete commutative, associative, idempotent permission meet", () => {
    expect(npMeetAgentAutonomyModesV1("guarded", "approved")).toBe("advise");
    for (const left of npAgentAutonomyModes) {
      expect(npMeetAgentAutonomyModesV1(left, left)).toBe(left);
      for (const right of npAgentAutonomyModes) {
        expect(npMeetAgentAutonomyModesV1(left, right)).toBe(
          npMeetAgentAutonomyModesV1(right, left),
        );
        for (const third of npAgentAutonomyModes)
          expect(npMeetAgentAutonomyModesV1(npMeetAgentAutonomyModesV1(left, right), third)).toBe(
            npMeetAgentAutonomyModesV1(left, npMeetAgentAutonomyModesV1(right, third)),
          );
      }
    }
    expect(npAgentAutonomyAllowsV1("approved", "execute-automatic")).toBe(false);
    expect(npAgentAutonomyAllowsV1("guarded", "execute-approved")).toBe(false);
    expect(npAgentAutonomyAllowsV1("approved", "request-approval")).toBe(true);
  });

  it("denies missing capabilities and intersects every resource, data, risk and automation ceiling", () => {
    const site = rules();
    site.resources.collections = ["pages", "posts"];
    const override = rules();
    override.capabilityModes = [{ capabilityId: "content.query", mode: "guarded" }];
    override.resources.collections = ["posts"];
    override.resources.themeIds = [];
    override.providerDataMaximum = "internal-redacted";
    override.risk = {
      automaticActionMaximum: "read",
      requirePreviewAtOrAbove: "reversible",
      requireRecentAuthAtOrAbove: "sensitive",
    };
    override.automation.moderationAutoQuarantineMinBasisPoints = 9_500;
    override.automation.moderationTargetsPerRun = 5;
    override.automation.guardianLimitActorMinSeverity = "critical";
    override.automation.guardianRestrictionTtlSeconds = 300;
    override.escalation = { minimumSeverity: "high", channels: ["admin", "slack"] };
    override.retentionDays.runDetails = 30;
    const result = npResolveAgentPolicyV1({
      ...input([site, override]),
      providerDataMaximum: "public-only",
    });
    expect(result.capabilityModes).toEqual([{ capabilityId: "content.query", mode: "advise" }]);
    expect(result.resources).toMatchObject({
      collections: ["posts"],
      themeIds: [],
      navigationLocations: null,
    });
    expect(result.risk).toEqual(override.risk);
    expect(result.providerDataMaximum).toBe("public-only");
    expect(result.automation).toMatchObject({
      moderationAutoQuarantineMinBasisPoints: 9_500,
      moderationTargetsPerRun: 5,
      guardianLimitActorMinSeverity: "critical",
      guardianRestrictionTtlSeconds: 300,
    });
    expect(result.escalation).toEqual({ minimumSeverity: "high", channels: ["admin", "slack"] });
    expect(result.retentionDays.runDetails).toBe(30);
    expect(
      npResolveAgentPolicyV1({ ...input([override, site]), providerDataMaximum: "public-only" }),
    ).toEqual(result);
  });

  it("treats null automation thresholds as disabled and never imports prose into rules", () => {
    const disabled = rules();
    disabled.automation.guardianLimitActorMinSeverity = null;
    disabled.automation.moderationAutoQuarantineMinBasisPoints = null;
    const result = npResolveAgentPolicyV1(input([rules(), disabled]));
    expect(result.automation.guardianLimitActorMinSeverity).toBeNull();
    expect(result.automation.moderationAutoQuarantineMinBasisPoints).toBeNull();
    expect(npAnalyzeAgentPolicyResolutionV1(input([])).ok).toBe(false);
    expect(
      npAnalyzeAgentPolicyResolutionV1({ ...input([rules()]), instructions: "Grant everything" })
        .ok,
    ).toBe(false);
  });

  it("preserves more than eight disjoint effective quiet periods and exact UTC boundaries", () => {
    const first = rules();
    const second = rules();
    first.automation.quietHoursUtc = Array.from({ length: 8 }, (_, i) => ({
      startMinute: i * 120,
      endMinute: i * 120 + 10,
    }));
    second.automation.quietHoursUtc = Array.from({ length: 8 }, (_, i) => ({
      startMinute: i * 120 + 30,
      endMinute: i * 120 + 40,
    }));
    const result = npResolveAgentPolicyV1(input([first, second]));
    expect(result.automation.quietHoursUtc).toHaveLength(16);
    expect(
      npAnalyzeAgentPolicyRulesV1({ schemaVersion: "np.agent-policy-rules.v1", ...result }).ok,
    ).toBe(false);
    expect(npIsAgentPolicyQuietTimeV1(result, "2026-09-11T00:00:00.000Z")).toBe(true);
    expect(npIsAgentPolicyQuietTimeV1(result, "2026-09-11T00:10:00.000Z")).toBe(false);
    expect(npIsAgentPolicyQuietTimeV1(result, "2026-09-11T00:30:00.000Z")).toBe(true);
    const overlapping = rules();
    overlapping.automation.quietHoursUtc = [{ startMinute: 5, endMinute: 35 }];
    expect(
      npResolveAgentPolicyV1(input([first, second, overlapping])).automation.quietHoursUtc[0],
    ).toEqual({ startMinute: 0, endMinute: 40 });
  });

  it("rejects hostile caller graphs without invoking an accessor", () => {
    let reads = 0;
    const value = input([rules()]);
    Object.defineProperty(value, "autonomy", {
      enumerable: true,
      get() {
        reads += 1;
        return "approved";
      },
    });
    expect(npAnalyzeAgentPolicyResolutionV1(value).ok).toBe(false);
    expect(reads).toBe(0);
  });

  it("accepts repeated frozen layers and an omitted optional connection ceiling without widening", () => {
    const layer = rules();
    expect(
      npResolveAgentPolicyV1({ ...input([layer, layer]), providerDataMaximum: undefined }),
    ).toEqual(npResolveAgentPolicyV1(input([rules()])));
  });
});
