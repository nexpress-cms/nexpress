import { definePlugin, type NpPluginPageRouteRegistration } from "@nexpress/plugin-sdk";
import { notifyFollowers } from "@nexpress/core/community";

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
    "forum.views": "Views",
    "forum.commentsCount": "Comments",
    "forum.reactions": "Reactions",
    "forum.recommend": "Recommend",
    "forum.recommended": "Recommended",
    "forum.engagementFailed": "Could not update this reaction.",
    "forum.subscribeBoard": "Subscribe to board",
    "forum.subscribedBoard": "Board subscribed",
    "forum.subscribePost": "Subscribe to post",
    "forum.subscribedPost": "Post subscribed",
    "forum.subscriptionLoading": "Loading subscription…",
    "forum.signInToSubscribe": "Sign in to subscribe",
    "forum.subscriptionFailed": "Could not update this subscription.",
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
    "forum.report": "Report",
    "forum.reportTitle": "Report this post",
    "forum.reportHelp": "Tell the moderators briefly what is wrong.",
    "forum.reportPlaceholder": "Spam, harassment, illegal content…",
    "forum.reportSubmit": "Send report",
    "forum.reportSubmitting": "Sending…",
    "forum.reportSuccess": "Your report was sent to the moderators.",
    "forum.reportClose": "Close",
    "forum.reportFailed": "Could not send the report.",
    "forum.signIn": "Sign in",
    "forum.register": "Create account",
    "forum.loginRequired": "An account is required to create a post.",
    "forum.commentsLocked": "This post is locked. Existing comments remain visible.",
    "forum.commentsEmpty": "No comments yet.",
    "forum.commentsLoadFailed": "Could not load comments.",
    "forum.commentsSort": "Comment sort order",
    "forum.commentsOldest": "Oldest",
    "forum.commentsNewest": "Newest",
    "forum.commentsTop": "Top",
    "forum.commentsSignInPrompt": "to comment.",
    "forum.commentPlaceholder": "Write a comment… **bold**, *italic*, `code` supported.",
    "forum.commentPost": "Post comment",
    "forum.commentPosting": "Posting…",
    "forum.commentPostFailed": "Could not post this comment.",
    "forum.commentReply": "Reply",
    "forum.commentReplyingTo": "Replying to",
    "forum.commentReplyPlaceholder": "Write a reply…",
    "forum.commentPostReply": "Post reply",
    "forum.commentEditFailed": "Could not edit this comment.",
    "forum.commentDeleteConfirm": "Delete this comment? Its text will be removed permanently.",
    "forum.commentDeleteFailed": "Could not delete this comment.",
    "forum.commentEdited": "edited",
    "forum.commentImported": "imported",
    "forum.commentImportedTitle": "Imported from a WordPress export",
    "forum.commentUnknownAuthor": "Unknown member",
    "forum.commentSignInToReact": "Log in to react",
    "forum.commentReportTitle": "Report this comment",
    "forum.commentReportReasonLabel": "Report reason",
    "forum.commentMute": "Mute",
    "forum.commentMuting": "Muting…",
    "forum.commentMuteTitle": "Mute this member",
    "forum.commentMuteConfirm":
      "Mute this member? Their comments and reaction notifications will be hidden from you. You can unmute later from your profile.",
    "forum.commentMuteFailed": "Could not mute this member.",
    "forum.emptyBody": "No content.",
    "forum.attachments": "Attachments",
    "forum.attachmentAdd": "Add files",
    "forum.attachmentUploading": "Uploading…",
    "forum.attachmentRemove": "Remove",
    "forum.attachmentUploadFailed": "Could not upload this file.",
    "forum.attachmentHelp":
      "Up to {maxFiles} files, {maxSizeMb} MB each. Images, PDF, archives, text, HWP/HWPX, Office, and OpenDocument files are supported.",
    "forum.attachmentTooMany": "You can attach up to {maxFiles} files.",
    "forum.attachmentTooLarge": "Each attachment must be {maxSizeMb} MB or smaller.",
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
    "forum.views": "조회",
    "forum.commentsCount": "댓글",
    "forum.reactions": "추천",
    "forum.recommend": "추천",
    "forum.recommended": "추천 취소",
    "forum.engagementFailed": "추천을 변경하지 못했습니다.",
    "forum.subscribeBoard": "게시판 구독",
    "forum.subscribedBoard": "게시판 구독 중",
    "forum.subscribePost": "게시글 구독",
    "forum.subscribedPost": "게시글 구독 중",
    "forum.subscriptionLoading": "구독 상태 확인 중…",
    "forum.signInToSubscribe": "로그인 후 구독",
    "forum.subscriptionFailed": "구독 상태를 변경하지 못했습니다.",
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
    "forum.report": "신고",
    "forum.reportTitle": "게시글 신고",
    "forum.reportHelp": "문제가 되는 내용을 운영자에게 간단히 알려주세요.",
    "forum.reportPlaceholder": "광고, 괴롭힘, 불법 콘텐츠 등",
    "forum.reportSubmit": "신고 보내기",
    "forum.reportSubmitting": "보내는 중…",
    "forum.reportSuccess": "운영자에게 신고를 보냈습니다.",
    "forum.reportClose": "닫기",
    "forum.reportFailed": "신고를 보내지 못했습니다.",
    "forum.signIn": "로그인",
    "forum.register": "회원가입",
    "forum.loginRequired": "게시글을 쓰려면 계정이 필요합니다.",
    "forum.commentsLocked": "잠긴 게시글입니다. 기존 댓글은 계속 볼 수 있습니다.",
    "forum.commentsEmpty": "아직 댓글이 없습니다.",
    "forum.commentsLoadFailed": "댓글을 불러오지 못했습니다.",
    "forum.commentsSort": "댓글 정렬",
    "forum.commentsOldest": "등록순",
    "forum.commentsNewest": "최신순",
    "forum.commentsTop": "추천순",
    "forum.commentsSignInPrompt": "후 댓글을 작성할 수 있습니다.",
    "forum.commentPlaceholder": "댓글을 입력하세요. 굵게, 기울임, 코드를 사용할 수 있습니다.",
    "forum.commentPost": "댓글 등록",
    "forum.commentPosting": "등록 중…",
    "forum.commentPostFailed": "댓글을 등록하지 못했습니다.",
    "forum.commentReply": "답글",
    "forum.commentReplyingTo": "답글 대상",
    "forum.commentReplyPlaceholder": "답글을 입력하세요.",
    "forum.commentPostReply": "답글 등록",
    "forum.commentEditFailed": "댓글을 수정하지 못했습니다.",
    "forum.commentDeleteConfirm": "이 댓글을 삭제할까요? 본문은 영구적으로 지워집니다.",
    "forum.commentDeleteFailed": "댓글을 삭제하지 못했습니다.",
    "forum.commentEdited": "수정됨",
    "forum.commentImported": "가져온 댓글",
    "forum.commentImportedTitle": "WordPress 내보내기에서 가져온 댓글입니다.",
    "forum.commentUnknownAuthor": "알 수 없는 회원",
    "forum.commentSignInToReact": "로그인 후 추천",
    "forum.commentReportTitle": "댓글 신고",
    "forum.commentReportReasonLabel": "신고 사유",
    "forum.commentMute": "차단",
    "forum.commentMuting": "차단 중…",
    "forum.commentMuteTitle": "이 회원 차단",
    "forum.commentMuteConfirm":
      "이 회원을 차단할까요? 해당 회원의 댓글과 반응 알림이 숨겨지며 프로필에서 해제할 수 있습니다.",
    "forum.commentMuteFailed": "회원을 차단하지 못했습니다.",
    "forum.emptyBody": "내용이 없습니다.",
    "forum.attachments": "첨부파일",
    "forum.attachmentAdd": "파일 추가",
    "forum.attachmentUploading": "업로드 중…",
    "forum.attachmentRemove": "삭제",
    "forum.attachmentUploadFailed": "파일을 업로드하지 못했습니다.",
    "forum.attachmentHelp":
      "파일당 {maxSizeMb}MB, 최대 {maxFiles}개. 이미지, PDF, 압축, 텍스트, HWP/HWPX, Office, OpenDocument 파일을 지원합니다.",
    "forum.attachmentTooMany": "첨부파일은 최대 {maxFiles}개까지 등록할 수 있습니다.",
    "forum.attachmentTooLarge": "첨부파일 한 개의 크기는 {maxSizeMb}MB 이하여야 합니다.",
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
        attachments: '[data-np-forum-attachments="list"]',
        "attachment-item": "[data-np-forum-attachment]",
        engagement: '[data-np-forum-engagement="post"]',
        subscription: "[data-np-forum-subscription]",
        "engagement-summary": '[data-np-forum-engagement="summary"]',
        "board-directory-block": '[data-np-forum-block="board-directory"]',
        "post-feed-block": '[data-np-forum-block="post-feed"]',
        "feed-item": ".np-forum-block-feed-list > li",
      },
    },
    blocks,
    patterns: forumHomePatterns,
    i18n: messages,
    hooks: {
      "content:afterPublish": async ({ data }) => {
        const { collection, document, principal } = data;
        if (collection !== runtime.collections.posts || document.visibility !== "public") return;
        const boardValue = document.board;
        const boardId =
          typeof boardValue === "string"
            ? boardValue
            : boardValue &&
                typeof boardValue === "object" &&
                "id" in boardValue &&
                typeof boardValue.id === "string"
              ? boardValue.id
              : null;
        const postId = typeof document.id === "string" ? document.id : null;
        const boardKey = typeof document.boardKey === "string" ? document.boardKey : null;
        const memberAuthorId =
          typeof document.memberAuthorId === "string" ? document.memberAuthorId : null;
        if (!boardId || !postId || !boardKey) return;
        await notifyFollowers({
          activity: "document.published",
          subjectType: runtime.collections.boards,
          subjectId: boardId,
          targetType: runtime.collections.posts,
          targetId: postId,
          href: `${runtime.basePath}/${boardKey}/${postId}`,
          commentId: null,
          actorMemberId: principal?.kind === "member" ? principal.memberId : memberAuthorId,
        });
      },
    },
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
  NpForumAttachment,
  NpForumAttachmentPolicy,
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
