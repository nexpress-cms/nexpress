import { getSiteMember } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ForumPostForm } from "@nexpress/plugin-forum/client";

import {
  findForumBoardByKey,
  getForumAttachmentFormLabels,
  getForumMessages,
  resolveForumSkin,
  type NpForumRuntime,
} from "../runtime.js";

export function createForumPostNewRoute(runtime: NpForumRuntime) {
  return async function ForumPostNewRoute({ params }: NpRouteRenderProps) {
    const member = await getSiteMember();
    const [board, messages] = await Promise.all([
      findForumBoardByKey(runtime, params.boardKey ?? "", member?.id ?? null),
      getForumMessages(),
    ]);
    if (!board || board.writeMode !== "members") notFound();
    const attachmentLabels = await getForumAttachmentFormLabels(board);
    const next = `${runtime.basePath}/${board.key}/new`;
    const content = member ? (
      <ForumPostForm
        mode="create"
        basePath={runtime.basePath}
        collectionSlug={runtime.collections.posts}
        board={{
          id: board.id,
          key: board.key,
          audience: board.audience,
          categories: board.categories,
          attachments: board.attachments,
        }}
        labels={{
          category: messages.category,
          categoryNone: messages.categoryNone,
          audience: messages.audience,
          audiencePublic: messages.audiencePublic,
          audienceMembers: messages.audienceMembers,
          audiencePrivate: messages.audiencePrivate,
          title: messages.title,
          body: messages.body,
          loadingEditor: messages.loadingEditor,
          saving: messages.saving,
          create: messages.create,
          save: messages.save,
          saveFailed: messages.saveFailed,
          ...attachmentLabels,
        }}
      />
    ) : (
      <p className="np-forum-auth-prompt">
        {messages.loginRequired}{" "}
        <Link href={`/members/login?next=${encodeURIComponent(next)}`}>{messages.signIn}</Link> /{" "}
        <Link href={`/members/register?next=${encodeURIComponent(next)}`}>{messages.register}</Link>
      </p>
    );
    return resolveForumSkin(runtime, board.skinId).renderPostComposer({
      basePath: runtime.basePath,
      board,
      mode: "create",
      title: messages.newPost,
      backHref: `${runtime.basePath}/${board.key}`,
      backLabel: board.name,
      content,
      messages,
    });
  };
}
