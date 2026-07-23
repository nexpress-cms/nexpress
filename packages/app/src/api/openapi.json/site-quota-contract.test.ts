import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI site quota contract", () => {
  it("connects the Admin route to exact limits and snapshot schemas", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(spec.components.schemas.site_quotas).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["storageBytes", "documents", "jobEnqueuesPerHour"],
      properties: {
        storageBytes: { type: ["integer", "null"], minimum: 0 },
        documents: { type: ["integer", "null"], minimum: 0 },
        jobEnqueuesPerHour: { type: ["integer", "null"], minimum: 0 },
      },
    });
    expect(spec.components.schemas.site_quota_snapshot).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["limits", "usage", "exceeded", "unavailable"],
    });
    expect(spec.paths["/api/admin/sites/{id}/quotas"]).toMatchObject({
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/site_quota_snapshot" },
              },
            },
          },
        },
      },
      patch: {
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/site_quotas" } },
          },
        },
      },
    });
  });
});
