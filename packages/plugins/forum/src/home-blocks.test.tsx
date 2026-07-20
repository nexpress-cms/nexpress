import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as NpCoreModule from "@nexpress/core";
import type * as NpCommunityModule from "@nexpress/core/community";

const mocks = vi.hoisted(() => ({
  contentFind: vi.fn(),
  findDocuments: vi.fn(),
  getMemberProfiles: vi.fn(),
  listContentEngagement: vi.fn(),
}));

vi.mock("@nexpress/core", async (importOriginal) => {
  const actual = await importOriginal<typeof NpCoreModule>();
  return {
    ...actual,
    findDocuments: mocks.findDocuments,
    getMemberProfiles: mocks.getMemberProfiles,
  };
});

vi.mock("@nexpress/core/community", async (importOriginal) => {
  const actual = await importOriginal<typeof NpCommunityModule>();
  return {
    ...actual,
    npListContentEngagement: mocks.listContentEngagement,
  };
});

vi.mock("@nexpress/core/i18n", () => ({
  getCurrentLocale: () => "ko",
  t: (key: string) =>
    ({
      "forum.viewAll": "전체 보기",
      "forum.emptyNotices": "등록된 공지가 없습니다.",
    })[key] ?? null,
}));

import { createForum } from "./index.js";

const boardDocument = {
  id: "board-1",
  siteId: "default",
  status: "published",
  visibility: "public",
  slug: "free",
  name: "자유게시판",
  description: "함께 이야기해요",
  skin: "community-full",
  writeMode: "members",
  moderation: "pending",
  commentsEnabled: true,
  pageSize: 20,
  categories: [
    { key: "question", label: "질문" },
    { key: "guide", label: "정보" },
  ],
};

const postDocument = {
  id: "2d4af53e-6f78-43e0-8682-67f5a7d2b92e",
  siteId: "default",
  status: "published",
  visibility: "public",
  board: "board-1",
  boardKey: "free",
  title: "첫 번째 토론",
  body: {},
  category: "question",
  pinned: false,
  locked: true,
  memberAuthorId: "member-1",
  createdAt: new Date("2026-07-19T00:00:00.000Z"),
  updatedAt: new Date("2026-07-19T00:00:00.000Z"),
};

function result(docs: unknown[]) {
  return {
    docs,
    totalDocs: docs.length,
    totalPages: docs.length > 0 ? 1 : 0,
    page: 1,
    limit: Math.max(1, docs.length),
    hasNextPage: false,
    hasPrevPage: false,
  };
}

async function renderBlock(type: string, props: Record<string, unknown>): Promise<string> {
  const block = createForum({
    basePath: "/community/boards",
    collections: { boards: "community-boards", posts: "community-posts" },
  }).plugin.blocks?.find((definition) => definition.type === type);
  if (!block) throw new Error(`Missing block ${type}`);
  const node = await block.render(props, undefined, {
    content: {
      find: mocks.contentFind,
      findOne: vi.fn(),
      count: vi.fn(),
    },
  });
  return renderToStaticMarkup(<>{node as ReactNode}</>);
}

