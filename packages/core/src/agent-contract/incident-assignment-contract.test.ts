import { describe, expect, it } from "vitest";
import {
  npRequireAgentIncidentAssignmentInputV1,
  npRequireAgentIncidentAssignmentV1,
  npRequireAgentIncidentAssignmentEntryV1,
} from "./incident-assignment-contract.js";
const agentId = "00000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: "np.agent-incident-assignment-input.v1",
  expectedVersion: 1,
  agentId,
  idempotencyKey: "assignment-1",
};
const candidate = { id: agentId, name: "Configured observer", status: "paused" };
const view = {
  schemaVersion: "np.agent-incident-assignment.v1",
  incidentId: "00000000-0000-4000-8000-000000000002",
  incidentVersion: 2,
  assignedAgentId: agentId,
  current: { ...candidate, eligible: true },
  candidates: [candidate],
  canAssign: true,
};
describe("Incident assignment pure boundary", () => {
  it("retains explicit nullable assignment and rejects unbounded or authority-bearing commands", () => {
    expect(npRequireAgentIncidentAssignmentInputV1(command)).toEqual(command);
    expect(
      npRequireAgentIncidentAssignmentInputV1({ ...command, agentId: null }).agentId,
    ).toBeNull();
    for (const patch of [
      { agentId: "foreign" },
      { expectedVersion: 0 },
      { expectedVersion: 2147483647 },
      { idempotencyKey: " whitespace" },
      { activate: true },
      { siteId: "other" },
      { capabilities: ["admin.manage"] },
    ])
      expect(() => npRequireAgentIncidentAssignmentInputV1({ ...command, ...patch })).toThrow();
  });
  it("keeps unavailable assigned identities and read-only terminal projections while rejecting private or inconsistent evidence", () => {
    expect(npRequireAgentIncidentAssignmentV1(view)).toEqual(view);
    expect(
      npRequireAgentIncidentAssignmentV1({
        ...view,
        current: null,
        candidates: [],
        canAssign: false,
      }),
    ).toMatchObject({ assignedAgentId: agentId, current: null, canAssign: false });
    for (const patch of [
      { current: { ...view.current, principalId: agentId } },
      { assignedAgentId: null },
      { candidates: [] },
      { current: { ...view.current, eligible: false } },
      { candidates: [candidate, { ...candidate }] },
      { candidates: Array.from({ length: 101 }, () => ({ ...candidate })) },
      { canAssign: "true" },
      { incidentVersion: 0 },
    ])
      expect(() => npRequireAgentIncidentAssignmentV1({ ...view, ...patch })).toThrow();
  });
  it("records only a genuine from/to identity change", () => {
    expect(
      npRequireAgentIncidentAssignmentEntryV1({ fromAgentId: null, toAgentId: agentId }),
    ).toEqual({ fromAgentId: null, toAgentId: agentId });
    for (const value of [
      { fromAgentId: null, toAgentId: null },
      { fromAgentId: agentId, toAgentId: agentId },
      { fromAgentId: null, toAgentId: agentId, note: "private" },
    ])
      expect(() => npRequireAgentIncidentAssignmentEntryV1(value)).toThrow();
  });
});
