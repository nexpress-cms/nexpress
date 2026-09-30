import { describe, expect, it } from "vitest";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { npCompactAgentWireSchemaV1 } from "./changeset-capability-schema.js";
import type { NpAgentJsonSchema } from "./types.js";

const dialect = "https://json-schema.org/draft/2020-12/schema";

describe("composed approval schema compaction", () => {
  it("preserves closed nested constraints through shared parents and transitive aliases", () => {
    const child = { type: "string", minLength: 2, maxLength: 12, pattern: "^[a-z]+$" };
    const parent = {
      $schema: dialect,
      type: "object",
      additionalProperties: false,
      properties: { name: child },
      required: ["name"],
    };
    const source: NpAgentJsonSchema = JSON.parse(
      JSON.stringify({
        $schema: dialect,
        type: "object",
        additionalProperties: false,
        properties: {
          first: parent,
          second: Object.fromEntries(Object.entries(parent).reverse()),
          third: { $ref: "#/$defs/alias" },
        },
        required: ["first", "second", "third"],
        $defs: { alias: { $ref: "#/$defs/parent" }, parent, unused: { type: "boolean" } },
      }),
    ) as NpAgentJsonSchema;
    const original = JSON.stringify(source);
    const compacted = npCompactAgentWireSchemaV1(source);
    expect(JSON.stringify(source)).toBe(original);
    expect(compacted.$defs).not.toHaveProperty("unused");
    const valid = {
      first: { name: "first" },
      second: { name: "second" },
      third: { name: "third" },
    };
    npRequireAgentProviderSchemaValueV1(compacted, valid);
    for (const key of ["first", "second", "third"]) {
      for (const invalid of [
        { name: "a" },
        { name: "UPPER" },
        { name: "abcdefghijklmnop" },
        { name: "safe", hidden: "private" },
        {},
      ]) {
        expect(() =>
          npRequireAgentProviderSchemaValueV1(compacted, { ...valid, [key]: invalid }),
        ).toThrow();
      }
    }
    expect(() =>
      npRequireAgentProviderSchemaValueV1(compacted, { ...valid, siteId: "other" }),
    ).toThrow();
  });
});
