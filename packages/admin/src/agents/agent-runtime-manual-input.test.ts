import { describe, expect, it } from "vitest";
import type { NpAgentRuntimeManualSchemaV1 } from "@nexpress/core/agent-contract";
import { runtimeManualInput } from "./agent-runtime-manual-input.js";
const schema: NpAgentRuntimeManualSchemaV1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    topic: { type: "string", maxLength: 2000 },
    note: { type: "string", maxLength: 2000 },
    choice: { type: "string", maxLength: 20, enum: ["", "other"] },
    count: { type: "integer", minimum: 0, maximum: 3 },
    include: { type: "boolean" },
  },
  required: ["topic", "choice"],
};
describe("Runtime manual form input", () => {
  it("includes untouched required free text as empty while omitting untouched optional and enum fields", () => {
    expect(runtimeManualInput(schema, {})).toEqual({ topic: "" });
    expect(runtimeManualInput(schema, { note: "", choice: "" })).toEqual({
      topic: "",
      note: "",
      choice: "",
    });
  });
  it("preserves exact text, false and zero while clearing an optional number omits it", () => {
    expect(
      runtimeManualInput(schema, { topic: "  evidence  ", count: "0", include: "false" }),
    ).toEqual({ topic: "  evidence  ", count: 0, include: false });
    expect(runtimeManualInput(schema, { count: "" })).toEqual({ topic: "" });
  });
});
