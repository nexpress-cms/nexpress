import { describe, expect, it } from "vitest";

import { createForum, forumCollections, forumPlugin } from "./index.js";

describe("forum factory", () => {
  it("closes the default plugin over its board and post collections", () => {
    expect(forumCollections.map((collection) => collection.slug)).toEqual([
      "forum-boards",
      "forum-posts",
    ]);
    expect(forumPlugin.manifest.provides.collections).toEqual(["forum-boards", "forum-posts"]);
    expect(forumPlugin.pageRoutes?.map((route) => route.pattern)).toEqual([
      "/boards",
      "/boards/:boardKey/new",
      "/boards/:boardKey/:postId/edit",
      "/boards/:boardKey/:postId",
      "/boards/:boardKey",
    ]);
    expect(
      Object.entries(forumPlugin.actions ?? {}).map(([id, action]) => ({ id, kind: action.kind })),
    ).toEqual([{ id: "countForumPosts", kind: "metric" }]);
  });

  it("applies custom paths, collection slugs, and skins to every contract surface", () => {
    const compact = {
      id: "compact",
      label: "Compact",
      renderBoardIndex: () => null,
      renderPostList: () => null,
      renderPostDetail: () => null,
      renderPostComposer: () => null,
    };
    const forum = createForum({
      basePath: "/community/boards",
      collections: { boards: "community-boards", posts: "community-posts" },
      skins: [compact],
      defaultSkinId: "compact",
    });

    expect(forum.runtime.defaultSkinId).toBe("compact");
    expect(forum.plugin.pageRoutes?.[0]?.pattern).toBe("/community/boards");
    expect(forum.collections.map((collection) => collection.slug)).toEqual([
      "community-boards",
      "community-posts",
    ]);
    const boardRelation = forum.collections[1].fields.find(
      (field) => "name" in field && field.name === "board",
    );
    expect(boardRelation).toMatchObject({
      type: "relationship",
      relationTo: "community-boards",
    });
    const skinField = forum.collections[0].fields.find(
      (field) => "name" in field && field.name === "skin",
    );
    expect(skinField).toMatchObject({ defaultValue: "compact" });
  });

  it("defines an exact member-write boundary for forum posts", () => {
    const forum = createForum();
    expect(forum.collections[1].community?.memberWrite).toMatchObject({
      create: true,
      update: true,
      delete: true,
      writableFields: ["board", "title", "body", "category"],
    });
    expect(forum.collections[1].community?.memberWrite?.access?.create).toBeTypeOf("function");
    expect(forum.collections[1].community?.memberWrite?.access?.update).toBeTypeOf("function");
    expect(forum.collections[1].community?.memberWrite?.resolveCreateStatus).toBeTypeOf("function");
    expect(forum.collections[0].seo?.urlPath?.({ slug: "free" })).toBe("/boards/free");
    expect(
      forum.collections[1].seo?.urlPath?.({
        id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
        boardKey: "free",
      }),
    ).toBe("/boards/free/2d4af53e-6f78-43e0-8682-67f5a7d2b92e");
  });

  it("keeps published board URL keys immutable", () => {
    const forum = createForum();
    const beforeUpdate = forum.collections[0].hooks?.beforeUpdate?.[0];
    expect(beforeUpdate).toBeTypeOf("function");
    expect(() =>
      beforeUpdate?.({
        data: { key: "renamed", categories: [] },
        originalDoc: { key: "free" },
        user: null,
        principal: null,
        collection: "forum-boards",
      }),
    ).toThrow(/cannot be changed/u);
  });

  it("keeps existing board category keys stable while allowing labels to change", () => {
    const forum = createForum();
    const beforeUpdate = forum.collections[0].hooks?.beforeUpdate?.[0];
    expect(() =>
      beforeUpdate?.({
        data: { key: "free", categories: [{ key: "new", label: "신규" }] },
        originalDoc: { key: "free", categories: [{ key: "question", label: "질문" }] },
        user: null,
        principal: null,
        collection: "forum-boards",
      }),
    ).toThrow(/category keys cannot be removed/u);
    expect(() =>
      beforeUpdate?.({
        data: { key: "free", categories: [{ key: "question", label: "문의" }] },
        originalDoc: { key: "free", categories: [{ key: "question", label: "질문" }] },
        user: null,
        principal: null,
        collection: "forum-boards",
      }),
    ).not.toThrow();
  });

  it("rejects malformed paths and skin registries at definition time", () => {
    expect(() => createForum({ basePath: "/Boards" })).toThrow(/basePath/u);
    expect(() => createForum({ basePath: "/boards/" })).toThrow(/basePath/u);
    expect(() => createForum({ defaultSkinId: "missing" })).toThrow(/not registered/u);
    expect(() => createForum({ collections: { boards: "same", posts: "same" } })).toThrow(
      /must be different/u,
    );
    expect(() =>
      createForum({
        skins: [
          {
            id: "classic",
            label: "Duplicate",
            renderBoardIndex: () => null,
            renderPostList: () => null,
            renderPostDetail: () => null,
            renderPostComposer: () => null,
          },
        ],
      }),
    ).toThrow(/more than once/u);
    expect(() =>
      createForum({
        skins: [
          {
            id: "missing-composer",
            label: "Incomplete",
            renderBoardIndex: () => null,
            renderPostList: () => null,
            renderPostDetail: () => null,
          } as never,
        ],
      }),
    ).toThrow(/incomplete/u);
  });
});
