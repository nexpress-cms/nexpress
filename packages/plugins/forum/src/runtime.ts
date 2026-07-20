import { findDocuments, getDocumentById, getMemberProfiles } from "@nexpress/core";
import { npListContentEngagement } from "@nexpress/core/community";
import { getCurrentLocale, t } from "@nexpress/core/i18n";
import {
  getMediaById,
  npMediaAttachmentLimits,
  npToMediaAttachmentWire,
} from "@nexpress/core/media";

import type {
  NpForumAuthor,
  NpForumAttachment,
  NpForumBoard,
  NpForumCategory,
  NpForumCollectionSlugs,
  NpForumMessages,
  NpForumPostSummary,
  NpForumSkin,
} from "./types.js";

const FORUM_POST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const npForumBoardKeyPattern = /^[a-z][a-z0-9-]{1,62}$/u;

export interface NpForumRuntime {
  basePath: string;
  collections: NpForumCollectionSlugs;
  defaultSkinId: string;
  skins: ReadonlyMap<string, NpForumSkin>;
}

export interface ForumBoardDocument extends Record<string, unknown> {
  id: string;
  status: string;
  visibility: string;
  slug: string;
  name: string;
  description?: string | null;
  skin: string;
  writeMode: string;
  moderation: string;
  commentsEnabled: boolean;
  pageSize: number;
  categories?: unknown;
  attachmentsEnabled: boolean;
  maxAttachments: number;
  maxAttachmentSizeMb: number;
}

export interface ForumPostDocument extends Record<string, unknown> {
  id: string;
  status: string;
  visibility: string;
  board: string;
  boardKey?: string | null;
  title: string;
  body: unknown;
  category?: string | null;
  pinned?: boolean | null;
  locked?: boolean | null;
  attachments?: unknown;
  memberAuthorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function isForumPostId(value: unknown): value is string {
  return typeof value === "string" && FORUM_POST_ID_PATTERN.test(value);
}

export function normalizeForumCategories(value: unknown): NpForumCategory[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Forum board category ${index.toString()} must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.key !== "string" || !/^[a-z][a-z0-9-]*$/u.test(item.key)) {
      throw new Error(`Forum board category ${index.toString()} has an invalid key.`);
    }
    if (typeof item.label !== "string" || item.label.trim().length === 0) {
      throw new Error(`Forum board category ${index.toString()} has an invalid label.`);
    }
    if (seen.has(item.key)) {
      throw new Error(`Forum board category key "${item.key}" is duplicated.`);
    }
    seen.add(item.key);
    return { key: item.key, label: item.label.trim() };
  });
}

export function normalizeForumBoard(value: ForumBoardDocument): NpForumBoard {
  if (
    value.writeMode !== "members" &&
    value.writeMode !== "staff" &&
    value.writeMode !== "closed"
  ) {
    throw new Error(`Forum board "${value.id}" has an invalid write mode.`);
  }
  if (value.moderation !== "published" && value.moderation !== "pending") {
    throw new Error(`Forum board "${value.id}" has an invalid moderation mode.`);
  }
  if (!Number.isSafeInteger(value.pageSize) || value.pageSize < 5 || value.pageSize > 100) {
    throw new Error(`Forum board "${value.id}" has an invalid page size.`);
  }
  if (typeof value.attachmentsEnabled !== "boolean") {
    throw new Error(`Forum board "${value.id}" has an invalid attachment toggle.`);
  }
  if (
    !Number.isSafeInteger(value.maxAttachments) ||
    value.maxAttachments < 1 ||
    value.maxAttachments > npMediaAttachmentLimits.maxFilesPerDocument
  ) {
    throw new Error(`Forum board "${value.id}" has an invalid attachment count.`);
  }
  if (
    !Number.isSafeInteger(value.maxAttachmentSizeMb) ||
    value.maxAttachmentSizeMb < 1 ||
    value.maxAttachmentSizeMb > npMediaAttachmentLimits.maxFileSizeBytes / (1024 * 1024)
  ) {
    throw new Error(`Forum board "${value.id}" has an invalid attachment size.`);
  }
  return {
    id: value.id,
    key: value.slug,
    name: value.name,
    description:
      typeof value.description === "string" && value.description.trim()
        ? value.description.trim()
        : null,
    skinId: value.skin,
    writeMode: value.writeMode,
    moderation: value.moderation,
    commentsEnabled: value.commentsEnabled,
    pageSize: value.pageSize,
    categories: normalizeForumCategories(value.categories),
    attachments: {
      enabled: value.attachmentsEnabled,
      maxFiles: value.maxAttachments,
      maxFileSizeBytes: value.maxAttachmentSizeMb * 1024 * 1024,
    },
  };
}

