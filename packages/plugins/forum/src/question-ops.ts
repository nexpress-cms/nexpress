import { findDocuments, getPluginRegistration, isPluginEnabled } from "@nexpress/core";
import { npListContentEngagement } from "@nexpress/core/community";
import type { NpPluginPageRouteRegistration } from "@nexpress/plugin-sdk";
import { findForumBoardByKey, type ForumPostDocument, type NpForumRuntime } from "./runtime.js";

const forumInstances = new WeakMap<object, NpForumRuntime>();
const questionSampleSize = 50;

export function rememberForumQuestionSource(
  detail: NpPluginPageRouteRegistration["component"],
  runtime: NpForumRuntime,
): void {
  forumInstances.set(detail, runtime);
}

/** Observe public threads through the installed forum instance and current site. */
export async function npReadForumUnansweredQuestions(boardKey: string) {
  const forum = getPluginRegistration("forum");
  if (!forum || !(await isPluginEnabled("forum"))) return null;
  const runtime = forum.pageRoutes
    .map(({ component }) =>
      typeof component === "function" ? forumInstances.get(component) : undefined,
    )
    .find(Boolean);
  if (!runtime) return null;
  const board = await findForumBoardByKey(runtime, boardKey);
  if (!board) return null;

  const { docs, totalDocs } = await findDocuments<ForumPostDocument>(runtime.collections.posts, {
    where: {
      board: board.id,
      status: "published",
      visibility: "public",
      audience: "public",
      moderationHidden: false,
    },
    sort: "-createdAt",
    limit: questionSampleSize,
  });
  const unansweredCandidates = docs.filter((post) => !post.answeredAt);
  const engagement = await npListContentEngagement(
    runtime.collections.posts,
    unansweredCandidates.map((post) => post.id),
  );
  const answered = new Set(
    engagement.filter(({ commentCount }) => commentCount > 0).map(({ targetId }) => targetId),
  );
  return {
    boardHref: `${runtime.basePath}/${board.key}`,
    complete: totalDocs <= docs.length,
    inspected: docs.length,
    items: unansweredCandidates
      .filter((post) => !answered.has(post.id))
      .map(({ id, title }) => ({ title, href: `${runtime.basePath}/${board.key}/${id}` })),
  };
}
