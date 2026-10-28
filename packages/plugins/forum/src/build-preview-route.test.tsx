import { Children, createElement, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@nexpress/core";
import type * as Community from "@nexpress/core/community";
import type * as Next from "@nexpress/next";
import type * as Runtime from "./runtime.js";
import type { NpForumPostDetailSkinProps } from "./types.js";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  board: vi.fn(),
  boardById: vi.fn(),
  post: vi.fn(),
  read: vi.fn(),
  enrich: vi.fn(),
  messages: vi.fn(),
  skin: vi.fn(),
  seo: vi.fn(),
  jsonLd: vi.fn(),
}));
vi.mock("@nexpress/core", async (original) => ({
  ...(await original<typeof Core>()),
  getDocumentById: mocks.post,
  getSiteSeoSettings: mocks.seo,
  buildDiscussionForumPostingJsonLd: mocks.jsonLd,
}));
vi.mock("@nexpress/core/community", async (original) => ({
  ...(await original<typeof Community>()),
  npCanReadCommunityDocument: mocks.read,
  getDocumentModerationPermissions: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@nexpress/next", async (original) => ({
  ...(await original<typeof Next>()),
  getSiteMember: mocks.member,
}));
vi.mock("./runtime.js", async (original) => ({
  ...(await original<typeof Runtime>()),
  findForumBoardByKey: mocks.board,
  findForumBoardById: mocks.boardById,
  enrichForumPosts: mocks.enrich,
  getForumMessages: mocks.messages,
  resolveForumAttachments: vi.fn(() => Promise.resolve([])),
  resolveForumSkin: vi.fn(() => ({ renderPostDetail: mocks.skin })),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("normal-not-found");
  },
}));

import {
  createForum,
  npIsForumBuildRouteOwnerV1,
  npIsForumBuildPreviewAdapterV1,
} from "./index.js";
import { requireForumPostDetailBuildPreviewRoute } from "./routes/forum-post-detail.js";
import { classicForumSkin } from "./skins/classic.js";