export async function listForumBoards(runtime: NpForumRuntime): Promise<NpForumBoard[]> {
  const result = await findDocuments<ForumBoardDocument>(runtime.collections.boards, {
    where: { status: "published" },
    sort: "name",
    page: 1,
    limit: 100,
  });
  return result.docs.map(normalizeForumBoard);
}

export async function findForumBoardByKey(
  runtime: NpForumRuntime,
  key: string,
): Promise<NpForumBoard | null> {
  const result = await findDocuments<ForumBoardDocument>(runtime.collections.boards, {
    where: { slug: key, status: "published" },
    page: 1,
    limit: 1,
  });
  const board = result.docs[0];
  return board ? normalizeForumBoard(board) : null;
}

export async function findForumBoardById(
  runtime: NpForumRuntime,
  id: string,
): Promise<NpForumBoard | null> {
  const board = await getDocumentById<ForumBoardDocument>(runtime.collections.boards, id);
  return board && board.status === "published" && board.visibility === "public"
    ? normalizeForumBoard(board)
    : null;
}

/** Staff-side board lookup. Draft/private boards remain manageable in Admin. */
export async function getForumBoardById(
  runtime: NpForumRuntime,
  id: string,
): Promise<NpForumBoard | null> {
  const board = await getDocumentById<ForumBoardDocument>(runtime.collections.boards, id);
  return board ? normalizeForumBoard(board) : null;
}

export function resolveForumSkin(runtime: NpForumRuntime, skinId?: string): NpForumSkin {
  const selected = skinId ?? runtime.defaultSkinId;
  const skin = runtime.skins.get(selected);
  if (!skin) throw new Error(`Forum skin "${selected}" is not registered.`);
  return skin;
}

export async function enrichForumPosts(
  documents: ForumPostDocument[],
  collectionSlug: string,
): Promise<NpForumPostSummary[]> {
  const authorIds = documents
    .map((document) => document.memberAuthorId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const [profiles, engagement] = await Promise.all([
    getMemberProfiles(authorIds),
    npListContentEngagement(
      collectionSlug,
      documents.map((document) => document.id),
    ),
  ]);
  return documents.map((document, index) => {
    const profile = document.memberAuthorId ? profiles.get(document.memberAuthorId) : null;
    const author: NpForumAuthor | null = profile
      ? {
          id: profile.id,
          handle: profile.handle,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        }
      : null;
    return {
      id: document.id,
      title: document.title,
      category: typeof document.category === "string" ? document.category : null,
      pinned: document.pinned === true,
      locked: document.locked === true,
      status: document.status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      memberAuthorId: document.memberAuthorId,
      author,
      engagement: engagement[index],
      attachmentCount: normalizeForumAttachmentIds(document.attachments).length,
    };
  });
}

export function normalizeForumAttachmentIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Forum post attachments must be an array.");
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Forum post attachment ${index.toString()} must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some((key) => key !== "file") ||
      typeof item.file !== "string" ||
      !FORUM_POST_ID_PATTERN.test(item.file)
    ) {
      throw new Error(`Forum post attachment ${index.toString()} must contain only a file id.`);
    }
    if (seen.has(item.file)) {
      throw new Error(`Forum post attachment ${index.toString()} is duplicated.`);
    }
    seen.add(item.file);
    return item.file;
  });
}

export async function resolveForumAttachments(value: unknown): Promise<NpForumAttachment[]> {
  const ids = normalizeForumAttachmentIds(value);
  const records = await Promise.all(ids.map((id) => getMediaById(id)));
  return records.map((record, index) => {
    if (!record) throw new Error(`Forum attachment "${ids[index]}" was not found.`);
    const wire = npToMediaAttachmentWire(record);
    return {
      id: wire.id,
      filename: wire.filename,
      mimeType: wire.mimeType,
      filesize: wire.filesize,
      downloadUrl: wire.downloadUrl,
    };
  });
}

