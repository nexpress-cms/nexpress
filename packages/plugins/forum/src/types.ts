import type { ReactNode } from "react";
import type { NpContentEngagementSummary } from "@nexpress/core/community-contract";

export type NpForumBoardWriteMode = "members" | "staff" | "closed";
export type NpForumModerationMode = "published" | "pending";

export interface NpForumCategory {
  key: string;
  label: string;
}

export interface NpForumAttachmentPolicy {
  enabled: boolean;
  maxFiles: number;
  maxFileSizeBytes: number;
}

export interface NpForumAttachment {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  downloadUrl: string;
}

export interface NpForumBoard {
  id: string;
  key: string;
  name: string;
  description: string | null;
  skinId: string;
  writeMode: NpForumBoardWriteMode;
  moderation: NpForumModerationMode;
  commentsEnabled: boolean;
  pageSize: number;
  categories: NpForumCategory[];
  attachments: NpForumAttachmentPolicy;
}

export interface NpForumAuthor {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface NpForumPostSummary {
  id: string;
  title: string;
  category: string | null;
  pinned: boolean;
  locked: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  memberAuthorId: string | null;
  author: NpForumAuthor | null;
  engagement: NpContentEngagementSummary;
  attachmentCount: number;
}

export interface NpForumPostListQuery {
  page: number;
  search: string | null;
  category: string | null;
  showMine: boolean;
}

export interface NpForumPostListQueryPatch {
  page?: number;
  search?: string | null;
  category?: string | null;
  showMine?: boolean;
}

export interface NpForumMessages {
  locale: string;
  boards: string;
  posts: string;
  allPosts: string;
  myPosts: string;
  newPost: string;
  signInToPost: string;
  emptyBoards: string;
  emptyPosts: string;
  emptyFilteredPosts: string;
  allCategories: string;
  searchPosts: string;
  searchPlaceholder: string;
  clearFilters: string;
  number: string;
  category: string;
  title: string;
  author: string;
  date: string;
  notice: string;
  staff: string;
  pending: string;
  locked: string;
  views: string;
  commentsCount: string;
  reactions: string;
  recommend: string;
  recommended: string;
  engagementFailed: string;
  pagination: string;
  previous: string;
  next: string;
  boardPolicy: string;
  writeMembers: string;
  writeStaff: string;
  writeClosed: string;
  moderationPublished: string;
  moderationPending: string;
  commentsOpen: string;
  commentsClosed: string;
  createdAt: string;
  updatedAt: string;
  pageOf: (page: number, totalPages: number) => string;
  backToBoard: string;
  backToPost: string;
  editPost: string;
  categoryNone: string;
  body: string;
  loadingEditor: string;
  saving: string;
  create: string;
  save: string;
  saveFailed: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  cancel: string;
  deleting: string;
  deleteFailed: string;
  signIn: string;
  register: string;
  loginRequired: string;
  commentsLocked: string;
  emptyBody: string;
  attachments: string;
}

export interface NpForumBoardIndexSkinProps {
  basePath: string;
  boards: NpForumBoard[];
  messages: NpForumMessages;
}

export interface NpForumPostListSkinProps {
  basePath: string;
  board: NpForumBoard;
  posts: NpForumPostSummary[];
  pinnedPosts: NpForumPostSummary[];
  totalPages: number;
  totalPosts: number;
  query: NpForumPostListQuery;
  searchMaxLength: number;
  isAuthenticated: boolean;
  canCreate: boolean;
  messages: NpForumMessages;
  hrefForQuery: (patch?: NpForumPostListQueryPatch) => string;
}

export interface NpForumPostDetailSkinProps {
  basePath: string;
  board: NpForumBoard;
  post: NpForumPostSummary;
  body: ReactNode;
  authorActions: ReactNode;
  engagement: ReactNode;
  comments: ReactNode;
  attachments: NpForumAttachment[];
  messages: NpForumMessages;
}

export interface NpForumPostComposerSkinProps {
  basePath: string;
  board: NpForumBoard;
  mode: "create" | "edit";
  title: string;
  backHref: string;
  backLabel: string;
  /** Route-owned form or authentication gate; skins own presentation only. */
  content: ReactNode;
  messages: NpForumMessages;
}

export interface NpForumSkin {
  id: string;
  label: string;
  renderBoardIndex(props: NpForumBoardIndexSkinProps): ReactNode | Promise<ReactNode>;
  renderPostList(props: NpForumPostListSkinProps): ReactNode | Promise<ReactNode>;
  renderPostDetail(props: NpForumPostDetailSkinProps): ReactNode | Promise<ReactNode>;
  renderPostComposer(props: NpForumPostComposerSkinProps): ReactNode | Promise<ReactNode>;
}

export interface NpForumCollectionSlugs {
  boards: string;
  posts: string;
}
