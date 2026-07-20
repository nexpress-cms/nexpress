import { findDocuments, type NpFindWhere } from "@nexpress/core";
import { buildPageMetadata, getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";
import { ForumSubscriptionAction } from "@nexpress/plugin-forum/client";

import {
  enrichForumPosts,
  findForumBoardByKey,
  getForumMessages,
  resolveForumSkin,
  type ForumPostDocument,
  type NpForumRuntime,
} from "../runtime.js";
import {
  buildForumPostListHref,
  npForumPostListQueryLimits,
  parseForumPostListQuery,
} from "./post-list-query.js";

export function createBoardPostsMetadata(runtime: NpForumRuntime) {
  return async function boardPostsMetadata({ params }: NpRouteRenderProps) {
    const board = await findForumBoardByKey(runtime, params.boardKey ?? "");
    return buildPageMetadata({
      title: board?.name ?? "Forum board",
      description: board?.description ?? null,
      path: board ? `${runtime.basePath}/${board.key}` : runtime.basePath,
    });
  };
}

export function createBoardPostsRoute(runtime: NpForumRuntime) {
  return async function BoardPostsRoute({ params, searchParams }: NpRouteRenderProps) {
    const board = await findForumBoardByKey(runtime, params.boardKey ?? "");
    if (!board) notFound();

    const member = await getSiteMember();
    const parsedQuery = parseForumPostListQuery(searchParams, board.categories);
    if (!parsedQuery) notFound();
    if (parsedQuery.showMine && !member) notFound();
    const query = parsedQuery;
    const where: NpFindWhere<ForumPostDocument> = { board: board.id };
    if (query.showMine && member) {
      where.memberAuthorId = member.id;
    } else {
      where.status = "published";
      where.pinned = false;
    }
    if (query.category) where.category = query.category;

    const showPinned = !query.showMine && !query.search && !query.category && query.page === 1;

    const [result, pinnedResult, messages] = await Promise.all([
      findDocuments<ForumPostDocument>(runtime.collections.posts, {
        where,
        ...(query.search ? { search: query.search } : { sort: "-createdAt" }),
        page: query.page,
        limit: board.pageSize,
      }),
      showPinned
        ? findDocuments<ForumPostDocument>(runtime.collections.posts, {
            where: { board: board.id, status: "published", pinned: true },
            sort: "-createdAt",
            page: 1,
            limit: 100,
          })
        : Promise.resolve({ docs: [] as ForumPostDocument[] }),
      getForumMessages(),
    ]);
    if (query.page > Math.max(1, result.totalPages)) notFound();
    const [posts, pinnedPosts] = await Promise.all([
      enrichForumPosts(result.docs, runtime.collections.posts),
      enrichForumPosts(pinnedResult.docs, runtime.collections.posts),
    ]);

    return resolveForumSkin(runtime, board.skinId).renderPostList({
      basePath: runtime.basePath,
      board,
      posts,
      pinnedPosts,
      totalPages: result.totalPages,
      totalPosts: result.totalDocs,
      query,
      searchMaxLength: npForumPostListQueryLimits.searchLength,
      isAuthenticated: member !== null,
      canCreate: member !== null && board.writeMode === "members",
      subscriptionAction: (
        <ForumSubscriptionAction
          targetType={runtime.collections.boards}
          targetId={board.id}
          isAuthenticated={member !== null}
          loginHref={`/members/login?next=${encodeURIComponent(`${runtime.basePath}/${board.key}`)}`}
          labels={{
            subscribe: messages.subscribeBoard,
            subscribed: messages.subscribedBoard,
            loading: messages.subscriptionLoading,
            signIn: messages.signInToSubscribe,
            failed: messages.subscriptionFailed,
          }}
        />
      ),
      messages,
      hrefForQuery: (patch) => buildForumPostListHref(runtime.basePath, board.key, query, patch),
    });
  };
}
