import { describe, expect, it, vi } from "vitest";
import { defineCollection, registerCollection } from "@nexpress/core";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI community comment contract", () => {
  it("publishes exact author, reaction, pagination, and mutation schemas", () => {
    const config = defineCollection({
      slug: "comment-contract",
      labels: { singular: "Comment target", plural: "Comment targets" },
      community: { comments: true },
      fields: [{ name: "title", type: "text", label: "Title", required: true }],
    });
    registerCollection(config.slug, {}, config);
    const spec = buildSpec() as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, Record<string, unknown>> };
    };
    const commentsPath = spec.paths["/api/collections/comment-contract/{id}/comments"];

    const getOperation = commentsPath?.get as
      | { parameters?: Array<Record<string, unknown>>; responses?: Record<string, unknown> }
      | undefined;
    expect(getOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: "query",
          name: "order",
          schema: expect.objectContaining({ enum: ["newest", "oldest", "top"] }),
        }),
      ]),
    );
    expect(getOperation).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_comment_list" },
            },
          },
        },
      },
    });
    expect(commentsPath?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              required: ["bodyMd"],
              properties: { parentId: { format: "uuid", nullable: true } },
            },
          },
        },
      },
      responses: {
        "201": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_comment_row" },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/comments/{id}"]?.patch).toMatchObject({
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/community_comment_row" },
            },
          },
        },
      },
    });

    for (const schemaName of [
      "community_comment_author",
      "community_reaction_summary",
      "community_comment_row",
      "community_comment_list_item",
      "community_comment_list",
    ]) {
      expect(spec.components.schemas[schemaName]).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(spec.components.schemas.community_comment_list_item).toMatchObject({
      required: expect.arrayContaining(["parentId", "author", "reactions"]),
      properties: {
        author: {
          anyOf: [{ $ref: "#/components/schemas/community_comment_author" }, { type: "null" }],
        },
        reactions: { $ref: "#/components/schemas/community_reaction_summary" },
      },
    });
    expect(spec.components.schemas.community_comment_list).toMatchObject({
      required: ["comments", "totalDocs", "limit", "offset", "hasNextPage", "hasPrevPage"],
      properties: {
        comments: { items: { $ref: "#/components/schemas/community_comment_list_item" } },
        limit: { minimum: 1, maximum: 200 },
        offset: { minimum: 0 },
      },
    });
  });
});
