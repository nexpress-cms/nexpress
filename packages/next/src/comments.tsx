"use client";

import type { NpCommentListItemWire, NpCommentListWire } from "@nexpress/core/community-contract";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { npBuildCommentTree, type NpCommentTreeNode } from "./comments-model.js";

type CommentSort = "newest" | "oldest" | "top";

export interface NpCommentsLabels {
  title: string;
  empty: string;
  loadFailed: string;
  sortLabel: string;
  oldest: string;
  newest: string;
  top: string;
  signIn: string;
  signInPrompt: string;
  placeholder: string;
  post: string;
  posting: string;
  postFailed: string;
  reply: string;
  replyingTo: string;
  replyPlaceholder: string;
  postReply: string;
  edit: string;
  save: string;
  saving: string;
  editFailed: string;
  delete: string;
  deleting: string;
  deleteConfirm: string;
  deleteFailed: string;
  cancel: string;
  edited: string;
  imported: string;
  importedTitle: string;
  unknownAuthor: string;
  previous: string;
  next: string;
  page: string;
  like: string;
  unlike: string;
  signInToReact: string;
  reactionFailed: string;
  report: string;
  reportTitle: string;
  reportHelp: string;
  reportReasonLabel: string;
  reportPlaceholder: string;
  reportSubmit: string;
  reportSubmitting: string;
  reportSuccess: string;
  close: string;
  reportFailed: string;
  mute: string;
  muting: string;
  muteTitle: string;
  muteConfirm: string;
  muteFailed: string;
  hide: string;
  hiding: string;
  hideFailed: string;
  restore: string;
  restoring: string;
  restoreFailed: string;
}

const DEFAULT_LABELS: NpCommentsLabels = {
  title: "Comments",
  empty: "No comments yet.",
  loadFailed: "Could not load comments.",
  sortLabel: "Comment sort order",
  oldest: "Oldest",
  newest: "Newest",
  top: "Top",
  signIn: "Log in",
  signInPrompt: "to comment.",
  placeholder: "Write a comment… **bold**, *italic*, `code` supported.",
  post: "Post comment",
  posting: "Posting…",
  postFailed: "Failed to post comment.",
  reply: "Reply",
  replyingTo: "Replying to",
  replyPlaceholder: "Write a reply…",
  postReply: "Post reply",
  edit: "Edit",
  save: "Save",
  saving: "Saving…",
  editFailed: "Failed to edit comment.",
  delete: "Delete",
  deleting: "Deleting…",
  deleteConfirm: "Delete this comment? Its text will be removed permanently.",
  deleteFailed: "Failed to delete comment.",
  cancel: "Cancel",
  edited: "edited",
  imported: "imported",
  importedTitle: "Imported from a WordPress export",
  unknownAuthor: "Unknown member",
  previous: "Previous",
  next: "Next",
  page: "Page",
  like: "Like",
  unlike: "Unlike",
  signInToReact: "Log in to react",
  reactionFailed: "Could not update this reaction.",
  report: "Report",
  reportTitle: "Report this comment",
  reportHelp: "Tell us briefly what's wrong. Moderators see this verbatim.",
  reportReasonLabel: "Report reason",
  reportPlaceholder: "e.g. Spam, harassment, off-topic…",
  reportSubmit: "Send report",
  reportSubmitting: "Sending…",
  reportSuccess: "Thanks — a moderator will review it.",
  close: "Close",
  reportFailed: "Failed to file report.",
  mute: "Mute",
  muting: "Muting…",
  muteTitle: "Mute this member",
  muteConfirm:
    "Mute this member? Their comments and reaction notifications will be hidden from you. You can unmute later from your profile.",
  muteFailed: "Failed to mute member.",
  hide: "Hide",
  hiding: "Hiding…",
  hideFailed: "Failed to hide comment.",
  restore: "Restore",
  restoring: "Restoring…",
  restoreFailed: "Failed to restore comment.",
};

export interface NpCommentsModerationPermissions {
  editAny?: boolean;
  deleteAny?: boolean;
  hide?: boolean;
  restore?: boolean;
}

