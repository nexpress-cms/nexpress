import { describe, expect, it } from "vitest";
import type {
  NpAgentRecipeDefinitionCanonicalV1,
  NpAgentJsonObject,
  NpAgentJsonSchema,
} from "./types.js";
import {
  npDigestAgentRuntimeManualInputV1,
  npIsAgentRuntimeManualRecipeSupportedV1,
  npRequireAgentRuntimeManualInputV1,
} from "./runtime-manual-input.js";
const schema: NpAgentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    topic: { type: "string", maxLength: 2000 },
    count: { type: "integer", minimum: 1, maximum: 3 },
    include: { type: "boolean" },
  },
  required: ["topic"],
};
const recipe: NpAgentRecipeDefinitionCanonicalV1 = {
  id: "publisher.stale-content",
  version: 1,
  allowedTemplates: ["publisher"],
  task: "interactive-capability",
  providerMode: "required",
  triggerKinds: ["manual"],
  capabilityIds: ["content.query"],
  settingsSchema: schema,
  manualInputSchema: schema,
  responseSchema: schema,
  instruction: {
    templateId: "test",
    templateVersion: 1,
    digest: `cj1:sha256:${"A".repeat(43)}`,
    text: "Read evidence.",
  },
};
describe("bounded manual input", () => {
  it("preserves schema-null eligibility and requires actual provider consumption for structured recipes", () => {
    expect(npIsAgentRuntimeManualRecipeSupportedV1(recipe)).toBe(true);
    expect(npIsAgentRuntimeManualRecipeSupportedV1({ ...recipe, providerMode: "forbidden" })).toBe(
      false,
    );
    expect(
      npIsAgentRuntimeManualRecipeSupportedV1({
        ...recipe,
        providerMode: "forbidden",
        manualInputSchema: null,
      }),
    ).toBe(true);
    expect(npIsAgentRuntimeManualRecipeSupportedV1({ ...recipe, instruction: null })).toBe(false);
    for (const properties of [
      { prompt: { type: "string", maxLength: 20 } },
      { topic: { type: "array" } },
      { topic: { type: "string" } },
    ] as NpAgentJsonObject[]) {
      expect(
        npIsAgentRuntimeManualRecipeSupportedV1({
          ...recipe,
          manualInputSchema: { ...schema, properties, required: [] },
        }),
      ).toBe(false);
    }
  });
  it("requires exact scalar values, required fields, integer bounds and byte limits", () => {
    expect(
      npRequireAgentRuntimeManualInputV1(recipe, { topic: "hello", count: 2, include: false }),
    ).toEqual({ topic: "hello", count: 2, include: false });
    for (const input of [
      {},
      { topic: "ok", extra: 1 },
      { topic: "ok", count: "2" },
      { topic: "ok", count: 4 },
      { topic: "ok", count: 1.5 },
      { topic: "x".repeat(2001) },
      { topic: [] },
    ])
      expect(() => npRequireAgentRuntimeManualInputV1(recipe, input)).toThrow();
    const large = {
      ...recipe,
      manualInputSchema: {
        ...schema,
        properties: {
          a: { type: "string", maxLength: 2000 },
          b: { type: "string", maxLength: 2000 },
        },
        required: [],
      },
    };
    expect(() =>
      npRequireAgentRuntimeManualInputV1(large, { a: "한".repeat(2000), b: "한".repeat(2000) }),
    ).toThrow();
  });
  it("binds canonical scalar values regardless of key order and rejects nested retained payloads", async () => {
    expect(await npDigestAgentRuntimeManualInputV1({ topic: "a", count: 1 })).toBe(
      await npDigestAgentRuntimeManualInputV1({ count: 1, topic: "a" }),
    );
    expect(await npDigestAgentRuntimeManualInputV1({ topic: "b" })).not.toBe(
      await npDigestAgentRuntimeManualInputV1({ topic: "a" }),
    );
    await expect(npDigestAgentRuntimeManualInputV1({ topic: {} })).rejects.toThrow();
  });
});
