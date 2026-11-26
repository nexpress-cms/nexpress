import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as NextModule from "@nexpress/next";
import type * as NavigationModule from "next/navigation";
import type * as RuntimeModule from "./runtime.js";
import { createForum } from "./index.js";
import { createForumBuildRouteOwnerV1, npIsForumBuildRouteOwnerV1 } from "./build-route-owner.js";

const mocks = vi.hoisted(() => ({ member: vi.fn(), board: vi.fn(), context: vi.fn() }));
vi.mock("@nexpress/next", async (original) => ({
  ...(await original<typeof NextModule>()),
  getSiteMember: mocks.member,
  createSiteScopedBlockRenderContext: mocks.context,
}));
vi.mock("./runtime.js", async (original) => ({
  ...(await original<typeof RuntimeModule>()),
  findForumBoardById: mocks.board,
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof NavigationModule>()),
  notFound: () => {
    throw new Error("normal-not-found");
  },
}));
beforeEach(() => {
  mocks.member.mockReset();
  mocks.board.mockReset();
  mocks.context.mockReset();
});

describe("Forum source-owned normal detail template", () => {
  it("retains the same actual route, template and collection objects without rendering", () => {
    const forum = createForum({
      basePath: "/community/discussions",
      collections: { boards: "boards", posts: "threads" },
    });
    const owner = forum.buildRouteOwner;
    expect(npIsForumBuildRouteOwnerV1(owner)).toBe(true);
    expect(npIsForumBuildRouteOwnerV1({ ...owner })).toBe(false);
    expect(npIsForumBuildRouteOwnerV1(JSON.parse(JSON.stringify(owner)))).toBe(false);
    expect(forum.plugin.pageRoutes?.includes(owner.route)).toBe(true);
    expect(owner.route.pattern).toBe("/community/discussions/:boardKey/:postId");
    expect(forum.plugin.templates?.threads?.detail).toBe(owner.template);
    expect(owner.route.component).toBe(owner.routeComponent);
    expect(owner.template.component).toBe(owner.templateComponent);
    expect(owner.boardCollection).toBe(forum.collections[0]);
    expect(owner.postCollection).toBe(forum.collections[1]);
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it("uses normal member resolution and board lookup before delegating to the existing detail handler", async () => {
    const forum = createForum(),
      detail = vi.fn(() => Promise.resolve(createElement("article", null, "Protected")));
    const owner = createForumBuildRouteOwnerV1(
      forum.runtime,
      { pattern: "/boards/:boardKey/:postId", component: detail },
      forum.collections[0],
      forum.collections[1],
    );
    const postId = "00000000-0000-4000-8000-000000000001",
      boardId = "00000000-0000-4000-8000-000000000002";
    const context = { content: { find: vi.fn(), findOne: vi.fn(), count: vi.fn() } };
    mocks.member.mockResolvedValue({ id: "synthetic-member" });
    mocks.board.mockResolvedValue({ key: "members" });
    const rendered = await owner.template.component({
      doc: { id: postId, board: boardId },
      blockCtx: context,
    });
    expect(rendered).toEqual(createElement("article", null, "Protected"));
    expect(mocks.board).toHaveBeenCalledWith(forum.runtime, boardId, "synthetic-member");
    expect(detail).toHaveBeenCalledWith({
      params: { boardKey: "members", postId },
      searchParams: {},
      blockCtx: context,
    });
    expect(mocks.context).not.toHaveBeenCalled();
    mocks.board.mockResolvedValue(null);
    mocks.member.mockResolvedValue(null);
    await expect(
      owner.template.component({ doc: { id: postId, board: boardId }, blockCtx: context }),
    ).rejects.toThrow("normal-not-found");
    expect(detail).toHaveBeenCalledTimes(1);
    expect(mocks.board).toHaveBeenLastCalledWith(forum.runtime, boardId, null);
  });

  it("refuses missing or noncanonical document bindings before touching auth or data", async () => {
    const forum = createForum();
    await expect(
      forum.buildRouteOwner.template.component({ doc: { id: "not-a-post", board: "not-a-board" } }),
    ).rejects.toThrow("normal-not-found");
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });
});
