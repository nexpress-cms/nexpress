import {
  buildDiscussionForumPostingJsonLd,
  getDocumentById,
  getSiteSeoSettings,
} from "@nexpress/core";
import {
  getDocumentModerationPermissions,
  listMemberDocumentReportCases,
} from "@nexpress/core/community";
import { npToReportWireRow } from "@nexpress/core/community-contract";
import { isNpRichTextContent } from "@nexpress/core/fields";
import type { NpRichTextContent } from "@nexpress/editor";
import { renderRichText } from "@nexpress/editor/server";
import { Comments } from "@nexpress/next/client";
import { buildPageMetadata, getSiteMember, JsonLd } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";
import { notFound } from "next/navigation";

import {
  ForumPostActions,
  ForumPostEngagement,
  ForumModerationPanel,
  ForumPostReportAction,
  ForumSubscriptionAction,
} from "@nexpress/plugin-forum/client";

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
    const isPublic = post.status === "published" && post.visibility === "public";
    const permissions = member
      ? await getDocumentModerationPermissions(member.id, runtime.collections.posts, post.id)
      : null;
    if (
      (post.status !== "published" || post.visibility !== "public") &&
      !isOwner &&
      permissions?.editThread !== true &&
      !permissions?.actions.includes("restore")
    ) {
      notFound();
    }

    const [summary] = await enrichForumPosts([post], runtime.collections.posts);
    if (!summary) notFound();
    const body: NpRichTextContent | null = isNpRichTextContent(post.body) ? post.body : null;
    const [messages, attachments, reportCases] = await Promise.all([
      getForumMessages(),
      resolveForumAttachments(post.attachments),
      member && permissions?.resolveReports
        ? listMemberDocumentReportCases(member.id, runtime.collections.posts, post.id)
        : Promise.resolve([]),
    ]);
    const comments =
      post.status === "published" ? (
        <Comments
          collectionSlug={runtime.collections.posts}
          documentId={post.id}
          locked={post.locked === true}
          lockedMessage={messages.commentsLocked}
          locale={messages.locale}
          labels={{
            title: messages.commentsCount,
            empty: messages.commentsEmpty,
            loadFailed: messages.commentsLoadFailed,
            sortLabel: messages.commentsSort,
            oldest: messages.commentsOldest,
            newest: messages.commentsNewest,
            top: messages.commentsTop,
            signIn: messages.signIn,
            signInPrompt: messages.commentsSignInPrompt,
            placeholder: messages.commentPlaceholder,
            post: messages.commentPost,
            posting: messages.commentPosting,
            postFailed: messages.commentPostFailed,
            reply: messages.commentReply,
            replyingTo: messages.commentReplyingTo,
            replyPlaceholder: messages.commentReplyPlaceholder,
            postReply: messages.commentPostReply,
            edit: messages.edit,
            save: messages.save,
            saving: messages.saving,
            editFailed: messages.commentEditFailed,
            delete: messages.delete,
            deleting: messages.deleting,
            deleteConfirm: messages.commentDeleteConfirm,
            deleteFailed: messages.commentDeleteFailed,
            cancel: messages.cancel,
            edited: messages.commentEdited,
            imported: messages.commentImported,
            importedTitle: messages.commentImportedTitle,
            unknownAuthor: messages.commentUnknownAuthor,
            previous: messages.previous,
            next: messages.next,
            page: messages.pagination,
            like: messages.recommend,
            unlike: messages.recommended,
            signInToReact: messages.commentSignInToReact,
            reactionFailed: messages.engagementFailed,
            report: messages.report,
            reportTitle: messages.commentReportTitle,
            reportHelp: messages.reportHelp,
            reportReasonLabel: messages.commentReportReasonLabel,
            reportPlaceholder: messages.reportPlaceholder,
            reportSubmit: messages.reportSubmit,
            reportSubmitting: messages.reportSubmitting,
            reportSuccess: messages.reportSuccess,
            close: messages.reportClose,
            reportFailed: messages.reportFailed,
            mute: messages.commentMute,
            muting: messages.commentMuting,
            muteTitle: messages.commentMuteTitle,
            muteConfirm: messages.commentMuteConfirm,
            muteFailed: messages.commentMuteFailed,
            hide: messages.hideComment,
            hiding: messages.hidingComment,
            hideFailed: messages.moderationActionFailed,
            restore: messages.restoreComment,
            restoring: messages.restoringComment,
            restoreFailed: messages.moderationActionFailed,
          }}
          moderation={
            permissions
              ? {
                  editAny: permissions.editComments,
                  deleteAny: permissions.deleteComments,
                  hide: permissions.hideComments,
                  restore: permissions.restoreComments,
                }
              : undefined
          }
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
      authorActions:
        isOwner ||
        permissions?.editThread ||
        permissions?.deleteThread ||
        (permissions?.actions.length ?? 0) > 0 ? (
          <ForumPostActions
            basePath={runtime.basePath}
            collectionSlug={runtime.collections.posts}
            boardKey={board.key}
            postId={post.id}
            canEdit={isOwner || permissions?.editThread === true}
            canDelete={isOwner || permissions?.deleteThread === true}
            moderationActions={permissions?.actions ?? []}
            labels={{
              edit: messages.edit,
              delete: messages.delete,
              deleteConfirm: messages.deleteConfirm,
              cancel: messages.cancel,
              deleting: messages.deleting,
              deleteFailed: messages.deleteFailed,
              hide: messages.hidePost,
              restore: messages.restorePost,
              lock: messages.lockPost,
              unlock: messages.unlockPost,
              pin: messages.pinPost,
              unpin: messages.unpinPost,
              moderationFailed: messages.moderationActionFailed,
            }}
          />
        ) : null,
      reportAction:
        member !== null &&
        !isOwner &&
        post.status === "published" &&
        post.visibility === "public" ? (
          <ForumPostReportAction
            collectionSlug={runtime.collections.posts}
            postId={post.id}
            labels={{
              report: messages.report,
              title: messages.reportTitle,
              help: messages.reportHelp,
              placeholder: messages.reportPlaceholder,
              submit: messages.reportSubmit,
              submitting: messages.reportSubmitting,
              success: messages.reportSuccess,
              close: messages.reportClose,
              cancel: messages.cancel,
              failed: messages.reportFailed,
            }}
          />
        ) : null,
      subscriptionAction: isPublic ? (
        <ForumSubscriptionAction
          targetType={runtime.collections.posts}
          targetId={post.id}
          isAuthenticated={member !== null}
          loginHref={`/members/login?next=${encodeURIComponent(`${runtime.basePath}/${board.key}/${post.id}`)}`}
          labels={{
            subscribe: messages.subscribePost,
            subscribed: messages.subscribedPost,
            loading: messages.subscriptionLoading,
            signIn: messages.signInToSubscribe,
            failed: messages.subscriptionFailed,
          }}
        />
      ) : null,
      moderationPanel:
        reportCases.length > 0 ? (
          <ForumModerationPanel
            cases={reportCases.map(({ report, target, actions }) => ({
              report: npToReportWireRow(report),
              target,
              actions,
            }))}
            locale={messages.locale}
            labels={{
              title: messages.reportsPending,
              reason: messages.reportReason,
              dismiss: messages.dismissReport,
              hideComment: messages.hideReportedComment,
              hidePost: messages.hideReportedPost,
              resolving: messages.resolvingReport,
              failed: messages.resolveReportFailed,
            }}
          />
        ) : null,
      engagement: (
        <ForumPostEngagement
          targetType={runtime.collections.posts}
          targetId={post.id}
          initial={summary.engagement}
          locale={messages.locale}
          isAuthenticated={member !== null && isPublic}
          trackViews={isPublic}
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