export interface CommentsProps {
  collectionSlug: string;
  documentId: string;
  /** Hide every reply/composer control while keeping the thread readable. */
  locked?: boolean;
  lockedMessage?: string;
  /** Locale used only for public dates and number formatting. */
  locale?: string;
  /** Copy supplied by the host plugin/theme. Missing keys fall back to English. */
  labels?: Partial<NpCommentsLabels>;
  /** Bounded API page size. */
  pageSize?: number;
  /** Server-resolved member moderator capabilities for this exact document. */
  moderation?: NpCommentsModerationPermissions;
}

function responseError(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return fallback;
}

async function errorFromResponse(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as unknown;
  return new Error(responseError(body, fallback));
}

/**
 * Framework-owned public comment surface. The list API supplies an exact,
 * viewer-aware page: author profiles and reaction summaries arrive with each
 * row, while reply/edit/delete reuse the canonical community write routes.
 */
export function Comments({
  collectionSlug,
  documentId,
  locked = false,
  lockedMessage = "This discussion is locked. Existing comments remain visible.",
  locale,
  labels: labelOverrides,
  pageSize = 20,
  moderation,
}: CommentsProps) {
  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides]);
  const requestedPageSize = Number.isFinite(pageSize) ? Math.trunc(pageSize) : 20;
  const limit = Math.min(Math.max(requestedPageSize, 1), 200);
  const [comments, setComments] = useState<NpCommentListItemWire[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [sort, setSort] = useState<CommentSort>("oldest");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [memberKnown, setMemberKnown] = useState<boolean | null>(null);
  const [viewerMemberId, setViewerMemberId] = useState<string | null>(null);
  const [bodyMd, setBodyMd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const listRequestId = useRef(0);

  const load = useCallback(
    async (nextOffset: number, nextSort: CommentSort): Promise<boolean> => {
      const requestId = ++listRequestId.current;
      setLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams({
          order: nextSort,
          limit: limit.toString(),
          offset: nextOffset.toString(),
        });
        if (moderation?.restore) params.set("includeHidden", "1");
        const response = await fetch(
          `/api/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(documentId)}/comments?${params.toString()}`,
          { credentials: "include" },
        );
        if (!response.ok) throw await errorFromResponse(response, labels.loadFailed);
        const body = (await response.json()) as NpCommentListWire;
        if (requestId !== listRequestId.current) return false;
        setComments(body.comments);
        setTotal(body.totalDocs);
        setOffset(nextOffset);
        setSort(nextSort);
        setHasNextPage(body.hasNextPage);
        setHasPrevPage(body.hasPrevPage);
        return true;
      } catch (error) {
        if (requestId !== listRequestId.current) return false;
        setListError(error instanceof Error ? error.message : labels.loadFailed);
        return false;
      } finally {
        if (requestId === listRequestId.current) setLoading(false);
      }
    },
    [collectionSlug, documentId, labels.loadFailed, limit, moderation?.restore],
  );

  useEffect(() => {
    void load(0, "oldest");
  }, [load]);

  useEffect(() => {
    fetch("/api/members/me", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          setMemberKnown(false);
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          member?: { id?: unknown };
        } | null;
        const id = body?.member?.id;
        setViewerMemberId(typeof id === "string" ? id : null);
        setMemberKnown(true);
      })
      .catch(() => setMemberKnown(false));
  }, []);

  const refresh = useCallback(async () => load(offset, sort), [load, offset, sort]);
  const tree = useMemo(() => npBuildCommentTree(comments), [comments]);

  const submitComment = useCallback(
    async (value: string, parentId: string | null): Promise<string | null> => {
      const trimmed = value.trim();
      if (!trimmed) return labels.postFailed;
      try {
        const csrf = readCookie("np-mb-csrf");
        const response = await fetch(
          `/api/collections/${encodeURIComponent(collectionSlug)}/${encodeURIComponent(documentId)}/comments`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(csrf ? { "X-CSRF-Token": csrf } : {}),
            },
            body: JSON.stringify({ bodyMd: trimmed, parentId }),
          },
        );
        if (!response.ok) throw await errorFromResponse(response, labels.postFailed);
        const created = (await response.json()) as { status?: unknown };
        let nextOffset = offset;
        if (created.status === "visible") {
          if (sort === "oldest") nextOffset = Math.floor(total / limit) * limit;
          if (sort === "newest") nextOffset = 0;
        }
        await load(nextOffset, sort);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : labels.postFailed;
      }
    },
    [collectionSlug, documentId, labels.postFailed, limit, load, offset, sort, total],
  );

  const submitRoot = async () => {
    if (!bodyMd.trim() || submitting) return;
    setSubmitting(true);
    setComposerError(null);
    const error = await submitComment(bodyMd, null);
    if (error) setComposerError(error);
    else setBodyMd("");
    setSubmitting(false);
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section
      className="np-comments"
      data-np-comments="thread"
      data-np-comment-sort={sort}
      aria-busy={loading}
    >
      <header className="np-comments-header">
        <h2>
          {labels.title} {total > 0 ? `(${total.toLocaleString(locale)})` : ""}
        </h2>
        {total > 1 ? (
          <div className="np-comments-sort" role="group" aria-label={labels.sortLabel}>
            {(["oldest", "newest", "top"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                data-active={sort === value ? "true" : "false"}
                disabled={loading}
                onClick={() => void load(0, value)}
              >
                {value === "oldest"
                  ? labels.oldest
                  : value === "newest"
                    ? labels.newest
                    : labels.top}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {listError ? (
        <p className="np-comments-error" role="alert">
          {listError}
        </p>
      ) : null}

      {!loading && comments.length === 0 && !listError ? (
        <p className="np-comments-empty">{labels.empty}</p>
      ) : (
        <CommentBranch
          nodes={tree}
          depth={0}
          labels={labels}
          locale={locale}
          memberKnown={memberKnown}
          viewerMemberId={viewerMemberId}
          locked={locked}
          moderation={moderation}
          onReply={submitComment}
          onChanged={refresh}
          onRemoved={async () => {
            const nextOffset =
              comments.length === 1 && offset > 0 ? Math.max(0, offset - limit) : offset;
            await load(nextOffset, sort);
          }}
        />
      )}

      {totalPages > 1 ? (
        <nav className="np-comments-pagination" aria-label={labels.page} data-np-comment-pagination>
          <button
            type="button"
            disabled={!hasPrevPage || loading}
            onClick={() => void load(Math.max(0, offset - limit), sort)}
          >
            {labels.previous}
          </button>
          <span aria-live="polite">
            {labels.page} {currentPage.toLocaleString(locale)} / {totalPages.toLocaleString(locale)}
          </span>
          <button
            type="button"
            disabled={!hasNextPage || loading}
            onClick={() => void load(offset + limit, sort)}
          >
            {labels.next}
          </button>
        </nav>
      ) : null}

      {locked ? (
        <p className="np-comments-locked">{lockedMessage}</p>
      ) : memberKnown === false ? (
        <p className="np-comments-login">
          <a href="/members/login">{labels.signIn}</a> {labels.signInPrompt}
        </p>
      ) : memberKnown === true ? (
        <form
          className="np-comment-composer"
          data-np-comment-composer="root"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRoot();
          }}
        >
          <textarea
            value={bodyMd}
            onChange={(event) => setBodyMd(event.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            rows={4}
            maxLength={5_000}
          />
          {composerError ? (
            <p className="np-comments-error" role="alert">
              {composerError}
            </p>
          ) : null}
          <button
            className="np-comment-primary-action"
            type="submit"
            disabled={submitting || !bodyMd.trim()}
          >
            {submitting ? labels.posting : labels.post}
          </button>
        </form>
      ) : null}
    </section>
  );
}

interface CommentBranchProps {
  nodes: NpCommentTreeNode[];
  depth: number;
  labels: NpCommentsLabels;
  locale?: string;
  memberKnown: boolean | null;
  viewerMemberId: string | null;
  locked: boolean;
  moderation?: NpCommentsModerationPermissions;
  onReply: (bodyMd: string, parentId: string) => Promise<string | null>;
  onChanged: () => Promise<boolean>;
  onRemoved: () => Promise<void>;
}

function CommentBranch(props: CommentBranchProps) {
  if (props.nodes.length === 0) return null;
  const { nodes, ...itemProps } = props;
  return (
    <ul
      className={props.depth === 0 ? "np-comments-list" : "np-comment-children"}
      data-np-comment-list={props.depth === 0 ? "page" : "replies"}
    >
      {nodes.map((node) => (
        <CommentItem key={node.comment.id} node={node} {...itemProps} />
      ))}
    </ul>
  );
}

interface CommentItemProps extends Omit<CommentBranchProps, "nodes"> {
  node: NpCommentTreeNode;
}

function CommentItem({
  node,
  depth,
  labels,
  locale,
  memberKnown,
  viewerMemberId,
  locked,
  moderation,
  onReply,
  onChanged,
  onRemoved,
}: CommentItemProps) {
  const { comment } = node;
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(comment.bodyMd);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [moderationBusy, setModerationBusy] = useState<"hide" | "restore" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const own = memberKnown === true && viewerMemberId === comment.memberId;
  const canEdit = own || moderation?.editAny === true;
  const canDelete = own || moderation?.deleteAny === true;
  const isVisible = comment.status === "visible";
  const canMute = memberKnown === true && viewerMemberId !== null && !own;
  const authorName = comment.author?.displayName || comment.author?.handle || labels.unknownAuthor;

  const submitReply = async () => {
    if (!replyBody.trim() || replyBusy) return;
    setReplyBusy(true);
    setReplyError(null);
    const error = await onReply(replyBody, comment.id);
    if (error) setReplyError(error);
    else {
      setReplyBody("");
      setReplyOpen(false);
    }
    setReplyBusy(false);
  };

  const saveEdit = async () => {
    if (!editBody.trim() || editBusy) return;
    setEditBusy(true);
    setActionError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ bodyMd: editBody.trim() }),
      });
      if (!response.ok) throw await errorFromResponse(response, labels.editFailed);
      setEditOpen(false);
      await onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : labels.editFailed);
    } finally {
      setEditBusy(false);
    }
  };

  const remove = async () => {
    if (deleteBusy || typeof window === "undefined" || !window.confirm(labels.deleteConfirm))
      return;
    setDeleteBusy(true);
    setActionError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
      });
      if (!response.ok) throw await errorFromResponse(response, labels.deleteFailed);
      await onRemoved();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : labels.deleteFailed);
    } finally {
      setDeleteBusy(false);
    }
  };

  const moderate = async (action: "hide" | "restore") => {
    if (moderationBusy) return;
    setModerationBusy(action);
    setActionError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch(`/api/comments/${encodeURIComponent(comment.id)}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: action === "hide" ? JSON.stringify({ reason: null }) : undefined,
      });
      if (!response.ok) {
        throw await errorFromResponse(
          response,
          action === "hide" ? labels.hideFailed : labels.restoreFailed,
        );
      }
      await onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : action === "hide"
            ? labels.hideFailed
            : labels.restoreFailed,
      );
    } finally {
      setModerationBusy(null);
    }
  };

  return (
    <li
      id={`comment-${comment.id}`}
      className="np-comment"
      data-np-comment="item"
      data-np-comment-id={comment.id}
      data-np-comment-depth={depth}
      data-np-comment-owner={own ? "true" : "false"}
      data-np-comment-status={comment.status}
      data-np-comment-detached={node.detached ? "true" : "false"}
    >
      <article className="np-comment-card">
        <header className="np-comment-meta">
          {comment.author ? (
            <a
              className="np-comment-author"
              data-np-comment-author={comment.author.handle}
              href={`/u/${encodeURIComponent(comment.author.handle)}`}
            >
              {comment.author.avatarUrl ? (
                <img src={comment.author.avatarUrl} alt="" width={40} height={40} loading="lazy" />
              ) : (
                <span className="np-comment-avatar-fallback" aria-hidden="true">
                  {authorName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>
                <strong>{authorName}</strong>
                <small>@{comment.author.handle}</small>
              </span>
            </a>
          ) : (
            <span
              className="np-comment-author np-comment-author-missing"
              data-np-comment-author="missing"
            >
              <span className="np-comment-avatar-fallback" aria-hidden="true">
                ?
              </span>
              <strong>{labels.unknownAuthor}</strong>
            </span>
          )}
          <span className="np-comment-date">
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleString(locale)}
            </time>
            {comment.editedAt ? <span> · {labels.edited}</span> : null}
            {comment.authorStatus === "imported" ? (
              <span className="np-comment-imported" title={labels.importedTitle}>
                {labels.imported}
              </span>
            ) : null}
          </span>
        </header>

        {editOpen ? (
          <form
            className="np-comment-composer np-comment-edit-form"
            data-np-comment-composer="edit"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
          >
            <textarea
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
              aria-label={labels.edit}
              rows={4}
              maxLength={5_000}
            />
            <div className="np-comment-form-actions">
              <button
                className="np-comment-primary-action"
                type="submit"
                disabled={editBusy || !editBody.trim()}
              >
                {editBusy ? labels.saving : labels.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditBody(comment.bodyMd);
                  setEditOpen(false);
                  setActionError(null);
                }}
              >
                {labels.cancel}
              </button>
            </div>
          </form>
        ) : (
          <div className="np-comment-body" dangerouslySetInnerHTML={{ __html: comment.bodyHtml }} />
        )}

        <div className="np-comment-actions" data-np-comment-actions>
          {isVisible ? (
            <ReactionButton
              key={`${comment.id}:${comment.reactions.counts.like ?? 0}:${comment.reactions.mine.includes("like")}`}
              comment={comment}
              memberKnown={memberKnown}
              labels={labels}
            />
          ) : null}
          {memberKnown === true && !locked && isVisible ? (
            <button
              type="button"
              onClick={() => {
                const nextOpen = !replyOpen;
                setReplyOpen(nextOpen);
                if (nextOpen) setReplyError(null);
                setEditOpen(false);
                setActionError(null);
              }}
            >
              {labels.reply}
            </button>
          ) : null}
          {canEdit || canDelete ? (
            <>
              {canEdit && comment.status !== "deleted" ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditBody(comment.bodyMd);
                    setEditOpen(true);
                    setReplyOpen(false);
                    setActionError(null);
                  }}
                >
                  {labels.edit}
                </button>
              ) : null}
              {canDelete && comment.status !== "deleted" ? (
                <button type="button" disabled={deleteBusy} onClick={() => void remove()}>
                  {deleteBusy ? labels.deleting : labels.delete}
                </button>
              ) : null}
            </>
          ) : null}
          {moderation?.hide === true &&
          (comment.status === "visible" || comment.status === "pending") ? (
            <button
              type="button"
              disabled={moderationBusy !== null}
              onClick={() => void moderate("hide")}
            >
              {moderationBusy === "hide" ? labels.hiding : labels.hide}
            </button>
          ) : null}
          {moderation?.restore === true && comment.status === "hidden" ? (
            <button
              type="button"
              disabled={moderationBusy !== null}
              onClick={() => void moderate("restore")}
            >
              {moderationBusy === "restore" ? labels.restoring : labels.restore}
            </button>
          ) : null}
          {memberKnown === true && isVisible ? (
            <button type="button" onClick={() => setReportOpen(true)}>
              {labels.report}
            </button>
          ) : null}
          {canMute ? (
            <MuteButton targetMemberId={comment.memberId} labels={labels} onMuted={onRemoved} />
          ) : null}
        </div>

        {actionError ? (
          <p className="np-comments-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {replyOpen ? (
          <form
            className="np-comment-composer np-comment-reply-form"
            data-np-comment-composer="reply"
            onSubmit={(event) => {
              event.preventDefault();
              void submitReply();
            }}
          >
            <p className="np-comment-replying-to">
              {labels.replyingTo} <strong>{authorName}</strong>
            </p>
            <textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder={labels.replyPlaceholder}
              aria-label={labels.replyPlaceholder}
              rows={3}
              maxLength={5_000}
            />
            {replyError ? (
              <p className="np-comments-error" role="alert">
                {replyError}
              </p>
            ) : null}
            <div className="np-comment-form-actions">
              <button
                className="np-comment-primary-action"
                type="submit"
                disabled={replyBusy || !replyBody.trim()}
              >
                {replyBusy ? labels.posting : labels.postReply}
              </button>
              <button type="button" onClick={() => setReplyOpen(false)}>
                {labels.cancel}
              </button>
            </div>
          </form>
        ) : null}
      </article>

      <CommentBranch
        nodes={node.children}
        depth={depth + 1}
        labels={labels}
        locale={locale}
        memberKnown={memberKnown}
        viewerMemberId={viewerMemberId}
        locked={locked}
        moderation={moderation}
        onReply={onReply}
        onChanged={onChanged}
        onRemoved={onRemoved}
      />

      {reportOpen ? (
        <ReportDialog targetId={comment.id} labels={labels} onClose={() => setReportOpen(false)} />
      ) : null}
    </li>
  );
}

interface ReactionButtonProps {
  comment: NpCommentListItemWire;
  memberKnown: boolean | null;
  labels: NpCommentsLabels;
}

function ReactionButton({ comment, memberKnown, labels }: ReactionButtonProps) {
  const initialCount = Number(comment.reactions.counts.like ?? 0);
  const initialMine = comment.reactions.mine.includes("like");
  const [count, setCount] = useState(initialCount);
  const [mine, setMine] = useState(initialMine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (memberKnown !== true || busy) return;
    setBusy(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const headers = {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      };
      const params = new URLSearchParams({
        targetType: "comment",
        targetId: comment.id,
        kind: "like",
      });
      const response = mine
        ? await fetch(`/api/reactions?${params.toString()}`, {
            method: "DELETE",
            credentials: "include",
            headers,
          })
        : await fetch("/api/reactions", {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify({ targetType: "comment", targetId: comment.id, kind: "like" }),
          });
      if (!response.ok) throw await errorFromResponse(response, labels.reactionFailed);
      setMine(!mine);
      setCount((value) => Math.max(0, value + (mine ? -1 : 1)));
    } catch (error) {
      setError(error instanceof Error ? error.message : labels.reactionFailed);
    } finally {
      setBusy(false);
    }
  };

  const disabled = memberKnown !== true || busy;
  return (
    <span className="np-comment-reaction">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={disabled}
        aria-pressed={mine}
        data-active={mine ? "true" : "false"}
        title={memberKnown === true ? (mine ? labels.unlike : labels.like) : labels.signInToReact}
      >
        <span aria-hidden="true">👍</span> {count}
      </button>
      {error ? (
        <span className="np-comment-inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

interface MuteButtonProps {
  targetMemberId: string;
  labels: NpCommentsLabels;
  onMuted: () => Promise<void>;
}

function MuteButton({ targetMemberId, labels, onMuted }: MuteButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mute = async () => {
    if (busy || typeof window === "undefined" || !window.confirm(labels.muteConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch("/api/members/me/mutes", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ targetId: targetMemberId }),
      });
      if (!response.ok) throw await errorFromResponse(response, labels.muteFailed);
      await onMuted();
    } catch (error) {
      setError(error instanceof Error ? error.message : labels.muteFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="np-comment-mute">
      <button type="button" onClick={() => void mute()} disabled={busy} title={labels.muteTitle}>
        {busy ? labels.muting : labels.mute}
      </button>
      {error ? (
        <span className="np-comment-inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

interface ReportDialogProps {
  targetId: string;
  labels: NpCommentsLabels;
  onClose: () => void;
}

function ReportDialog({ targetId, labels, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textareaRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const submit = async () => {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const csrf = readCookie("np-mb-csrf");
      const response = await fetch("/api/reports", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: JSON.stringify({ targetType: "comment", targetId, reason: reason.trim() }),
      });
      if (!response.ok) throw await errorFromResponse(response, labels.reportFailed);
      setDone(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : labels.reportFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="np-comment-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-np-comment-dialog="report"
      onClick={onClose}
    >
      <div className="np-comment-dialog" onClick={(event) => event.stopPropagation()}>
        <h3 id={titleId}>{labels.reportTitle}</h3>
        {done ? (
          <>
            <p>{labels.reportSuccess}</p>
            <div className="np-comment-dialog-actions">
              <button className="np-comment-primary-action" type="button" onClick={onClose}>
                {labels.close}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p>{labels.reportHelp}</p>
            <textarea
              ref={textareaRef}
              aria-label={labels.reportReasonLabel}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={1_000}
              placeholder={labels.reportPlaceholder}
            />
            {error ? (
              <p className="np-comments-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="np-comment-dialog-actions">
              <button type="button" onClick={onClose}>
                {labels.cancel}
              </button>
              <button
                className="np-comment-primary-action"
                type="submit"
                disabled={submitting || !reason.trim()}
              >
                {submitting ? labels.reportSubmitting : labels.reportSubmit}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`, "u"));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
