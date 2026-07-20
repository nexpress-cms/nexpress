import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrichForumPosts: vi.fn(),
  findDocuments: vi.fn(),
  getSiteMember: vi.fn(),
  renderPostList: vi.fn(),
}));

vi.mock("@nexpress/core", () => ({
  findDocuments: mocks.findDocuments,
}));

vi.mock("@nexpress/next", () => ({
  buildPageMetadata: vi.fn(),
  getSiteMember: mocks.getSiteMember,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

const board = {
  id: "board-1",
  key: "free",
  name: "자유게시판",
  description: null,
  skinId: "classic",
  writeMode: "members" as const,
  moderation: "published" as const,
  commentsEnabled: true,
  pageSize: 20,
  categories: [
    { key: "question", label: "질문" },
    { key: "guide", label: "가이드" },
  ],
};

vi.mock("./runtime.js", () => ({
  enrichForumPosts: mocks.enrichForumPosts,
  findForumBoardByKey: vi.fn(() => Promise.resolve(board)),
  getForumMessages: vi.fn(() => Promise.resolve({ posts: "게시글" })),
  resolveForumSkin: vi.fn(() => ({ renderPostList: mocks.renderPostList })),
}));

import { createBoardPostsRoute } from "./routes/board-posts.js";

const runtime = {
  basePath: "/boards",
  collections: { boards: "forum-boards", posts: "forum-posts" },
  defaultSkinId: "classic",
  skins: new Map(),
};

function result(overrides: Record<string, unknown> = {}) {
  return {
    docs: [],
    totalDocs: 0,
    totalPages: 0,
    page: 1,
    limit: 20,
    hasNextPage: false,
    hasPrevPage: false,
    ...overrides,
  };
}

async function render(searchParams: Record<string, string | string[] | undefined> = {}) {
  return createBoardPostsRoute(runtime)({
    params: { boardKey: "free" },
    searchParams,
    blockCtx: {},
  } as never);
}

describe("forum board post-list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSiteMember.mockResolvedValue(null);
    mocks.enrichForumPosts.mockImplementation((docs: unknown[]) => Promise.resolve(docs));
    mocks.renderPostList.mockReturnValue(null);
  });

  it("combines board, publication, category, and full-text filters", async () => {
    mocks.findDocuments.mockResolvedValue(result({ totalDocs: 1, totalPages: 1 }));

    await render({ q: "  한글 검색  ", category: "question", page: "1" });

    expect(mocks.findDocuments).toHaveBeenCalledTimes(1);
    expect(mocks.findDocuments).toHaveBeenCalledWith("forum-posts", {
      where: {
        board: "board-1",
        status: "published",
        pinned: false,
        category: "question",
      },
      search: "한글 검색",
      page: 1,
      limit: 20,
    });
    expect(mocks.renderPostList).toHaveBeenCalledWith(
      expect.objectContaining({
        pinnedPosts: [],
        query: { page: 1, search: "한글 검색", category: "question", showMine: false },
        searchMaxLength: 120,
      }),
    );
  });

  it("shows pinned posts only on the unfiltered public first page", async () => {
    mocks.findDocuments
      .mockResolvedValueOnce(result({ totalDocs: 1, totalPages: 1 }))
      .mockResolvedValueOnce(result({ docs: [{ id: "notice" }], totalDocs: 1, totalPages: 1 }));

    await render();

    expect(mocks.findDocuments).toHaveBeenCalledTimes(2);
    expect(mocks.findDocuments).toHaveBeenNthCalledWith(2, "forum-posts", {
      where: { board: "board-1", status: "published", pinned: true },
      sort: "-createdAt",
      page: 1,
      limit: 100,
    });
    expect(mocks.renderPostList).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedPosts: [{ id: "notice" }] }),
    );
  });

  it("keeps member-only results scoped to the authenticated author", async () => {
    mocks.getSiteMember.mockResolvedValue({ id: "member-1" });
    mocks.findDocuments.mockResolvedValue(result({ totalDocs: 1, totalPages: 1 }));

    await render({ author: "me", q: "owner" });

    expect(mocks.findDocuments).toHaveBeenCalledWith("forum-posts", {
      where: { board: "board-1", memberAuthorId: "member-1" },
      search: "owner",
      page: 1,
      limit: 20,
    });
    expect(mocks.renderPostList).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { page: 1, search: "owner", category: null, showMine: true },
      }),
    );
  });

  it("fails closed for malformed filters and out-of-range result pages", async () => {
    await expect(render({ category: "missing" })).rejects.toThrow("not found");
    await expect(render({ author: "me" })).rejects.toThrow("not found");
    expect(mocks.findDocuments).not.toHaveBeenCalled();

    mocks.findDocuments.mockResolvedValue(result({ totalDocs: 1, totalPages: 1 }));
    await expect(render({ page: "2" })).rejects.toThrow("not found");
    expect(mocks.renderPostList).not.toHaveBeenCalled();
  });
});
