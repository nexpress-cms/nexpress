// Stub — see ../../lib/init-core.ts for the rationale.
//
// At runtime each consumer's `pnpm db:generate` produces this file
// from their `nexpress.config.ts` collections. The stub declares
// the fields the framework pages actually read, so the package
// typechecks against the "default scaffold" shape.
import type { NpAuthUser, NpFindOptions, NpFindResult } from "@nexpress/core";

export interface PostsDocument {
  id: string;
  status: "draft" | "published" | "archived" | "pending";
  createdAt: Date;
  updatedAt: Date;
  slug: string;
  title: string;
  excerpt?: string | null;
  content?: unknown;
  coverImage?: string | null;
  publishedAt?: Date | null;
  template?: string | null;
  seo?: { title?: string; description?: string } | null;
}

export interface PagesDocument extends PostsDocument {
  blocks?: unknown;
  seoDescription?: string | null;
}

export interface CategoriesDocument {
  id: string;
  status: "draft" | "published" | "archived" | "pending";
  createdAt: Date;
  updatedAt: Date;
  slug: string;
  name: string;
  description?: string | null;
}

export interface TagsDocument extends CategoriesDocument {}
export interface DiscussionsDocument extends PostsDocument {}

const emptyResult = <T,>(): NpFindResult<T> => ({
  docs: [],
  totalDocs: 0,
  totalPages: 0,
  page: 1,
  limit: 10,
  hasPrevPage: false,
  hasNextPage: false,
});

export async function findPosts(opts?: NpFindOptions): Promise<NpFindResult<PostsDocument>> {
  void opts;
  return emptyResult<PostsDocument>();
}

export async function findPages(opts?: NpFindOptions): Promise<NpFindResult<PagesDocument>> {
  void opts;
  return emptyResult<PagesDocument>();
}

export async function findCategories(
  opts?: NpFindOptions,
): Promise<NpFindResult<CategoriesDocument>> {
  void opts;
  return emptyResult<CategoriesDocument>();
}

export async function findTags(opts?: NpFindOptions): Promise<NpFindResult<TagsDocument>> {
  void opts;
  return emptyResult<TagsDocument>();
}

export async function findDiscussions(
  opts?: NpFindOptions,
): Promise<NpFindResult<DiscussionsDocument>> {
  void opts;
  return emptyResult<DiscussionsDocument>();
}

// Single-document accessors. Each real generator emits one of these per
// collection that opts into single-row lookups; the stub provides the same
// shape returning null so framework pages reaching `getPostsDocument(id)`
// typecheck before the first `pnpm db:generate` overwrites this file.
export async function getPostsDocument(
  _id: string,
  _user?: NpAuthUser,
): Promise<PostsDocument | null> {
  return null;
}

export async function getPagesDocument(
  _id: string,
  _user?: NpAuthUser,
): Promise<PagesDocument | null> {
  return null;
}

export async function getCategoriesDocument(
  _id: string,
  _user?: NpAuthUser,
): Promise<CategoriesDocument | null> {
  return null;
}

export async function getTagsDocument(
  _id: string,
  _user?: NpAuthUser,
): Promise<TagsDocument | null> {
  return null;
}

export async function getDiscussionsDocument(
  _id: string,
  _user?: NpAuthUser,
): Promise<DiscussionsDocument | null> {
  return null;
}
