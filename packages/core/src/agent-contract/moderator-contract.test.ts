import { describe, expect, it } from "vitest";
import { npRequireAgentJsonSchema } from "./contract.js";
import {
  npAgentContainmentCreateOutputSchemaV1,
  npAgentContainmentRestoreOutputSchemaV1,
  npAgentDirectActionApprovalRequiredSchemaV1,
  npAgentQuarantineInputSchemaV1,
  npAgentRestoreInputSchemaV1,
  npRequireAgentContainmentCreateOutputV1,
  npRequireAgentContainmentRestoreOutputV1,
  npRequireAgentQuarantineInputV1,
  npRequireAgentRestoreInputV1,
  npRequireAgentModeratorFeedbackLabelV1,
} from "./moderator-contract.js";
const id = "00000000-0000-4000-8000-000000000001";
const digest = `cj1:sha256:${"A".repeat(43)}`;
const proposal = {
  incidentId: null,
  target: { kind: "comment", collection: "posts", id },
  expectedVersionDigest: digest,
  reasonCode: "REPEATED_LINK",
};
describe("Moderator direct action boundaries", () => {
  it("accepts detached proposals and rejects target substitution in approved execution", () => {
    expect(npRequireAgentQuarantineInputV1({ mode: "propose", proposal })).toEqual({
      mode: "propose",
      proposal,
    });
    const approved = {
      mode: "execute_approved",
      actionId: id,
      approvalId: id,
      proposalHash: digest,
    };
    expect(npRequireAgentQuarantineInputV1(approved)).toEqual(approved);
    expect(npRequireAgentRestoreInputV1(approved)).toEqual(approved);
    expect(() => npRequireAgentQuarantineInputV1({ ...approved, proposal })).toThrow();
    expect(() =>
      npRequireAgentQuarantineInputV1({
        mode: "propose",
        proposal: { ...proposal, authorized: true },
      }),
    ).toThrow();
    expect(() =>
      npRequireAgentRestoreInputV1({
        mode: "propose",
        proposal: {
          containmentKind: "actor_restriction",
          containmentId: id,
          expectedVersionDigest: digest,
        },
      }),
    ).toThrow();
    const getter = {
      get mode() {
        throw new Error("must not run");
      },
    };
    expect(() => npRequireAgentQuarantineInputV1(getter)).toThrow();
  });
  it("requires exact restoration handles and bounded verification evidence", () => {
    const output = {
      schemaVersion: "np.agent-direct-action.v1",
      actionId: id,
      resultDigest: digest,
      verificationRefs: [id],
      state: "succeeded",
      containmentId: id,
    };
    expect(npRequireAgentContainmentCreateOutputV1(output)).toEqual(output);
    expect(
      npRequireAgentContainmentCreateOutputV1({ ...output, state: "failed", containmentId: null })
        .containmentId,
    ).toBeNull();
    expect(
      npRequireAgentContainmentRestoreOutputV1({ ...output, state: "compensated" }).state,
    ).toBe("compensated");
    expect(() =>
      npRequireAgentContainmentRestoreOutputV1({ ...output, state: "failed", containmentId: null }),
    ).toThrow();
    expect(() =>
      npRequireAgentContainmentCreateOutputV1({ ...output, containmentId: null }),
    ).toThrow();
    expect(() =>
      npRequireAgentContainmentCreateOutputV1({ ...output, verificationRefs: [id, id] }),
    ).toThrow();
    expect(npRequireAgentModeratorFeedbackLabelV1("false-positive")).toBe("false-positive");
    expect(() => npRequireAgentModeratorFeedbackLabelV1("ban-member")).toThrow();
  });
  it("publishes detached exact discovery schemas", () => {
    for (const factory of [
      npAgentQuarantineInputSchemaV1,
      npAgentRestoreInputSchemaV1,
      npAgentContainmentCreateOutputSchemaV1,
      npAgentContainmentRestoreOutputSchemaV1,
      npAgentDirectActionApprovalRequiredSchemaV1,
    ]) {
      expect(npRequireAgentJsonSchema(factory())).toEqual(factory());
      const first = factory();
      first.description = "mutation";
      expect(factory()).not.toHaveProperty("description");
    }
  });
});