const postId = "00000000-0000-4000-8000-000000000001";
const boardId = "00000000-0000-4000-8000-000000000002";
const memberId = "00000000-0000-4000-8000-000000000003";
const board = { id: boardId, key: "free", skinId: "classic", audience: "public" };
const post = () => ({
  id: postId,
  board: boardId,
  title: "Synthetic post",
  status: "published",
  visibility: "public",
  audience: "public",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
const context = { content: { find: vi.fn(), findOne: vi.fn(), count: vi.fn() } };
const props = () => ({ params: { boardKey: "free", postId }, searchParams: {}, blockCtx: context });
const engagementProps = () => {
  const skinProps = mocks.skin.mock.calls.at(-1)?.[0] as NpForumPostDetailSkinProps | undefined;
  const engagement = skinProps?.engagement;
  if (!isValidElement<{ trackViews: boolean; targetType: string; targetId: string }>(engagement))
    throw new Error("Missing normal engagement component");
  return engagement.props;
};
const navigationLinks = (node: ReactNode) => {
  const links: Array<{ href: string; prefetch: boolean | undefined }> = [];
  const visit = (children: ReactNode) => {
    Children.forEach(children, (child) => {
      if (!isValidElement<{ href?: string; prefetch?: boolean; children?: ReactNode }>(child))
        return;
      if (typeof child.props.href === "string")
        links.push({ href: child.props.href, prefetch: child.props.prefetch });
      visit(child.props.children);
    });
  };
  visit(node);
  return links;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue(null);
  mocks.board.mockResolvedValue(board);
  mocks.boardById.mockResolvedValue(board);
  mocks.post.mockResolvedValue(post());
  mocks.read.mockResolvedValue(true);
  mocks.enrich.mockResolvedValue([
    {
      ...post(),
      author: null,
      engagement: { viewCount: 0, commentCount: 0, reactionCount: 0, reactions: {} },
    },
  ]);
  mocks.messages.mockResolvedValue({ locale: "en" });
  mocks.skin.mockReturnValue(createElement("article", null, "Normal skin"));
  mocks.seo.mockResolvedValue({ siteUrl: "https://synthetic.example" });
  mocks.jsonLd.mockResolvedValue({
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
  });
});

describe("explicit source-owned Forum build preview adapter", () => {
  it("preserves normal analytics and link prefetch outside the explicit preview closure", async () => {
    mocks.skin.mockImplementation((props: NpForumPostDetailSkinProps) =>
      classicForumSkin.renderPostDetail(props),
    );
    mocks.enrich.mockResolvedValue([
      {
        ...post(),
        author: {
          id: memberId,
          handle: "synthetic-member",
          displayName: "Synthetic member",
          avatarUrl: null,
        },
        engagement: { viewCount: 0, commentCount: 0, reactionCount: 0, reactions: {} },
        questionContext: {
          type: "pages",
          id: boardId,
          label: "Related question",
          href: "/related/question",
        },
      },
    ]);
    const links = (prefetch?: boolean) => [
      { href: "/boards/free", prefetch },
      { href: "/u/synthetic-member", prefetch },
      { href: "/related/question", prefetch },
    ];
    const forum = createForum(),
      owner = forum.buildRouteOwner;
    const adapter = owner.createReadOnlyPreviewAdapter();
    expect(adapter.scope).toBe("forum-build-preview-analytics-only");
    expect(npIsForumBuildRouteOwnerV1(owner)).toBe(true);
    expect(npIsForumBuildPreviewAdapterV1(adapter)).toBe(true);
    expect(adapter.owner).toBe(owner);
    expect(adapter.route).toBe(owner.route);
    expect(adapter.template).toBe(owner.template);
    expect(owner.route.component).toBe(owner.routeComponent);
    expect(owner.template.component).toBe(owner.templateComponent);
    expect(forum.plugin.pageRoutes?.includes(adapter.route)).toBe(true);
    expect(forum.plugin.templates?.["forum-posts"]?.detail).toBe(adapter.template);

    expect(navigationLinks(await owner.route.component(props()))).toEqual(links());
    expect(engagementProps()).toMatchObject({
      trackViews: true,
      targetId: postId,
      targetType: "forum-posts",
    });
    expect(navigationLinks(await adapter.renderRoute(props()))).toEqual(links(false));
    expect(engagementProps()).toMatchObject({
      trackViews: false,
      targetId: postId,
      targetType: "forum-posts",
    });
    expect(
      navigationLinks(
        await owner.template.component({ doc: { id: postId, board: boardId }, blockCtx: context }),
      ),
    ).toEqual(links());
    expect(engagementProps().trackViews).toBe(true);
    expect(
      navigationLinks(
        await adapter.renderTemplate({ doc: { id: postId, board: boardId }, blockCtx: context }),
      ),
    ).toEqual(links(false));
    expect(engagementProps().trackViews).toBe(false);
    // Opting into a private adapter never changes the normal component or its next invocation.
    expect(navigationLinks(await owner.route.component(props()))).toEqual(links());
    expect(engagementProps().trackViews).toBe(true);
    expect(mocks.skin).toHaveBeenCalledTimes(5);
    expect(mocks.read).toHaveBeenCalledTimes(5);
    expect(mocks.jsonLd).toHaveBeenCalledTimes(5);
  });

  it("passes the same principal/document and denial through the normal protected-audience owner", async () => {
    const forum = createForum(),
      owner = forum.buildRouteOwner,
      adapter = owner.createReadOnlyPreviewAdapter();
    const protectedPost = { ...post(), audience: "members", memberAuthorId: memberId };
    mocks.post.mockResolvedValue(protectedPost);
    mocks.read.mockResolvedValue(false);
    for (const render of [owner.route.component, adapter.renderRoute]) {
      await expect(render(props())).rejects.toThrow("normal-not-found");
      expect(mocks.read).toHaveBeenLastCalledWith("forum-posts", protectedPost, null, {
        allowUnpublished: true,
      });
    }
    expect(mocks.skin).not.toHaveBeenCalled();
    mocks.member.mockResolvedValue({ id: memberId });
    mocks.read.mockResolvedValue(true);
    for (const render of [owner.route.component, adapter.renderRoute]) {
      await render(props());
      expect(mocks.read).toHaveBeenLastCalledWith(
        "forum-posts",
        protectedPost,
        { kind: "member", memberId },
        { allowUnpublished: true },
      );
      expect(mocks.board).toHaveBeenLastCalledWith(forum.runtime, "free", memberId);
      expect(engagementProps().trackViews).toBe(false);
      expect(mocks.skin).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prefetchLinks: render === adapter.renderRoute ? false : undefined,
        }),
      );
      const skinProps = mocks.skin.mock.calls.at(-1)?.[0] as NpForumPostDetailSkinProps | undefined;
      const authorActions = skinProps?.authorActions;
      if (!isValidElement<{ canEdit: boolean; prefetchLinks?: boolean }>(authorActions))
        throw new Error("Missing normal author actions");
      expect(authorActions.props).toMatchObject({
        canEdit: true,
        prefetchLinks: render === adapter.renderRoute ? false : undefined,
      });
    }
    expect(mocks.jsonLd).not.toHaveBeenCalled();
    mocks.boardById.mockResolvedValue(null);
    await expect(
      adapter.renderTemplate({ doc: { id: postId, board: boardId }, blockCtx: context }),
    ).rejects.toThrow("normal-not-found");
    expect(mocks.boardById).toHaveBeenLastCalledWith(forum.runtime, boardId, memberId);
  });

  it("does not select preview semantics from authored request props or a copied adapter", async () => {
    const owner = createForum().buildRouteOwner;
    const injected = {
      ...props(),
      searchParams: { preview: "true", trackViews: "false", mode: "build-preview" },
      preview: { recordViews: false },
      prefetchLinks: false,
    };
    await owner.route.component(injected);
    expect(engagementProps().trackViews).toBe(true);
    expect(mocks.skin).toHaveBeenLastCalledWith(
      expect.objectContaining({ prefetchLinks: undefined }),
    );
    const adapter = owner.createReadOnlyPreviewAdapter();
    expect(npIsForumBuildPreviewAdapterV1({ ...adapter })).toBe(false);
    expect(npIsForumBuildPreviewAdapterV1(JSON.parse(JSON.stringify(adapter)))).toBe(false);
    expect(npIsForumBuildRouteOwnerV1({ ...owner })).toBe(false);
    expect(() =>
      requireForumPostDetailBuildPreviewRoute(() => Promise.resolve(createElement("article"))),
    ).toThrow("original detail route");
  });

  it("invalidates an adapter after route/template replacement and rejects accessors without invoking them", async () => {
    const owner = createForum().buildRouteOwner,
      adapter = owner.createReadOnlyPreviewAdapter();
    const original = owner.template.component;
    owner.template.component = (props) => original(props);
    expect(npIsForumBuildPreviewAdapterV1(adapter)).toBe(false);
    await expect(adapter.renderRoute(props())).rejects.toThrow("source owner changed");
    expect(() => owner.createReadOnlyPreviewAdapter()).toThrow("source owner changed");
    owner.template.component = original;
    expect(npIsForumBuildPreviewAdapterV1(adapter)).toBe(true);
    const accessed = vi.fn(() => original);
    Object.defineProperty(owner.template, "component", { get: accessed, configurable: true });
    expect(npIsForumBuildPreviewAdapterV1(adapter)).toBe(false);
    expect(() => owner.createReadOnlyPreviewAdapter()).toThrow("source owner changed");
    expect(accessed).not.toHaveBeenCalled();
  });
});
