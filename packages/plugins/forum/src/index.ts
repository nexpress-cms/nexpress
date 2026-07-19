import { definePlugin, type NpPluginPageRouteRegistration } from "@nexpress/plugin-sdk";

import { defineForumBoardsCollection, defineForumPostsCollection } from "./collections.js";
import { createForumHomeBlocks, forumHomePatterns } from "./home-blocks.js";
import { createBoardIndexMetadata, createBoardIndexRoute } from "./routes/board-index.js";
import { createBoardPostsMetadata, createBoardPostsRoute } from "./routes/board-posts.js";
import { createForumPostDetailRoute, createForumPostMetadata } from "./routes/forum-post-detail.js";
import { createForumPostEditRoute } from "./routes/forum-post-edit.js";
import { createForumPostNewRoute } from "./routes/forum-post-new.js";
import type { NpForumRuntime } from "./runtime.js";
import { classicForumSkin } from "./skins/classic.js";
import { communityFullForumSkin } from "./skins/community-full.js";
import type { NpForumCollectionSlugs, NpForumSkin } from "./types.js";

const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/u;

export interface NpForumOptions {
  /** Public root. Defaults to `/boards`; literal lowercase segments only. */
  basePath?: string;
  /** Generated collection slugs. Override before the first schema generation. */
  collections?: Partial<NpForumCollectionSlugs>;
  /** Additional build-time skins registered after the two built-in skins. */
  skins?: readonly NpForumSkin[];
  /** Default skin for the board index and newly-created boards. */
  defaultSkinId?: string;
}

function requireBasePath(value: string): string {
  if (
    value === "/" ||
    value.endsWith("/") ||
    !value.startsWith("/") ||
    !value
      .slice(1)
      .split("/")
      .every((segment) => SAFE_SEGMENT.test(segment))
  ) {
    throw new Error(
      `Forum basePath "${value}" must contain canonical lowercase literal segments without a trailing slash.`,
    );
  }
  return value;
}

function createRuntime(options: NpForumOptions): NpForumRuntime {
  const skins = new Map<string, NpForumSkin>();
  for (const skin of [classicForumSkin, communityFullForumSkin, ...(options.skins ?? [])]) {
    if (!SAFE_SEGMENT.test(skin.id)) {
      throw new Error(`Forum skin id "${skin.id}" is invalid.`);
    }
    if (skins.has(skin.id)) {
      throw new Error(`Forum skin id "${skin.id}" is registered more than once.`);
    }
    if (
      !skin.label.trim() ||
      typeof skin.renderBoardIndex !== "function" ||
      typeof skin.renderPostList !== "function" ||
      typeof skin.renderPostDetail !== "function" ||
      typeof skin.renderPostComposer !== "function"
    ) {
      throw new Error(`Forum skin "${skin.id}" is incomplete.`);
    }
    skins.set(skin.id, skin);
  }
  const defaultSkinId = options.defaultSkinId ?? classicForumSkin.id;
  if (!skins.has(defaultSkinId)) {
    throw new Error(`Forum default skin "${defaultSkinId}" is not registered.`);
  }
  const collections = {
    boards: options.collections?.boards ?? "forum-boards",
    posts: options.collections?.posts ?? "forum-posts",
  };
  if (!SAFE_SEGMENT.test(collections.boards) || !SAFE_SEGMENT.test(collections.posts)) {
    throw new Error("Forum collection slugs must be canonical lowercase segments.");
  }
  if (collections.boards === collections.posts) {
    throw new Error("Forum board and post collection slugs must be different.");
  }
  return {
    basePath: requireBasePath(options.basePath ?? "/boards"),
    collections,
    defaultSkinId,
    skins,
  };
}

