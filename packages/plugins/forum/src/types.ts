import type { ReactNode } from "react";

export type NpForumBoardWriteMode = "members" | "staff" | "closed";
export type NpForumModerationMode = "published" | "pending";

export interface NpForumCategory {
  key: string;
  label: string;
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
  number: string;
  category: string;
  title: string;
  author: string;
  date: string;
  notice: string;
  staff: string;
  pending: string;
  locked: string;
  previous: string;
  next: string;
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
  page: number;
  totalPages: number;
  totalPosts: number;
  showMine: boolean;
  isAuthenticated: boolean;
  canCreate: boolean;
  messages: NpForumMessages;
  hrefForPage: (page: number) => string;
}

export interface NpForumPostDetailSkinProps {
  basePath: string;
  board: NpForumBoard;
  post: NpForumPostSummary;
  body: ReactNode;
  authorActions: ReactNode;
  comments: ReactNode;
  messages: NpForumMessages;
}

export interface NpForumSkin {
  id: string;
  label: string;
  renderBoardIndex(props: NpForumBoardIndexSkinProps): ReactNode | Promise<ReactNode>;
  renderPostList(props: NpForumPostListSkinProps): ReactNode | Promise<ReactNode>;
  renderPostDetail(props: NpForumPostDetailSkinProps): ReactNode | Promise<ReactNode>;
}

export interface NpForumCollectionSlugs {
  boards: string;
  posts: string;
}
