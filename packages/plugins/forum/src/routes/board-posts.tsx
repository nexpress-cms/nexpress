import { findDocuments, type NpFindWhere } from "@nexpress/core";
import { buildPageMetadata, getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import {
  enrichForumPosts,
  findForumBoardByKey,
  getForumMessages,
  resolveForumSkin,
  type ForumPostDocument,
  type NpForumRuntime,
} from "../runtime.js";

function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

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
    const showMine = firstParam(searchParams.author) === "me" && member !== null;
    const page = Math.max(1, Number.parseInt(firstParam(searchParams.page) ?? "1", 10) || 1);
    const where: NpFindWhere<ForumPostDocument> = { board: board.id };
    if (showMine && member) {
      where.memberAuthorId = member.id;
    } else {
      where.status = "published";
      where.pinned = false;
    }

    const [result, pinnedResult, messages] = await Promise.all([
      findDocuments<ForumPostDocument>(runtime.collections.posts, {
        where,
        sort: "-createdAt",
        page,
        limit: board.pageSize,
      }),
      !showMine && page === 1
        ? findDocuments<ForumPostDocument>(runtime.collections.posts, {
            where: { board: board.id, status: "published", pinned: true },
            sort: "-createdAt",
            page: 1,
            limit: 100,
          })
        : Promise.resolve({ docs: [] as ForumPostDocument[] }),
      getForumMessages(),
    ]);
    const [posts, pinnedPosts] = await Promise.all([
      enrichForumPosts(result.docs),
      enrichForumPosts(pinnedResult.docs),
    ]);

    return resolveForumSkin(runtime, board.skinId).renderPostList({
      basePath: runtime.basePath,
      board,
      posts,
      pinnedPosts,
      page,
      totalPages: result.totalPages,
      totalPosts: result.totalDocs,
      showMine,
      isAuthenticated: member !== null,
      canCreate: member !== null && board.writeMode === "members",
      messages,
      hrefForPage: (nextPage) => {
        const query = new URLSearchParams({
          ...(showMine ? { author: "me" } : {}),
          page: String(nextPage),
        });
        return `${runtime.basePath}/${board.key}?${query.toString()}`;
      },
    });
  };
}
