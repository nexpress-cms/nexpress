import { describe, expect, it } from "vitest";
import { npGetAgentAdminOperationV1 } from "./admin-operation-registry.js";
import {
  npAgentRuntimeAdminOperationIdsV1,
  npAnalyzeAgentRuntimeAdminInputV1,
  npRequireAgentRuntimeAdminInputV1,
  npRequireAgentRuntimeDefinitionJsonV1,
  npSerializeAgentRuntimeDefinitionV1,
} from "./runtime-admin-contract.js";
import {
  npCreateDisabledAgentRuntimeSettingsV1,
  npCreateInheritedAgentBudgetV1,
} from "./runtime-contract.js";

const digest = `cj1:sha256:${"A".repeat(43)}`;
const fields: Record<string, unknown> = {
  idempotencyKey: "runtime-operation",
  definitionJson: "{}",
  definitionHash: digest,
  expectedVersion: 1,
  configHash: digest,
  reason: "Operator action",
  inputJson: "{}",
  triggerId: "manual",
  fixtureJson: "{}",
  fixtureHash: digest,
};

describe("Runtime Admin owner parsers", () => {
  it("derives each exact envelope from the existing 55-operation registry", () => {
    expect(npAgentRuntimeAdminOperationIdsV1).toHaveLength(15);
    for (const id of npAgentRuntimeAdminOperationIdsV1) {
      const required = npGetAgentAdminOperationV1(id).schemas.input.schema.required;
      if (
        !Array.isArray(required) ||
        !required.every((key): key is string => typeof key === "string")
      )
        throw new Error("Expected exact input schema");
      const input = Object.fromEntries(required.map((key) => [key, fields[key]]));
      expect(npRequireAgentRuntimeAdminInputV1(id, input)).toEqual(input);
      expect(npAnalyzeAgentRuntimeAdminInputV1(id, { ...input, siteId: "foreign" }).ok).toBe(false);
      expect(npAnalyzeAgentRuntimeAdminInputV1(id, { ...input, idempotencyKey: "" }).ok).toBe(
        false,
      );
    }
  });

  it("keeps budget updates limited to the existing budget body", () => {
    const budget = npCreateInheritedAgentBudgetV1();
    const encoded = npSerializeAgentRuntimeDefinitionV1("budget", budget);
    expect(npRequireAgentRuntimeDefinitionJsonV1("budget", encoded)).toEqual(budget);
    expect(() =>
      npRequireAgentRuntimeDefinitionJsonV1(
        "budget",
        JSON.stringify(npCreateDisabledAgentRuntimeSettingsV1()),
      ),
    ).toThrow();
    expect(() =>
      npRequireAgentRuntimeDefinitionJsonV1("budget", JSON.stringify({ ...budget, enabled: true })),
    ).toThrow();
  });

  it("normalizes bounded definitions without accepting unknown fields or claimed hashes", () => {
    const definition = {
      schemaVersion: "np.agent-policy-definition.v1" as const,
      agentId: null,
      name: "Policy",
      instructions: "Keep evidence separate.",
      rules: npCreateDisabledAgentRuntimeSettingsV1().defaultPolicyRules,
    };
    const encoded = npSerializeAgentRuntimeDefinitionV1("policy", definition);
    expect(npRequireAgentRuntimeDefinitionJsonV1("policy", encoded)).toEqual(definition);
    expect(() => npRequireAgentRuntimeDefinitionJsonV1("policy", "{")).toThrow();
    expect(() =>
      npRequireAgentRuntimeDefinitionJsonV1(
        "policy",
        JSON.stringify({ ...definition, configHash: digest }),
      ),
    ).toThrow();
    expect(
      npAnalyzeAgentRuntimeAdminInputV1("agents.configurations.activate", {
        idempotencyKey: "x",
        expectedVersion: 0,
        configHash: digest,
      }).ok,
    ).toBe(false);
    expect(
      npAnalyzeAgentRuntimeAdminInputV1("agents.runtime.pause", {
        idempotencyKey: "x",
        expectedVersion: 1,
        reason: "pause",
        token: "extra",
      }).ok,
    ).toBe(false);
  });

  it("rejects hostile input objects without invoking getters", () => {
    let reads = 0;
    const value = { idempotencyKey: "x", expectedVersion: 1, reason: "pause" };
    Object.defineProperty(value, "reason", {
      enumerable: true,
      get() {
        reads += 1;
        return "pause";
      },
    });
    expect(npAnalyzeAgentRuntimeAdminInputV1("agents.runtime.pause", value).ok).toBe(false);
    expect(reads).toBe(0);
  });
});
