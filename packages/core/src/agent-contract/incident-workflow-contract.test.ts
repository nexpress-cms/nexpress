import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentTransitionInputV1 } from "./incident-workflow-contract.js";
import { npRequireAgentIncidentStudioDetailV1 } from "./incident-studio-contract.js";

const command = {
  schemaVersion: "np.agent-incident-transition-input.v1",
  expectedVersion: 1,
  transition: "resolved",
  resolutionCode: "REMEDIATED",
  note: "Reviewed and retained quarantine.",
  containmentReviewHash: `cj1:sha256:${"A".repeat(43)}`,
  containmentDisposition: "retain",
  idempotencyKey: "review-1",
};

describe("Incident human decision contracts", () => {
  it("accepts distinct investigation, resolution and dismissal decisions", () => {
    for (const value of [
      command,
      {
        ...command,
        transition: "dismissed",
        resolutionCode: "FALSE_POSITIVE",
        containmentDisposition: "acknowledge",
      },
      {
        ...command,
        transition: "investigating",
        resolutionCode: null,
        containmentReviewHash: null,
        containmentDisposition: null,
      },
    ])
      expect(npRequireAgentIncidentTransitionInputV1(value)).toEqual(value);
  });
  it("rejects unsupported state changes and incomplete or contradictory review decisions", () => {
    for (const change of [
      { transition: "contained" },
      { transition: "monitoring" },
      { transition: "open" },
      { resolutionCode: "FALSE_POSITIVE" },
      { transition: "investigating" },
      { containmentReviewHash: null },
      { containmentDisposition: null },
      { note: " " },
      { note: "untrimmed " },
      { note: "x".repeat(2001) },
      { note: "unsafe\u0000note" },
      { expectedVersion: 2147483647 },
      { siteId: "injected-site" },
      { idempotencyKey: "bad key" },
    ])
      expect(() => npRequireAgentIncidentTransitionInputV1({ ...command, ...change })).toThrow();
  });
  it("allows a bounded Unicode decision page and rejects inconsistent summary or private fields", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const at = "2026-09-27T00:00:00.000Z";
    const detail = {
      schemaVersion: "np.agent-incident-studio-detail.v1",
      incident: {
        version: "np.agent-incident.v1",
        id,
        siteId: "default",
        fingerprint: "fixture",
        category: "spam",
        severity: "high",
        status: "investigating",
        title: "Review",
        summary: "Observed signal",
        primarySubject: null,
        assignedAgentId: null,
        signalIds: [],
        eventCount: 0,
        firstObservedAt: at,
        lastObservedAt: at,
        containedAt: null,
        resolvedAt: null,
        resolutionCode: null,
        versionNumber: 2,
        createdAt: at,
        updatedAt: at,
      },
      signals: [],
      feedback: [],
      feedbackAvailable: false,
      response: null,
      nextTimelineCursor: null,
      timeline: Array.from({ length: 50 }, (_, index) => ({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        sequence: index + 1,
        kind: "state_transition",
        createdAt: at,
        approvalId: null,
        actionId: null,
        decision: {
          fromStatus: "open",
          toStatus: "investigating",
          resolutionCode: null,
          note: "가나".repeat(1000),
          containmentDisposition: null,
        },
      })),
      workflow: {
        availableTransitions: ["resolved", "dismissed"],
        containment: {
          reviewHash: command.containmentReviewHash,
          total: 1,
          active: 1,
          restored: 0,
          unresolved: 0,
          pendingActions: 0,
        },
      },
    };
    expect(npRequireAgentIncidentStudioDetailV1(detail)).toEqual(detail);
    const failure = {
      ...detail.timeline[0],
      kind: "action",
      actionId: id,
      decision: null,
      containmentFailure: { outcome: "rolled_back", reasonCode: "CONTAINMENT_VERIFICATION_FAILED" },
    };
    const recovery = {
      state: "pending",
      attempts: 1,
      lastAttemptAt: at,
      nextAttemptAt: "2026-09-27T00:00:30.000Z",
      lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
    };
    for (const notificationRecovery of [null, recovery]) {
      const projected = { ...failure, notificationRecovery };
      expect(
        npRequireAgentIncidentStudioDetailV1({ ...detail, timeline: [projected] }).timeline,
      ).toEqual([projected]);
      expect(() =>
        npRequireAgentIncidentStudioDetailV1({
          ...detail,
          timeline: [{ ...detail.timeline[0], notificationRecovery }],
        }),
      ).toThrow();
    }
    expect(() =>
      npRequireAgentIncidentStudioDetailV1({
        ...detail,
        timeline: [{ ...failure, notificationRecovery: { ...recovery, source: "private" } }],
      }),
    ).toThrow();

    const altered = (value: object) => ({
      ...detail,
      workflow: { ...detail.workflow, containment: { ...detail.workflow.containment, ...value } },
    });
    expect(() => npRequireAgentIncidentStudioDetailV1(altered({ total: 0 }))).toThrow();
    expect(() => npRequireAgentIncidentStudioDetailV1(altered({ pendingActions: 1 }))).toThrow();
    expect(() =>
      npRequireAgentIncidentStudioDetailV1(altered({ originalState: "private" })),
    ).toThrow();
    expect(() =>
      npRequireAgentIncidentStudioDetailV1({
        ...detail,
        timeline: [{ ...detail.timeline[0], kind: "observed" }],
      }),
    ).toThrow();
  });
});
