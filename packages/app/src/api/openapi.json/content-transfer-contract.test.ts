import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI content-transfer contract", () => {
  it("connects both routes to the exact closed v3 envelope and report", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };
    const schemas = spec.components.schemas;

    expect(schemas.content_transfer_envelope).toMatchObject({
      oneOf: [
        { $ref: "#/components/schemas/content_transfer_full_envelope" },
        { $ref: "#/components/schemas/content_transfer_partial_envelope" },
      ],
    });
    expect(schemas.content_transfer_full_envelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        version: { enum: ["3"] },
        partial: { enum: [false] },
        settings: { maxProperties: 1_000 },
      },
    });
    expect(schemas.content_transfer_partial_envelope).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: { partial: { enum: [true] } },
    });
    expect(schemas.content_transfer_import_report).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        imported: { $ref: "#/components/schemas/content_transfer_import_counts" },
      },
    });
    expect(schemas.content_transfer_plugin_state).toMatchObject({
      properties: {
        manifestVersion: {
          pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z-.]+)?(?:\\+[0-9A-Za-z-.]+)?$",
        },
      },
    });
    expect(spec.paths["/api/export"]).toMatchObject({
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/content_transfer_envelope" },
              },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/import"]).toMatchObject({
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/content_transfer_envelope" },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/content_transfer_import_report" },
              },
            },
          },
        },
      },
    });
  });
});
