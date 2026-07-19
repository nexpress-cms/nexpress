import { getDocumentById } from "@nexpress/core";
import { isNpRichTextContent } from "@nexpress/core/fields";
import { getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ForumPostForm } from "@nexpress/plugin-forum/client";

import {
  findForumBoardByKey,
  getForumMessages,
  isForumPostId,
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
    if (!post || post.board !== board.id || post.memberAuthorId !== member.id) notFound();

    return (
      <main className="np-forum np-forum-member-page">
        <header className="np-forum-page-header">
          <div>
            <Link href={`${runtime.basePath}/${board.key}/${post.id}`}>
              ← {messages.backToPost}
            </Link>
            <h1>{messages.editPost}</h1>
          </div>
        </header>
        <ForumPostForm
          mode="edit"
          basePath={runtime.basePath}
          collectionSlug={runtime.collections.posts}
          board={{ id: board.id, key: board.key, categories: board.categories }}
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
          }}
          initial={{
            postId: post.id,
            title: post.title,
            body: isNpRichTextContent(post.body) ? post.body : null,
            category: typeof post.category === "string" ? post.category : null,
          }}
        />
      </main>
    );
  };
}
