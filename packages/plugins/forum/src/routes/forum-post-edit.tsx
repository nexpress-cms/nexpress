import { getDocumentById } from "@nexpress/core";
import { getDocumentModerationPermissions } from "@nexpress/core/community";
import { isNpRichTextContent } from "@nexpress/core/fields";
import { getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import { ForumPostForm } from "@nexpress/plugin-forum/client";

import {
  findForumBoardByKey,
  getForumAttachmentFormLabels,
  getForumMessages,
  isForumPostId,
  resolveForumSkin,
  resolveForumAttachments,
  type ForumPostDocument,
  type NpForumRuntime,
} from "../runtime.js";

export function createForumPostEditRoute(runtime: NpForumRuntime) {
  return async function ForumPostEditRoute({ params }: NpRouteRenderProps) {
    const [board, member, messages] = await Promise.all([
      findForumBoardByKey(runtime, params.boardKey ?? ""),
      getSiteMember(),
      getForumMessages(),
    ]);
    if (!board || !member) notFound();
    const postId = params.postId ?? "";
    if (!isForumPostId(postId)) notFound();
    const post = await getDocumentById<ForumPostDocument>(runtime.collections.posts, postId);
    if (!post || post.board !== board.id) notFound();
    const isOwner = post.memberAuthorId === member.id;
    const permissions = isOwner
      ? null
      : await getDocumentModerationPermissions(member.id, runtime.collections.posts, post.id);
    if (!isOwner && permissions?.editThread !== true) notFound();
    const [attachmentLabels, attachments] = await Promise.all([
      getForumAttachmentFormLabels(board),
      resolveForumAttachments(post.attachments),
    ]);

    const content = (
      <ForumPostForm
        mode="edit"
        basePath={runtime.basePath}
        collectionSlug={runtime.collections.posts}
        board={{
          id: board.id,
          key: board.key,
          categories: board.categories,
          attachments: board.attachments,
        }}
        labels={{
          category: messages.category,
          categoryNone: messages.categoryNone,
          title: messages.title,
          body: messages.body,
          loadingEditor: messages.loadingEditor,
          saving: messages.saving,
          create: messages.create,
          save: messages.save,
          saveFailed: messages.saveFailed,
          ...attachmentLabels,
        }}
        initial={{
          postId: post.id,
          title: post.title,
          body: isNpRichTextContent(post.body) ? post.body : null,
          category: typeof post.category === "string" ? post.category : null,
          attachments,
        }}
      />
    );
    return resolveForumSkin(runtime, board.skinId).renderPostComposer({
      basePath: runtime.basePath,
      board,
      mode: "edit",
      title: messages.editPost,
      backHref: `${runtime.basePath}/${board.key}/${post.id}`,
      backLabel: messages.backToPost,
      content,
      messages,
    });
  };
}
