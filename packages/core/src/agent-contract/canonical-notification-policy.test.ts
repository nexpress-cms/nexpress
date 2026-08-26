import { describe, expect, it } from "vitest";

import {
  npAgentCanonicalBodyMaxBytesV1,
  npAgentNotificationDeliveryAdminIncludedKeysV1,
  npAgentNotificationDeliveryCanonicalExcludedKeysV1,
  npAgentNotificationDeliveryCanonicalIncludedKeysV1,
  npAgentNotificationDeliveryExternalIncludedKeysV1,
  npAgentPolicyCanonicalExcludedKeysV1,
  npAgentPolicyCanonicalIncludedKeysV1,
  npAnalyzeAgentNotificationDeliveryCanonical,
  npAnalyzeAgentPolicyCanonical,
  npDigestAgentNotificationDeliveryCanonical,
  npDigestAgentPolicyCanonical,
  type NpAgentContractResult,
  type NpAgentNotificationDeliveryCanonicalV1,
  type NpAgentPolicyCanonicalV1,
} from "./index.js";

const digestA = "cj1:sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const notificationId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const incidentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd2";
const connectionId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd3";
const configSnapshotId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd4";
const goldenAdminDigest = "cj1:sha256:Ct2OTzQ323Rn7jzeMIdmqRoKyRsZvAESYQsMnlylJmA";
const goldenExternalDigest = "cj1:sha256:NbcaYGYg7EhqlgKZnp6oJNawrahmLSF70g5vwTtRbso";
const goldenPolicyDigest = "cj1:sha256:PNdqy59OXJlYRbdC2Mpqkyje_si7RJN2v43KZ-MZbDA";

function adminNotification(): NpAgentNotificationDeliveryCanonicalV1 {
  return {
    schemaVersion: "np.agent-notification-delivery.v1",
    siteId: "docs-site",
    notificationId,
    channel: "admin",
    source: { incidentId, runId: null, actionId: null, transitionVersion: 1 },
    deduplicationKey: "incident:1:opened",
    payloadRedacted: { title: "Incident opened", severity: "high" },
    attempt: 0,
    result: { state: "confirmed_local" },
    observedAt: "2026-08-26T01:02:03.004Z",
  };
}

function externalNotification(): Extract<
  NpAgentNotificationDeliveryCanonicalV1,
  { channel: "email" | "slack" | "webhook" | "siem" }
> {
  return {
    schemaVersion: "np.agent-notification-delivery.v1",
    siteId: "docs-site",
    notificationId,
    channel: "slack",
    source: { incidentId, runId: null, actionId: null, transitionVersion: 1 },
    deduplicationKey: "incident:1:opened",
    payloadRedacted: { title: "Incident opened", severity: "high" },
    attempt: 1,
    adapter: {
      id: "slack.notifications",
      contractVersion: 1,
      fingerprint: digestA,
      idempotency: "enforced",
    },
    connection: {
      id: connectionId,
      configSnapshotId,
      configVersion: 2,
      configHash: digestA,
      accountSubjectKeyId: "account-key-1",
      accountSubjectDigest: "S".repeat(43),
      destinationKeyId: "destination-key-1",
      destinationFingerprint: `cj1:hmac-sha256:destination-key-1:${"D".repeat(43)}`,
    },
    result: { state: "confirmed" },
    observedAt: "2026-08-26T01:02:03.004Z",
  };
}

function policy(overrides: Partial<NpAgentPolicyCanonicalV1> = {}): NpAgentPolicyCanonicalV1 {
  return {
    schemaVersion: "np.agent-policy.v1",
    instructions: "Keep operator summaries concise and cite exact evidence.",
    rules: {
      schemaVersion: "np.agent-policy-rules.v1",
      capabilityModes: [{ capabilityId: "content.query", mode: "observe" }],
      resources: {
        collections: ["posts"],
        navigationLocations: null,
        themeIds: null,
        settingKeys: null,
        incidentCategories: ["agent-abuse", "traffic"],
        actorRestrictionScopes: ["agent.gateway", "auth.staff"],
      },
      risk: {
        automaticActionMaximum: "reversible",
        requirePreviewAtOrAbove: "sensitive",
        requireRecentAuthAtOrAbove: "destructive",
      },
      providerDataMaximum: "internal-redacted",
      automation: {
        quietHoursUtc: [
          { startMinute: 0, endMinute: 120 },
          { startMinute: 1_320, endMinute: 1_440 },
        ],
        moderationAutoQuarantineMinBasisPoints: 9_000,
        moderationTargetsPerRun: 20,
        guardianLimitActorMinSeverity: "critical",
        guardianRestrictionTtlSeconds: 900,
      },
      escalation: { minimumSeverity: "medium", channels: ["admin", "email"] },
      retentionDays: { events: 14, signals: 90, runDetails: 90, incidentsAndActions: 365 },
    },
    ...overrides,
  };
}