const messages = {
  en: {
    "forum.boards": "Boards",
    "forum.posts": "Posts",
    "forum.allPosts": "All posts",
    "forum.myPosts": "My posts",
    "forum.newPost": "New post",
    "forum.signInToPost": "Sign in to post",
    "forum.emptyBoards": "No boards yet.",
    "forum.emptyPosts": "No posts yet.",
    "forum.emptyFilteredPosts": "No posts match these filters.",
    "forum.allCategories": "All categories",
    "forum.searchPosts": "Search posts",
    "forum.searchPlaceholder": "Search titles and content",
    "forum.clearFilters": "Clear filters",
    "forum.number": "No.",
    "forum.category": "Category",
    "forum.title": "Title",
    "forum.author": "Author",
    "forum.date": "Date",
    "forum.notice": "Notice",
    "forum.staff": "Staff",
    "forum.pending": "Pending",
    "forum.locked": "Locked",
    "forum.pagination": "Pagination",
    "forum.boardPolicy": "Board policy",
    "forum.writeMembers": "Members can post",
    "forum.writeStaff": "Staff posts only",
    "forum.writeClosed": "Posting closed",
    "forum.moderationPublished": "Posts publish immediately",
    "forum.moderationPending": "New posts require review",
    "forum.commentsOpen": "Comments enabled",
    "forum.commentsClosed": "Comments disabled",
    "forum.createdAt": "Created",
    "forum.updatedAt": "Updated",
    "forum.viewAll": "View all",
    "forum.emptyNotices": "No notices yet.",
    "forum.previous": "Previous",
    "forum.next": "Next",
    "forum.backToBoard": "Back to board",
    "forum.backToPost": "Back to post",
    "forum.editPost": "Edit post",
    "forum.categoryNone": "No category",
    "forum.body": "Body",
    "forum.loadingEditor": "Loading editor…",
    "forum.saving": "Saving…",
    "forum.create": "Submit",
    "forum.save": "Save changes",
    "forum.saveFailed": "Could not save the post.",
    "forum.edit": "Edit",
    "forum.delete": "Delete",
    "forum.deleteConfirm": "Delete this post? This cannot be undone.",
    "forum.cancel": "Cancel",
    "forum.deleting": "Deleting…",
    "forum.deleteFailed": "Could not delete the post.",
    "forum.signIn": "Sign in",
    "forum.register": "Create account",
    "forum.loginRequired": "An account is required to create a post.",
    "forum.commentsLocked": "This post is locked. Existing comments remain visible.",
    "forum.emptyBody": "No content.",
  },
  ko: {
    "forum.boards": "게시판",
    "forum.posts": "게시글",
    "forum.allPosts": "전체글",
    "forum.myPosts": "내 글",
    "forum.newPost": "글쓰기",
    "forum.signInToPost": "로그인 후 글쓰기",
    "forum.emptyBoards": "아직 게시판이 없습니다.",
    "forum.emptyPosts": "아직 게시글이 없습니다.",
    "forum.emptyFilteredPosts": "조건에 맞는 게시글이 없습니다.",
    "forum.allCategories": "전체 분류",
    "forum.searchPosts": "게시글 검색",
    "forum.searchPlaceholder": "제목과 내용 검색",
    "forum.clearFilters": "검색 조건 지우기",
    "forum.number": "번호",
    "forum.category": "분류",
    "forum.title": "제목",
    "forum.author": "작성자",
    "forum.date": "작성일",
    "forum.notice": "공지",
    "forum.staff": "운영자",
    "forum.pending": "검토 중",
    "forum.locked": "잠김",
    "forum.pagination": "페이지 이동",
    "forum.boardPolicy": "게시판 운영 정책",
    "forum.writeMembers": "회원 글쓰기",
    "forum.writeStaff": "운영자만 글쓰기",
    "forum.writeClosed": "글쓰기 닫힘",
    "forum.moderationPublished": "즉시 게시",
    "forum.moderationPending": "새 글 검토 후 게시",
    "forum.commentsOpen": "댓글 사용",
    "forum.commentsClosed": "댓글 사용 안 함",
    "forum.createdAt": "작성",
    "forum.updatedAt": "수정",
    "forum.viewAll": "전체 보기",
    "forum.emptyNotices": "등록된 공지가 없습니다.",
    "forum.previous": "이전",
    "forum.next": "다음",
    "forum.backToBoard": "목록으로",
    "forum.backToPost": "게시글로",
    "forum.editPost": "글 수정",
    "forum.categoryNone": "선택 안 함",
    "forum.body": "내용",
    "forum.loadingEditor": "편집기를 불러오는 중…",
    "forum.saving": "저장 중…",
    "forum.create": "등록",
    "forum.save": "수정",
    "forum.saveFailed": "게시글을 저장하지 못했습니다.",
    "forum.edit": "수정",
    "forum.delete": "삭제",
    "forum.deleteConfirm": "이 게시글을 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.",
    "forum.cancel": "취소",
    "forum.deleting": "삭제 중…",
    "forum.deleteFailed": "게시글을 삭제하지 못했습니다.",
    "forum.signIn": "로그인",
    "forum.register": "회원가입",
    "forum.loginRequired": "게시글을 쓰려면 계정이 필요합니다.",
    "forum.commentsLocked": "잠긴 게시글입니다. 기존 댓글은 계속 볼 수 있습니다.",
    "forum.emptyBody": "내용이 없습니다.",
  },
} as const;

/**
 * Creates one cohesive forum definition: two native collections plus a plugin
 * whose routes, actions, skins, and policy callbacks all close over those exact
 * collection slugs. Add both `collections` and `plugin` to project config.
 */