export async function getForumMessages(): Promise<NpForumMessages> {
  const locale = getCurrentLocale();
  const read = (key: string) => t(`forum.${key}`, locale);
  const values = await Promise.all(
    [
      "boards",
      "posts",
      "allPosts",
      "myPosts",
      "newPost",
      "signInToPost",
      "emptyBoards",
      "emptyPosts",
      "emptyFilteredPosts",
      "allCategories",
      "searchPosts",
      "searchPlaceholder",
      "clearFilters",
      "number",
      "category",
      "title",
      "author",
      "date",
      "notice",
      "staff",
      "pending",
      "locked",
      "views",
      "commentsCount",
      "reactions",
      "recommend",
      "recommended",
      "engagementFailed",
      "pagination",
      "boardPolicy",
      "writeMembers",
      "writeStaff",
      "writeClosed",
      "moderationPublished",
      "moderationPending",
      "commentsOpen",
      "commentsClosed",
      "createdAt",
      "updatedAt",
      "previous",
      "next",
      "backToBoard",
      "backToPost",
      "editPost",
      "categoryNone",
      "body",
      "loadingEditor",
      "saving",
      "create",
      "save",
      "saveFailed",
      "edit",
      "delete",
      "deleteConfirm",
      "cancel",
      "deleting",
      "deleteFailed",
      "signIn",
      "register",
      "loginRequired",
      "commentsLocked",
      "emptyBody",
      "attachments",
    ].map(read),
  );
  const [
    boards,
    posts,
    allPosts,
    myPosts,
    newPost,
    signInToPost,
    emptyBoards,
    emptyPosts,
    emptyFilteredPosts,
    allCategories,
    searchPosts,
    searchPlaceholder,
    clearFilters,
    number,
    category,
    title,
    author,
    date,
    notice,
    staff,
    pending,
    locked,
    views,
    commentsCount,
    reactions,
    recommend,
    recommended,
    engagementFailed,
    pagination,
    boardPolicy,
    writeMembers,
    writeStaff,
    writeClosed,
    moderationPublished,
    moderationPending,
    commentsOpen,
    commentsClosed,
    createdAt,
    updatedAt,
    previous,
    next,
    backToBoard,
    backToPost,
    editPost,
    categoryNone,
    body,
    loadingEditor,
    saving,
    create,
    save,
    saveFailed,
    edit,
    deleteLabel,
    deleteConfirm,
    cancel,
    deleting,
    deleteFailed,
    signIn,
    register,
    loginRequired,
    commentsLocked,
    emptyBody,
    attachments,
  ] = values;
  return {
    locale,
    boards: boards ?? "Boards",
    posts: posts ?? "Posts",
    allPosts: allPosts ?? "All posts",
    myPosts: myPosts ?? "My posts",
    newPost: newPost ?? "New post",
    signInToPost: signInToPost ?? "Sign in to post",
    emptyBoards: emptyBoards ?? "No boards yet.",
    emptyPosts: emptyPosts ?? "No posts yet.",
    emptyFilteredPosts: emptyFilteredPosts ?? "No posts match these filters.",
    allCategories: allCategories ?? "All categories",
    searchPosts: searchPosts ?? "Search posts",
    searchPlaceholder: searchPlaceholder ?? "Search titles and content",
    clearFilters: clearFilters ?? "Clear filters",
    number: number ?? "No.",
    category: category ?? "Category",
    title: title ?? "Title",
    author: author ?? "Author",
    date: date ?? "Date",
    notice: notice ?? "Notice",
    staff: staff ?? "Staff",
    pending: pending ?? "Pending",
    locked: locked ?? "Locked",
    views: views ?? "Views",
    commentsCount: commentsCount ?? "Comments",
    reactions: reactions ?? "Reactions",
    recommend: recommend ?? "Recommend",
    recommended: recommended ?? "Recommended",
    engagementFailed: engagementFailed ?? "Could not update this reaction.",
    pagination: pagination ?? "Pagination",
    boardPolicy: boardPolicy ?? "Board policy",
    writeMembers: writeMembers ?? "Members can post",
    writeStaff: writeStaff ?? "Staff posts only",
    writeClosed: writeClosed ?? "Posting closed",
    moderationPublished: moderationPublished ?? "Posts publish immediately",
    moderationPending: moderationPending ?? "New posts require review",
    commentsOpen: commentsOpen ?? "Comments enabled",
    commentsClosed: commentsClosed ?? "Comments disabled",
    createdAt: createdAt ?? "Created",
    updatedAt: updatedAt ?? "Updated",
    previous: previous ?? "Previous",
    next: next ?? "Next",
    pageOf: (page, totalPages) => `${page.toString()} / ${totalPages.toString()}`,
    backToBoard: backToBoard ?? "Back to board",
    backToPost: backToPost ?? "Back to post",
    editPost: editPost ?? "Edit post",
    categoryNone: categoryNone ?? "No category",
    body: body ?? "Body",
    loadingEditor: loadingEditor ?? "Loading editor…",
    saving: saving ?? "Saving…",
    create: create ?? "Submit",
    save: save ?? "Save changes",
    saveFailed: saveFailed ?? "Could not save the post.",
    edit: edit ?? "Edit",
    delete: deleteLabel ?? "Delete",
    deleteConfirm: deleteConfirm ?? "Delete this post? This cannot be undone.",
    cancel: cancel ?? "Cancel",
    deleting: deleting ?? "Deleting…",
    deleteFailed: deleteFailed ?? "Could not delete the post.",
    signIn: signIn ?? "Sign in",
    register: register ?? "Create account",
    loginRequired: loginRequired ?? "An account is required to create a post.",
    commentsLocked: commentsLocked ?? "This post is locked. Existing comments remain visible.",
    emptyBody: emptyBody ?? "No content.",
    attachments: attachments ?? "Attachments",
  };
}