function expectIssue(result: NpAgentContractResult<unknown>, code: string, path: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe("Agent notification-delivery and policy canonical bodies", () => {
  it("exports exact branch, top-level, and exclusion fixtures", () => {
    expect(npAgentNotificationDeliveryCanonicalIncludedKeysV1).toHaveLength(12);
    expect(npAgentNotificationDeliveryAdminIncludedKeysV1).not.toContain("adapter");
    expect(npAgentNotificationDeliveryExternalIncludedKeysV1).toContain("adapter");
    expect(npAgentNotificationDeliveryCanonicalExcludedKeysV1).toContain("providerMessageId");
    expect(npAgentPolicyCanonicalIncludedKeysV1).toEqual([
      "schemaVersion",
      "instructions",
      "rules",
    ]);
    expect(npAgentPolicyCanonicalExcludedKeysV1).toContain("siteId");
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-notification-delivery.v1"]).toBe(256 * 1024);
    expect(npAgentCanonicalBodyMaxBytesV1["np.agent-policy.v1"]).toBe(1024 * 1024);
  });

  it("accepts both delivery branches and independent golden vectors", async () => {
    expect(npAnalyzeAgentNotificationDeliveryCanonical(adminNotification()).ok).toBe(true);
    expect(npAnalyzeAgentNotificationDeliveryCanonical(externalNotification()).ok).toBe(true);
    expect(await npDigestAgentNotificationDeliveryCanonical(adminNotification())).toBe(
      goldenAdminDigest,
    );
    expect(await npDigestAgentNotificationDeliveryCanonical(externalNotification())).toBe(
      goldenExternalDigest,
    );
    expect(await npDigestAgentPolicyCanonical(policy())).toBe(goldenPolicyDigest);
  });

  it("rejects cross-branch keys, absent sources, and provider receipts", () => {
    expectIssue(
      npAnalyzeAgentNotificationDeliveryCanonical({
        ...adminNotification(),
        adapter: externalNotification().adapter,
      }),
      "unknown-field",
      "agent.canonical.notificationDelivery.adapter",
    );
    expectIssue(
      npAnalyzeAgentNotificationDeliveryCanonical({
        ...adminNotification(),
        source: { incidentId: null, runId: null, actionId: null, transitionVersion: 1 },
      }),
      "invalid-field",
      "agent.canonical.notificationDelivery.source",
    );
    expectIssue(
      npAnalyzeAgentNotificationDeliveryCanonical({
        ...externalNotification(),
        result: { state: "confirmed", providerMessageId: "provider-1" },
      }),
      "unknown-field",
      "agent.canonical.notificationDelivery.result.providerMessageId",
    );
  });

  it("enforces policy set ordering, quiet-hour normalization, and hard bounds", () => {
    expect(npAnalyzeAgentPolicyCanonical(policy()).ok).toBe(true);
    expectIssue(
      npAnalyzeAgentPolicyCanonical(
        policy({
          rules: {
            ...policy().rules,
            resources: {
              ...policy().rules.resources,
              incidentCategories: ["traffic", "agent-abuse"],
            },
          },
        }),
      ),
      "order",
      "agent.canonical.policy.rules.resources.incidentCategories[1]",
    );
    expectIssue(
      npAnalyzeAgentPolicyCanonical(
        policy({
          rules: {
            ...policy().rules,
            automation: {
              ...policy().rules.automation,
              quietHoursUtc: [
                { startMinute: 100, endMinute: 200 },
                { startMinute: 150, endMinute: 300 },
              ],
            },
          },
        }),
      ),
      "order",
      "agent.canonical.policy.rules.automation.quietHoursUtc[1]",
    );
    expectIssue(
      npAnalyzeAgentPolicyCanonical({ ...policy(), policyHash: digestA }),
      "unknown-field",
      "agent.canonical.policy.policyHash",
    );
  });
});
