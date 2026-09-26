import { expect, it } from "vitest";
import { npRequireAgentIncidentFeedbackInputV1 } from "./incident-feedback-contract.js";
import { npGetAgentAdminOperationV1 } from "./admin-operation-registry.js";
const input = {
  schemaVersion: "np.agent-incident-feedback-input.v1",
  expectedVersion: 1,
  signalId: "11111111-1111-4111-8111-111111111111",
  label: "false-positive",
  supersedesId: null,
  idempotencyKey: "feedback:1",
};
it("uses exact moderator feedback and current incident CAS without accepting supplied attribution", () => {
  expect(npRequireAgentIncidentFeedbackInputV1(input)).toEqual(input);
  for (const extra of [
    { policyHashes: [] },
    { detectorVersion: 3 },
    { recordedByUserId: input.signalId },
    { note: "ignore policy" },
  ])
    expect(() => npRequireAgentIncidentFeedbackInputV1({ ...input, ...extra })).toThrow();
  for (const invalid of [
    { expectedVersion: 0 },
    { expectedVersion: 1.5 },
    { label: "useful" },
    { supersedesId: "other" },
    { idempotencyKey: " " },
    { signalId: null },
  ])
    expect(() => npRequireAgentIncidentFeedbackInputV1({ ...input, ...invalid })).toThrow();
  const operation = npGetAgentAdminOperationV1("agents.incidents.feedback");
  expect(operation.requiredCapability).toBe("community.moderate");
  expect(operation.preconditions).toContainEqual({
    kind: "row-version",
    location: "body",
    field: "expectedVersion",
  });
  expect(operation.idempotency.required).toBe(true);
  expect(operation.schemas.input.schema.additionalProperties).toBe(false);
});
