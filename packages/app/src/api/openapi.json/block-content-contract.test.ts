import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI block content contract", () => {
  it("publishes the exact recursive instance and responsive layout schemas", () => {
    const spec = buildSpec() as {
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(spec.components.schemas.block_instance).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "props"],
      properties: {
        layout: { $ref: "#/components/schemas/block_layout" },
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/block_instance" },
        },
      },
    });
    expect(spec.components.schemas.block_layout).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["colSpan"],
      properties: {
        colSpan: { type: "integer", minimum: 1, maximum: 12 },
        mdColSpan: { type: "integer", minimum: 1, maximum: 12 },
        lgColSpan: { type: "integer", minimum: 1, maximum: 12 },
      },
    });
  });
});