export interface ForumAttachmentFormLabels {
  attachments: string;
  add: string;
  uploading: string;
  remove: string;
  uploadFailed: string;
  help: string;
  tooMany: string;
  tooLarge: string;
}

export async function getForumAttachmentFormLabels(
  board: NpForumBoard,
): Promise<ForumAttachmentFormLabels> {
  const locale = getCurrentLocale();
  const maxSizeMb = board.attachments.maxFileSizeBytes / (1024 * 1024);
  const params = { maxFiles: board.attachments.maxFiles, maxSizeMb };
  const [attachments, add, uploading, remove, uploadFailed, help, tooMany, tooLarge] =
    await Promise.all([
      t("forum.attachments", locale),
      t("forum.attachmentAdd", locale),
      t("forum.attachmentUploading", locale),
      t("forum.attachmentRemove", locale),
      t("forum.attachmentUploadFailed", locale),
      t("forum.attachmentHelp", locale, params),
      t("forum.attachmentTooMany", locale, params),
      t("forum.attachmentTooLarge", locale, params),
    ]);
  return {
    attachments: attachments ?? "Attachments",
    add: add ?? "Add files",
    uploading: uploading ?? "Uploading…",
    remove: remove ?? "Remove",
    uploadFailed: uploadFailed ?? "Could not upload this file.",
    help: help ?? `Up to ${board.attachments.maxFiles.toString()} files.`,
    tooMany: tooMany ?? `You can attach up to ${board.attachments.maxFiles.toString()} files.`,
    tooLarge: tooLarge ?? `Each attachment must be ${maxSizeMb.toString()} MB or smaller.`,
  };
}

export interface ForumHomeMessages extends NpForumMessages {
  viewAll: string;
  emptyNotices: string;
}

export async function getForumHomeMessages(): Promise<ForumHomeMessages> {
  const messages = await getForumMessages();
  const [viewAll, emptyNotices] = await Promise.all([
    t("forum.viewAll", messages.locale),
    t("forum.emptyNotices", messages.locale),
  ]);
  return {
    ...messages,
    viewAll: viewAll ?? "View all",
    emptyNotices: emptyNotices ?? "No notices yet.",
  };
}
