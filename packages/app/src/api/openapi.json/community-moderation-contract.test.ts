import { defineCollection, registerCollection } from "@nexpress/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/init-core", () => ({ ensureFor: vi.fn(() => Promise.resolve()) }));

import { buildSpec } from "./route.js";

describe("OpenAPI scoped community moderation contract", () => {
  it("publishes only declared thread moderation and member report resolution routes", () => {
    const config = defineCollection({
      slug: "moderated-threads",
      labels: { singular: "Thread", plural: "Threads" },
      versions: { drafts: true },
      community: {
        moderation: {
          categoryField: "board",
          hiddenField: "moderationHidden",
          lockField: "locked",
        },
        memberWrite: { update: true, delete: true, writableFields: ["title"] },
      },
      fields: [
        { type: "relationship", name: "board", relationTo: "boards", required: true },
        { type: "text", name: "title", required: true },
        {
          type: "checkbox",
          name: "moderationHidden",
          required: true,
          defaultValue: false,
        },
        { type: "checkbox", name: "locked", defaultValue: false },
      ],
    });
    registerCollection(config.slug, {}, config);
    const spec = buildSpec() as { paths: Record<string, Record<string, unknown>> };

    expect(spec.paths["/api/collections/moderated-threads/{id}/moderation"]?.post).toMatchObject({
      requestBody: {
        content: {
          "application/json": {
            schema: {
              additionalProperties: false,
              required: ["action"],
              properties: {
                action: { enum: ["hide", "restore", "lock", "unlock", "pin", "unpin"] },
              },
            },
          },
        },
      },
    });
    expect(spec.paths["/api/reports/{id}/resolve"]?.post).toMatchObject({
      responses: { "403": expect.any(Object) },
    });
  });
});
