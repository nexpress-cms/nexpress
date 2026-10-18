import { describe, expect, it } from "vitest";
import {
  npGuardianResponseCapabilityDefinitionV1,
  npGuardianAutomaticResponseCapabilityDefinitionV1,
} from "./guardian-response-capability.js";

describe("Guardian response definition authority floors", () => {
  it("preserves the pre-automatic manual definition fingerprints and human floors", async () => {
    // Computed from the committed pre-change owner against built pure contracts.
    const expected = {
      "security.limitActor": "cj1:sha256:prr2npu6ahFVqLW29RozcoXKs2yXdqwB9936wq7iRLw",
      "security.removeActorLimit": "cj1:sha256:L_U8OQOIFoc3RCp3LcXZ_6N8ilK8m3NeGC0TdMwmTnQ",
    };
    for (const id of ["security.limitActor", "security.removeActorLimit"] as const) {
      const definition = await npGuardianResponseCapabilityDefinitionV1(id);
      expect(definition.fingerprint).toBe(expected[id]);
      expect(definition.descriptor).toMatchObject({
        risk: "sensitive",
        approval: "human",
        gateway: null,
      });
    }
  });
  it("uses a distinct private policy definition with a frozen compensator", async () => {
    const automatic = await npGuardianAutomaticResponseCapabilityDefinitionV1();
    const manual = await npGuardianResponseCapabilityDefinitionV1("security.limitActor");
    expect(automatic.fingerprint).not.toBe(manual.fingerprint);
    expect(automatic.descriptor).toMatchObject({
      risk: "reversible",
      approval: "policy",
      gateway: null,
    });
    expect(automatic.canonical.capabilities[0].effectProfiles).toMatchObject([
      { reversibility: "compensatable", compensatorId: "guardian.limit.remove.v1" },
    ]);
  });
});
