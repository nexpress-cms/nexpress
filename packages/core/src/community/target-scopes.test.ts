import { describe, expect, it } from "vitest";

import type { NpCollectionConfig } from "../config/types.js";
import {
  npIsMemberModeratableDocument,
  npProjectDocumentCommunityScopes,
} from "./target-scopes.js";

const config: NpCollectionConfig = {
  slug: "forum-posts",
  labels: { singular: "Forum post", plural: "Forum posts" },
  fields: [],
  community: {
    moderation: {
      categoryField: "board",
      hiddenField: "moderationHidden",
      lockField: "locked",
      pinField: "pinned",
    },
  },
};

describe("document community scope projection", () => {
  it("projects thread, category, and collection scopes in specificity order", () => {
    expect(
      npProjectDocumentCommunityScopes(config, {
        id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
        board: "815e8881-69e1-4311-ae51-bc52129a7cf4",
      }),
    ).toEqual([
      { type: "thread", id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e" },
      { type: "category", id: "815e8881-69e1-4311-ae51-bc52129a7cf4" },
      { type: "collection", id: "forum-posts" },
    ]);
  });

  it("accepts hydrated relationship objects and fails closed on missing ids", () => {
    expect(
      npProjectDocumentCommunityScopes(config, {
        id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
        board: { id: "815e8881-69e1-4311-ae51-bc52129a7cf4", name: "Free" },
      })[1],
    ).toEqual({ type: "category", id: "815e8881-69e1-4311-ae51-bc52129a7cf4" });
    expect(() =>
      npProjectDocumentCommunityScopes(config, {
        id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
        board: null,
      }),
    ).toThrow("Invalid community scope projection");
  });

  it("keeps initial staff drafts outside member moderation", () => {
    expect(
      npIsMemberModeratableDocument(config, {
        status: "pending",
        visibility: "public",
        memberAuthorId: null,
        moderationHidden: false,
      }),
    ).toBe(false);
    expect(
      npIsMemberModeratableDocument(config, {
        status: "pending",
        visibility: "public",
        memberAuthorId: null,
        moderationHidden: true,
      }),
    ).toBe(true);
  });
});
