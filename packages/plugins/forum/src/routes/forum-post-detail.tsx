import {
  buildDiscussionForumPostingJsonLd,
  getDocumentById,
  getSiteSeoSettings,
} from "@nexpress/core";
import { isNpRichTextContent } from "@nexpress/core/fields";
import type { NpRichTextContent } from "@nexpress/editor";
import { renderRichText } from "@nexpress/editor/server";
import { Comments } from "@nexpress/next/client";
import { buildPageMetadata, getSiteMember, JsonLd } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { ForumPostActions } from "@nexpress/plugin-forum/client";
import { ForumPostEngagement } from "@nexpress/plugin-forum/client";

import {
  enrichForumPosts,
  findForumBoardByKey,
  getForumMessages,
  isForumPostId,
  resolveForumSkin,
  resolveForumAttachments,
  type ForumPostDocument,
  type NpForumRuntime,
} from "../runtime.js";

async function getPost(runtime: NpForumRuntime, boardKey: string, postId: string) {
  if (!isForumPostId(postId)) return null;
  const board = await findForumBoardByKey(runtime, boardKey);
  if (!board) return null;
  const post = await getDocumentById<ForumPostDocument>(runtime.collections.posts, postId);
  if (!post || post.board !== board.id) return null;
  return { board, post };
}

export function createForumPostMetadata(runtime: NpForumRuntime) {
  return async function forumPostMetadata({ params }: NpRouteRenderProps) {
    const result = await getPost(runtime, params.boardKey ?? "", params.postId ?? "");
    const published = result?.post.status === "published" && result.post.visibility === "public";
    return buildPageMetadata({
      title: published ? result.post.title : "Forum post",
      description: null,
      path: published
        ? `${runtime.basePath}/${result.board.key}/${result.post.id}`
        : runtime.basePath,
      ogType: published ? "article" : "website",
      publishedTime: published ? result.post.createdAt : null,
      modifiedTime: published ? result.post.updatedAt : null,
    });
  };
}

export function createForumPostDetailRoute(runtime: NpForumRuntime) {
  return async function ForumPostDetailRoute({ params }: NpRouteRenderProps) {
    const result = await getPost(runtime, params.boardKey ?? "", params.postId ?? "");
    if (!result) notFound();
    const { board, post } = result;
    const member = await getSiteMember();
    const isOwner = member !== null && post.memberAuthorId === member.id;
    if ((post.status !== "published" || post.visibility !== "public") && !isOwner) notFound();

    const [summary] = await enrichForumPosts([post], runtime.collections.posts);
    if (!summary) notFound();
    const body: NpRichTextContent | null = isNpRichTextContent(post.body) ? post.body : null;
    const [messages, attachments] = await Promise.all([
      getForumMessages(),
      resolveForumAttachments(post.attachments),
    ]);
    const comments =
      post.status === "published" ? (
        <Comments
          collectionSlug={runtime.collections.posts}
          documentId={post.id}
          locked={post.locked === true}
          lockedMessage={messages.commentsLocked}
        />
      ) : null;

    const jsonLd =
      post.status === "published" && post.visibility === "public"
        ? await (async () => {
            const settings = await getSiteSeoSettings();
            return buildDiscussionForumPostingJsonLd({
              url: `${settings.siteUrl.replace(/\/+$/u, "")}${runtime.basePath}/${board.key}/${post.id}`,
              headline: post.title,
              description: null,
              datePublished: post.createdAt,
              dateModified: post.updatedAt,
              authorName: summary.author?.displayName ?? null,
            });
          })()
        : null;
    const page = await resolveForumSkin(runtime, board.skinId).renderPostDetail({
      basePath: runtime.basePath,
      board,
      post: summary,
      body: body ? renderRichText(body) : <p>{messages.emptyBody}</p>,
      authorActions: isOwner ? (
        <ForumPostActions
          basePath={runtime.basePath}
          collectionSlug={runtime.collections.posts}
          boardKey={board.key}
          postId={post.id}
          labels={{
            edit: messages.edit,
            delete: messages.delete,
            deleteConfirm: messages.deleteConfirm,
            cancel: messages.cancel,
            deleting: messages.deleting,
            deleteFailed: messages.deleteFailed,
          }}
        />
      ) : null,
      engagement: (
        <ForumPostEngagement
          targetType={runtime.collections.posts}
          targetId={post.id}
          initial={summary.engagement}
          locale={messages.locale}
          isAuthenticated={
            member !== null && post.status === "published" && post.visibility === "public"
          }
          trackViews={post.status === "published" && post.visibility === "public"}
          labels={{
            views: messages.views,
            comments: messages.commentsCount,
            reactions: messages.reactions,
            recommend: messages.recommend,
            recommended: messages.recommended,
            failed: messages.engagementFailed,
          }}
        />
      ),
      comments,
      attachments,
      messages,
    });
    return (
      <>
        {jsonLd ? <JsonLd data={jsonLd as unknown as Record<string, unknown>} /> : null}
        {page}
      </>
    );
  };
}
