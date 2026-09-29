import { expect, it } from "vitest";
import {
  npRequireAgentIncidentSeverityInputV1,
  npRequireAgentIncidentSeverityChangeV1,
} from "./incident-severity-contract.js";
import { npRequireAgentIncidentNotificationsV1 } from "./incident-notifications-contract.js";
const command = {
  schemaVersion: "np.agent-incident-severity-input.v1",
  expectedVersion: 1,
  severity: "high",
  note: "Reviewed source evidence.",
  idempotencyKey: "staff-review",
};
it("accepts bounded manual escalation commands and strictly increasing judgments", () => {
  expect(npRequireAgentIncidentSeverityInputV1(command)).toEqual(command);
  for (const change of [
    { severity: "info" },
    { note: " " },
    { note: "Raw\u0000note" },
    { expectedVersion: 2147483647 },
    { source: "model" },
    { idempotencyKey: "bad key" },
  ])
    expect(() => npRequireAgentIncidentSeverityInputV1({ ...command, ...change })).toThrow();
  expect(
    npRequireAgentIncidentSeverityChangeV1({
      fromSeverity: "medium",
      toSeverity: "high",
      note: command.note,
    }),
  ).toEqual({ fromSeverity: "medium", toSeverity: "high", note: command.note });
  for (const toSeverity of ["low", "medium"])
    expect(() =>
      npRequireAgentIncidentSeverityChangeV1({
        fromSeverity: "medium",
        toSeverity,
        note: command.note,
      }),
    ).toThrow();
});
it("keeps escalation notifications separate from status transitions and private judgment notes", () => {
  const id = "018f0f30-cd7b-7cc2-8b16-8c052c259bd1";
  const item = {
    notificationId: id,
    incidentId: id,
    incidentVersion: 2,
    transition: "escalated",
    severity: "high",
    status: "investigating",
    summary: "Incident severity escalated.",
    adminPath: `/admin/agents/incidents/${id}`,
    createdAt: "2026-09-29T00:00:00.000Z",
  };
  const page = {
    schemaVersion: "np.agent-incident-notifications.v1",
    items: [item],
    nextCursor: null,
  };
  expect(npRequireAgentIncidentNotificationsV1(page).items[0]).toEqual(item);
  for (const change of [
    { severity: "low" },
    { status: "resolved" },
    { status: "dismissed" },
    { note: command.note },
    { summary: command.note },
  ])
    expect(() =>
      npRequireAgentIncidentNotificationsV1({ ...page, items: [{ ...item, ...change }] }),
    ).toThrow();
});
