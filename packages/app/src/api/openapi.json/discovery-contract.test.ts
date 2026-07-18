import { describe, expect, it, vi } from "vitest";
import { npBlockPropFieldTypes } from "@nexpress/blocks/contracts";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI public discovery contracts", () => {
  it("references closed shared schemas from all public discovery routes", () => {
    const spec = buildSpec() as {
      paths: Record<string, { get: { security?: unknown[]; responses: Record<string, unknown> } }>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    for (const [path, schema] of [
      ["/api/meta/blocks", "block_discovery_response"],
      ["/api/meta/collections", "collection_discovery_response"],
      ["/api/meta/plugins", "plugin_discovery_response"],
    ] as const) {
      const operation = spec.paths[path]?.get;
      expect(operation?.security).toEqual([]);
      expect(operation?.responses).toMatchObject({
        "200": {
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
        },
      });
      expect(spec.components.schemas[schema]).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["items"],
      });
    }

    for (const schema of [
      "block_discovery_item",
      "collection_discovery_item",
      "collection_discovery_field",
      "plugin_discovery_item",
    ]) {
      expect(spec.components.schemas[schema]).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }

    const propField = spec.components.schemas.block_discovery_prop_field as {
      type: string;
      discriminator: { propertyName: string };
      oneOf: Array<{ additionalProperties: boolean; properties: { type: { const: string } } }>;
    };
    expect(propField).toMatchObject({
      type: "object",
      discriminator: { propertyName: "type" },
    });
    expect(propField.oneOf).toHaveLength(npBlockPropFieldTypes.length);
    expect(propField.oneOf.every((variant) => variant.additionalProperties === false)).toBe(true);
    expect(propField.oneOf.map((variant) => variant.properties.type.const)).toEqual([
      ...npBlockPropFieldTypes,
    ]);
    expect(
      propField.oneOf.find((variant) => variant.properties.type.const === "richtext")?.properties,
    ).toMatchObject({
      defaultValue: { $ref: "#/components/schemas/block_discovery_rich_text_content" },
    });
  });
});
