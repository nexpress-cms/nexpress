import { describe, expect, it } from "vitest";
import { npRequireAgentIncidentNotificationsV1 } from "./incident-notifications-contract.js";
const incidentId = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
const item = {
  notificationId: "018f0f30-cd7b-7cc2-8b16-8c052c259bd2",
  incidentId,
  incidentVersion: 3,
  transition: "resolved",
  severity: "high",
  status: "resolved",
  summary: "Incident resolved.",
  adminPath: `/admin/agents/incidents/${incidentId}`,
  createdAt: "2026-09-29T00:00:00.000Z",
};
const page = (items: unknown[] = [item]) => ({
  schemaVersion: "np.agent-incident-notifications.v1",
  items,
  nextCursor: null,
});
describe("Incident Admin notification wire", () => {
  it("preserves bounded immutable transition metadata and cursor-only empty pages", () => {
    expect(npRequireAgentIncidentNotificationsV1(page())).toEqual(page());
    expect(
      npRequireAgentIncidentNotificationsV1({ ...page([]), nextCursor: "opaque.cursor" }).items,
    ).toEqual([]);
  });
  it("accepts exact failed-containment metadata only at high or critical severity", () => {
    const failed = {
      ...item,
      transition: "containment_failed",
      status: "investigating",
      summary: "Incident containment failed.",
    };
    expect(npRequireAgentIncidentNotificationsV1(page([failed])).items[0]).toEqual(failed);
    for (const change of [
      { severity: "medium" },
      { status: "failed" },
      { summary: "Database error details" },
      { actionId: incidentId },
    ])
      expect(() =>
        npRequireAgentIncidentNotificationsV1(page([{ ...failed, ...change }])),
      ).toThrow();
  });
  it("rejects private fields, injected navigation and contradictory unsupported transitions", () => {
    for (const change of [
      { body: "private" },
      { adminPath: "https://example.test" },
      { status: "open" },
      { summary: "raw provider prose" },
      { severity: "medium" },
      { transition: "containment_failed" },
      { incidentVersion: 0 },
    ])
      expect(() => npRequireAgentIncidentNotificationsV1(page([{ ...item, ...change }]))).toThrow();
    expect(() => npRequireAgentIncidentNotificationsV1({ ...page(), total: 100 })).toThrow();
    expect(() => npRequireAgentIncidentNotificationsV1(page([item, { ...item }]))).toThrow();
    expect(() =>
      npRequireAgentIncidentNotificationsV1(page(Array.from({ length: 21 }, () => ({ ...item })))),
    ).toThrow();
  });
});