export function createForum(options: NpForumOptions = {}) {
  const runtime = createRuntime(options);
  const pageRoutes = [
    {
      pattern: runtime.basePath,
      component: createBoardIndexRoute(runtime),
      metadata: createBoardIndexMetadata(runtime),
    },
    {
      pattern: `${runtime.basePath}/:boardKey/new`,
      component: createForumPostNewRoute(runtime),
      surface: "member",
    },
    {
      pattern: `${runtime.basePath}/:boardKey/:postId/edit`,
      component: createForumPostEditRoute(runtime),
      surface: "member",
    },
    {
      pattern: `${runtime.basePath}/:boardKey/:postId`,
      component: createForumPostDetailRoute(runtime),
      metadata: createForumPostMetadata(runtime),
    },
    {
      pattern: `${runtime.basePath}/:boardKey`,
      component: createBoardPostsRoute(runtime),
      metadata: createBoardPostsMetadata(runtime),
    },
  ] satisfies NpPluginPageRouteRegistration[];

  const collections = [
    defineForumBoardsCollection(runtime),
    defineForumPostsCollection(runtime),
  ] as const;
  const blocks = createForumHomeBlocks(runtime);
  const plugin = definePlugin({
    manifest: {
      id: "forum",
      version: "0.4.1",
      name: "Forum",
      description:
        "Korean-style multi-board community with searchable skins, member posts, moderation, and comments.",
      author: { name: "NexPress" },
      license: "MIT",
      nexpress: { minVersion: "0.4.1" },
      capabilities: ["content:read", "admin:dashboard"],
      allowedHosts: [],
      provides: {
        blocks: [],
        collections: [runtime.collections.boards, runtime.collections.posts],
        adminExtensions: ["dashboard:forum-posts"],
        apiRoutes: [],
        hooks: [],
      },
      agent: {
        description:
          "Multi-board forum foundation. Operators create boards as content rows, select a build-time skin, and control member posting, discovery, and moderation per board.",
        category: "content",
        tags: ["forum", "board", "community", "korean"],
      },
      usesTokens: [
        "colors.primary",
        "colors.primaryForeground",
        "colors.background",
        "colors.foreground",
        "colors.muted",
        "colors.mutedForeground",
        "colors.border",
        "colors.card",
        "typography.fontHeading",
        "typography.fontMono",
        "shape.radiusSm",
        "shape.radiusMd",
        "shape.radiusLg",
        "shape.radiusFull",
        "shape.shadowSm",
      ],
      styleSlots: {
        root: ".np-forum",
        "board-index": '[data-np-forum-surface="board-index"]',
        "post-list": '[data-np-forum-surface="post-list"]',
        discovery: ".np-forum-discovery",
        "notice-list": ".np-forum-community-notices",
        "post-rows": ".np-forum-community-posts",
        "post-detail": '[data-np-forum-surface="post-detail"]',
        composer: '[data-np-forum-surface="composer"]',
        comments: ".np-forum-comments",
        "board-directory-block": '[data-np-forum-block="board-directory"]',
        "post-feed-block": '[data-np-forum-block="post-feed"]',
        "feed-item": ".np-forum-block-feed-list > li",
      },
    },
    blocks,
    patterns: forumHomePatterns,
    i18n: messages,
    admin: {
      dashboardWidgets: [
        {
          id: "forum-posts-total",
          label: "Forum posts",
          kind: "metric",
          actionId: "countForumPosts",
          description: "Total posts across all forum boards.",
          priority: 20,
        },
      ],
    },
    actions: {
      countForumPosts: {
        kind: "metric",
        handler: async (_data, ctx) => {
          try {
            const total = await ctx.content.count(runtime.collections.posts);
            return {
              ok: true,
              data: { value: total, delta: total === 1 ? "1 post" : `${total} posts` },
            };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        },
      },
    },
    pageRoutes,
  });

  return { plugin, collections, runtime } as const;
}

const defaultForum = createForum();

export const forumPlugin = defaultForum.plugin;
export const forumCollections = defaultForum.collections;

export { classicForumSkin } from "./skins/classic.js";
export { communityFullForumSkin } from "./skins/community-full.js";
export { createForumHomeBlocks, forumHomePatterns } from "./home-blocks.js";
export type {
  NpForumAuthor,
  NpForumBoard,
  NpForumBoardIndexSkinProps,
  NpForumBoardWriteMode,
  NpForumCategory,
  NpForumCollectionSlugs,
  NpForumMessages,
  NpForumModerationMode,
  NpForumPostComposerSkinProps,
  NpForumPostDetailSkinProps,
  NpForumPostListQuery,
  NpForumPostListQueryPatch,
  NpForumPostListSkinProps,
  NpForumPostSummary,
  NpForumSkin,
} from "./types.js";

export default forumPlugin;
