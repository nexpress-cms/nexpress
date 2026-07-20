import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI public member profile activity contract", () => {
  it("publishes exact profile, discriminated activity, and bounded page schemas", () => {
    const spec = buildSpec() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };

    expect(spec.paths["/api/members/{handle}"]?.get).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_public_member_profile" },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/members/{handle}/activity"]?.get).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_member_profile_activity_page" },
            },
          },
        },
      },
    });

    for (const name of [
      "community_public_member_profile",
      "community_member_profile_document_activity",
      "community_member_profile_comment_activity",
      "community_member_profile_activity_page",
    ]) {
      expect(spec.components.schemas[name]).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(spec.components.schemas.community_member_profile_activity_page).toMatchObject({
      required: [
        "kind",
        "items",
        "totalDocs",
        "totalPages",
        "page",
        "limit",
        "hasNextPage",
        "hasPrevPage",
      ],
      properties: {
        kind: { enum: ["documents", "comments"] },
        items: {
          maxItems: 50,
          items: {
            oneOf: [
              { $ref: "#/components/schemas/community_member_profile_document_activity" },
              { $ref: "#/components/schemas/community_member_profile_comment_activity" },
            ],
          },
        },
        limit: { minimum: 1, maximum: 50 },
      },
      allOf: [
        {
          if: { properties: { kind: { const: "documents" } } },
          then: {
            properties: {
              items: {
                items: {
                  $ref: "#/components/schemas/community_member_profile_document_activity",
                },
              },
            },
          },
        },
        {
          if: { properties: { kind: { const: "comments" } } },
          then: {
            properties: {
              items: {
                items: {
                  $ref: "#/components/schemas/community_member_profile_comment_activity",
                },
              },
            },
          },
        },
      ],
    });
  });
});
