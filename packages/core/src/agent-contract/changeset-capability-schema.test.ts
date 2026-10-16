import { describe, expect, it } from "vitest";
import { npRequireAgentProviderSchemaValueV1 } from "../agent/provider-auth-contract.js";
import { npCompactAgentWireSchemaV1 } from "./changeset-capability-schema.js";
import type { NpAgentJsonObject, NpAgentJsonSchema } from "./types.js";

const dialect = "https://json-schema.org/draft/2020-12/schema";

describe("composed approval schema compaction", () => {
  it("factors beneficial short constraints while preserving expanded structure and leaving tiny constants inline", () => {
    const short = () => ({ type: "string", maxLength: 1 });
    const source: NpAgentJsonSchema = {
      $schema: dialect,
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Array.from({ length: 12 }, (_, index): [string, NpAgentJsonObject] => [
          `item${index}`,
          index < 4 ? { enum: ["a", "b"] } : index < 8 ? short() : { const: "x" },
        ]),
      ),
      required: [],
    };
    const compacted = npCompactAgentWireSchemaV1(source, {
      factorShortConstraints: true,
      inlineSingleUseDefinitions: true,
    });
    expect(JSON.stringify(npCompactAgentWireSchemaV1(source))).toBe(
      JSON.stringify({ ...source, $defs: {} }),
    );
    const definitions = compacted.$defs;
    if (!definitions || typeof definitions !== "object" || Array.isArray(definitions))
      throw new Error("Expected shared definitions");
    function expand(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(expand);
      if (!value || typeof value !== "object") return value;
      const row = value as Record<string, unknown>;
      if (typeof row.$ref === "string")
        return expand((definitions as Record<string, unknown>)[row.$ref.slice("#/$defs/".length)]);
      return Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => key !== "$defs")
          .map(([key, child]) => [key, expand(child)]),
      );
    }
    const nodes = (value: unknown): number =>
      !value || typeof value !== "object"
        ? 1
        : 1 + Object.values(value).reduce<number>((sum, child) => sum + 1 + nodes(child), 0);
    expect(expand(compacted)).toEqual(source);
    expect(nodes(compacted)).toBeLessThan(nodes(source));
    expect(Object.values(definitions)).not.toContainEqual({ const: "x" });
    npRequireAgentProviderSchemaValueV1(compacted, { item0: "a", item8: "x" });
    expect(() => npRequireAgentProviderSchemaValueV1(compacted, { item0: "c" })).toThrow();
    expect(() => npRequireAgentProviderSchemaValueV1(compacted, { item4: "ab" })).toThrow();
    expect(() => npRequireAgentProviderSchemaValueV1(compacted, { item8: "a" })).toThrow();
  });
  it("inlines only exact noncyclic single-use definitions and respects the existing depth bound", () => {
    const source: NpAgentJsonSchema = {
      $schema: dialect,
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        first: { $ref: "#/$defs/once" },
        second: { $ref: "#/$defs/shared" },
        third: { $ref: "#/$defs/shared" },
        cycle: { $ref: "#/$defs/cycle" },
      },
      $defs: {
        once: { type: "string", maxLength: 8 },
        shared: { type: "integer", minimum: 1 },
        cycle: {
          type: "object",
          additionalProperties: false,
          properties: { next: { $ref: "#/$defs/cycle" } },
          required: [],
        },
      },
    };
    const compacted = npCompactAgentWireSchemaV1(source, { inlineSingleUseDefinitions: true });
    expect(compacted.$defs).not.toHaveProperty("once");
    expect(compacted.$defs).toHaveProperty("shared");
    expect(compacted.$defs).toHaveProperty("cycle");
    expect(compacted.properties).toMatchObject({
      first: { type: "string", maxLength: 8 },
      second: { $ref: "#/$defs/shared" },
      third: { $ref: "#/$defs/shared" },
      cycle: { $ref: "#/$defs/cycle" },
    });
    let nested: Record<string, unknown> = { $ref: "#/$defs/leaf" };
    for (let index = 0; index < 6; index++)
      nested = {
        type: "object",
        additionalProperties: false,
        properties: { child: nested },
        required: [],
      };
    const deep = JSON.parse(
      JSON.stringify({
        $schema: dialect,
        type: "object",
        additionalProperties: false,
        properties: { nested },
        required: [],
        $defs: {
          leaf: {
            type: "object",
            additionalProperties: false,
            properties: { value: { type: "string", maxLength: 8 } },
            required: [],
          },
        },
      }),
    ) as NpAgentJsonSchema;
    const bounded = npCompactAgentWireSchemaV1(deep, { inlineSingleUseDefinitions: true });
    expect(bounded.$defs).toHaveProperty("leaf");
  });
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
