import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI community engagement contract", () => {
  it("publishes exact document reaction and anonymous view request shapes", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
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
  });
});
