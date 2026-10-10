import { expect, it } from "vitest";
import { npRequireAgentIncidentNotificationRecoveryV1 } from "./incident-notification-recovery-contract.js";
const at = "2026-10-10T00:00:00.000Z";
const next = "2026-10-10T00:00:30.000Z";
const pending = {
  state: "pending",
  attempts: 1,
  lastAttemptAt: at,
  nextAttemptAt: next,
  lastErrorCode: "NOTIFICATION_RECORDING_FAILED",
};
it("distinguishes initial work, due recording recovery and verified terminal evidence", () => {
  for (const body of [
    { ...pending, attempts: 0, lastAttemptAt: null, lastErrorCode: null },
    pending,
    { ...pending, state: "sent", attempts: 2, nextAttemptAt: null, lastErrorCode: null },
    { ...pending, state: "failed", attempts: 5, nextAttemptAt: null },
    { ...pending, state: "failed", nextAttemptAt: null, lastErrorCode: "SOURCE_EVIDENCE_INVALID" },
  ])
    expect(npRequireAgentIncidentNotificationRecoveryV1(body)).toEqual(body);
});
it("rejects unbounded, contradictory or private recovery projections", () => {
  for (const change of [
    { attempts: 6 },
    { attempts: -1 },
    { attempts: 1.5 },
    { attempts: 0 },
    { attempts: 5 },
    { lastAttemptAt: null },
    { nextAttemptAt: at },
    { nextAttemptAt: null },
    { lastErrorCode: null },
    { lastErrorCode: "SOURCE_EVIDENCE_INVALID" },
    { lastErrorCode: "raw-db-error" },
    { state: "sent" },
    { state: "failed", nextAttemptAt: null },
    { lastAttemptAt: "2026-10-10T09:00:00+09:00" },
    { source: { auditEventId: "private-evidence" } },
    { sourceHash: "private-digest" },
    { workerRunning: true },
    { externalDelivery: true },
  ])
    expect(() => npRequireAgentIncidentNotificationRecoveryV1({ ...pending, ...change })).toThrow();
});