describe("forum home blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMemberProfiles.mockResolvedValue(
      new Map([
        [
          "member-1",
          {
            id: "member-1",
            handle: "hana",
            displayName: "하나",
            avatarUrl: null,
          },
        ],
      ]),
    );
    mocks.listContentEngagement.mockImplementation(
      (targetType: string, targetIds: readonly string[]) =>
        Promise.resolve(
          targetIds.map((targetId) => ({
            targetType,
            targetId,
            viewCount: 12,
            commentCount: 3,
            reactionCount: 2,
            reactions: { like: 2 },
          })),
        ),
    );
  });

  it("renders the active board directory from the configured collection and base path", async () => {
    mocks.contentFind.mockResolvedValue(result([boardDocument]));

    const html = await renderBlock("forum.board-directory", {
      heading: "커뮤니티 게시판",
      limit: 12,
      columns: "three",
      showDescriptions: true,
      showCategories: true,
      showPolicies: true,
    });

    expect(mocks.contentFind).toHaveBeenCalledWith("community-boards", {
      where: { status: "published" },
      sort: "name",
      page: 1,
      limit: 100,
    });
    expect(html).toContain('data-np-forum-block="board-directory"');
    expect(html).toContain('data-np-forum-columns="three"');
    expect(html).toContain('href="/community/boards/free"');
    expect(html).toContain("자유게시판");
    expect(html).toContain("질문");
    expect(html).toContain("Members can post");
    expect(html).toContain("전체 보기");
    expect(mocks.findDocuments).not.toHaveBeenCalled();
  });

  it("keeps latest feeds bounded, excludes notices, and drops inactive board snapshots", async () => {
    mocks.contentFind.mockImplementation((collection: string) => {
      if (collection === "community-boards") return Promise.resolve(result([boardDocument]));
      return Promise.resolve(
        result([
          postDocument,
          { ...postDocument, id: "stale", boardKey: "renamed", title: "Stale" },
          { ...postDocument, id: "orphan", board: "missing", title: "Orphan" },
        ]),
      );
    });

    const html = await renderBlock("forum.post-feed", {
      heading: "최근 토론",
      mode: "latest",
      boardKey: "",
      limit: 8,
      layout: "cards",
      showBoard: true,
      showCategory: true,
      showAuthor: true,
      showDate: true,
    });

    expect(mocks.contentFind).toHaveBeenCalledWith("community-posts", {
      where: { status: "published", pinned: false },
      sort: "-createdAt",
      page: 1,
      limit: 50,
    });
    expect(mocks.getMemberProfiles).toHaveBeenCalledWith(["member-1"]);
    expect(html).toContain('data-np-forum-feed-mode="latest"');
    expect(html).toContain('data-np-forum-feed-layout="cards"');
    expect(html).toContain('href="/community/boards/free/2d4af53e-6f78-43e0-8682-67f5a7d2b92e"');
    expect(html).toContain("첫 번째 토론");
    expect(html).toContain("하나");
    expect(html).toContain("Views 12");
    expect(html).not.toContain("Stale");
    expect(html).not.toContain("Orphan");
  });

  it("ranks a bounded recent candidate set by the documented popularity score", async () => {
    const popularId = "3bd66e58-b165-44dd-9a8a-4cb44fa7717a";
    const newerId = "4d6794f7-205a-4e44-9e3c-8593dfb19c55";
    const now = new Date();
    mocks.contentFind.mockImplementation((collection: string) => {
      if (collection === "community-boards") return Promise.resolve(result([boardDocument]));
      return Promise.resolve(
        result([
          { ...postDocument, id: newerId, title: "Newer", createdAt: now },
          {
            ...postDocument,
            id: popularId,
            title: "More popular",
            createdAt: new Date(now.getTime() - 60_000),
          },
          {
            ...postDocument,
            id: "59be0f52-e45a-4711-b964-886ee3af94ac",
            title: "Outside window",
            createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          },
        ]),
      );
    });
    mocks.listContentEngagement.mockImplementation(
      (targetType: string, targetIds: readonly string[]) =>
        Promise.resolve(
          targetIds.map((targetId) => ({
            targetType,
            targetId,
            viewCount: targetId === popularId ? 10 : 20,
            commentCount: targetId === popularId ? 8 : 0,
            reactionCount: targetId === popularId ? 4 : 0,
            reactions: targetId === popularId ? { like: 4 } : {},
          })),
        ),
    );

    const html = await renderBlock("forum.post-feed", {
      heading: "인기글",
      mode: "popular",
      boardKey: "",
      limit: 2,
      windowDays: 7,
      layout: "list",
      showBoard: true,
      showCategory: true,
      showAuthor: false,
      showDate: false,
      showEngagement: true,
    });

    expect(mocks.contentFind).toHaveBeenCalledWith("community-posts", {
      where: { status: "published", pinned: false },
      sort: "-createdAt",
      page: 1,
      limit: 200,
    });
    expect(html).toContain('data-np-forum-feed-mode="popular"');
    expect(html.indexOf("More popular")).toBeLessThan(html.indexOf("Newer"));
    expect(html).not.toContain("Outside window");
  });

  it("scopes notice feeds to an exact active board and renders a distinct empty state", async () => {
    mocks.contentFind.mockImplementation((_collection: string, options: { where?: object }) => {
      if ("slug" in (options.where ?? {})) return Promise.resolve(result([boardDocument]));
      return Promise.resolve(result([]));
    });

    const html = await renderBlock("forum.post-feed", {
      heading: "공지",
      mode: "notices",
      boardKey: "free",
      limit: 5,
      layout: "list",
      showBoard: false,
      showCategory: false,
      showAuthor: false,
      showDate: true,
    });

    expect(mocks.contentFind).toHaveBeenCalledWith("community-posts", {
      where: { status: "published", pinned: true, board: "board-1" },
      sort: "-createdAt",
      page: 1,
      limit: 5,
    });
    expect(html).toContain('data-np-forum-feed-mode="notices"');
    expect(html).toContain('data-np-forum-board="free"');
    expect(html).toContain("등록된 공지가 없습니다.");
  });

  it("fails closed before querying for an unsafe board key", async () => {
    await expect(
      renderBlock("forum.post-feed", {
        heading: "Invalid",
        mode: "latest",
        boardKey: "../private",
        limit: 8,
        layout: "list",
        showBoard: true,
        showCategory: true,
        showAuthor: true,
        showDate: true,
      }),
    ).rejects.toThrow(/board key/u);
    expect(mocks.contentFind).not.toHaveBeenCalled();
    expect(mocks.findDocuments).not.toHaveBeenCalled();
  });

  it("fails closed before querying for an overlong board key", async () => {
    await expect(
      renderBlock("forum.post-feed", {
        heading: "Invalid",
        mode: "latest",
        boardKey: `a${"b".repeat(63)}`,
        limit: 8,
        layout: "list",
        showBoard: true,
        showCategory: true,
        showAuthor: true,
        showDate: true,
      }),
    ).rejects.toThrow(/board key/u);
    expect(mocks.contentFind).not.toHaveBeenCalled();
    expect(mocks.findDocuments).not.toHaveBeenCalled();
  });
});
