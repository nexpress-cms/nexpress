import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI community engagement contract", () => {
  it("publishes exact reaction, view, and report contracts", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(spec.paths["/api/reactions"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId"],
              properties: {
                targetType: {
                  maxLength: 63,
                  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                },
                targetId: { format: "uuid" },
                kind: { pattern: "^[a-z][a-z0-9_-]{0,29}$" },
              },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/views"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId"],
              properties: {
                targetType: { maxLength: 63 },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["counted", "viewCount"],
              },
            },
          },
        },
        "429": {},
      },
    });
    expect(spec.paths["/api/reports"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["targetType", "targetId", "reason"],
              properties: {
                targetType: {
                  maxLength: 63,
                  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
                },
                targetId: { format: "uuid" },
                reason: { minLength: 1, maxLength: 1000 },
              },
            },
          },
        },
      },
      responses: {
        "201": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_report_row" },
            },
          },
        },
        "409": {},
      },
    });
    expect(spec.paths["/api/admin/community/reports/{id}/resolve"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["action"],
              properties: {
                action: {
                  enum: ["dismiss", "hide-comment", "unpublish-document"],
                },
              },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/admin/community/reports"]?.get).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_moderation_report_page" },
            },
          },
        },
      },
    });
    expect(spec.components.schemas.community_moderation_report_row).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["id", "targetType", "resolution", "target"]),
      properties: {
        target: { $ref: "#/components/schemas/community_report_target_context" },
      },
    });
  });
});
