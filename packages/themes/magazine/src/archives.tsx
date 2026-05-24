import * as React from "react";
import type { NpRouteRenderProps, NpThemeArchives } from "@nexpress/theme";
import {
  findDocuments,
  findPosts,
  getUserById,
  type NpFindResult,
} from "@nexpress/core";
import { cachedThemeFetch } from "@nexpress/next";

import {
  MagazineArchiveItem,
  type MagazineArchiveItemDoc,
} from "./components/archive-item.js";
import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Phase F.9 — magazine archive components.
 *
 * Each archive component fetches its own data (per design doc
 * §5.1 — components own queries; framework provides the route
 * dispatch only). `findPosts` resolves hasMany filters through
 * the registered join table, so `where: { categories: id }`
 * stays ergonomic without bypassing relationship storage.
 *
 * Two archives shipped:
 *   - byCategory at /category/:slug
 *   - byAuthor at /author/:id
 *
 * byTag and byDate are recorded as F.9.1 follow-up (the
 * shape mirrors byCategory; one less for review focus).
 */

interface ArchiveLayoutProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  result: NpFindResult<Record<string, unknown>>;
}

function ArchiveLayout({
  eyebrow,
  title,
  subtitle,
  result,
}: ArchiveLayoutProps): React.ReactElement {
  const stories = result.totalDocs === 1 ? "story" : "stories";
  return (
    <section className="np-magazine-index">
      <div className="np-magazine-container">
        <header className="np-magazine-archive-masthead">
          <p className="np-magazine-archive-eyebrow">{eyebrow}</p>
          <h1 className="np-magazine-archive-title">{title}</h1>
          {subtitle ? (
            <p className="np-magazine-archive-subtitle">{subtitle}</p>
          ) : null}
          <p className="np-magazine-archive-count">
            {result.totalDocs.toString()} {stories}
          </p>
        </header>
        {result.docs.length === 0 ? (
          <p className="np-magazine-archive-empty">No stories yet.</p>
        ) : (
          <ul className="np-magazine-archive">
            {result.docs.map((doc, index) => (
              <li key={(doc.id as string) ?? `archive-${index.toString()}`}>
                <MagazineArchiveItem
                  doc={doc as MagazineArchiveItemDoc}
                  romanIndex={index}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export async function CategoryArchive({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = params.slug ?? "";
  const settings = await resolveMagazineSettings();
  const data = await cachedThemeFetch(
    ["magazine.category-archive", slug, String(settings.postsPerPage)],
    async () => {
      const cats = await findDocuments<Record<string, unknown>>(
        "categories",
        { where: { slug }, limit: 1 },
      );
      const category = cats.docs[0];
      if (!category) {
        return { category: null, posts: emptyResult(settings.postsPerPage) };
      }
      const posts = await findPosts({
        where: {
          status: "published",
          categories: category.id as string,
        },
        sort: "-publishedAt",
        limit: settings.postsPerPage,
      });
      return { category, posts };
    },
    {
      revalidate: 60,
      extraTags: ["nx:collection:posts", "nx:collection:categories"],
    },
  );

  if (!data.category) {
    return (
      <ArchiveLayout
        eyebrow="Archive"
        title="Category not found"
        result={data.posts}
      />
    );
  }
  return (
    <ArchiveLayout
      eyebrow="Category"
      title={(data.category.name as string) ?? slug}
      subtitle={data.category.description as string | undefined}
      result={data.posts}
    />
  );
}

function emptyResult(limit: number): NpFindResult<Record<string, unknown>> {
  return {
    docs: [],
    totalDocs: 0,
    totalPages: 0,
    page: 1,
    limit,
    hasNextPage: false,
    hasPrevPage: false,
  };
}

export async function AuthorArchive({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const id = params.id ?? "";
  const settings = await resolveMagazineSettings();
  const data = await cachedThemeFetch(
    ["magazine.author-archive", id, String(settings.postsPerPage)],
    async () => {
      const author = await getUserById(id);
      const posts = await findPosts({
        where: { status: "published", author: id },
        sort: "-publishedAt",
        limit: settings.postsPerPage,
      });
      return { author, posts };
    },
    {
      revalidate: 60,
      extraTags: ["nx:collection:posts"],
    },
  );

  const displayName =
    data.author?.name && data.author.name.length > 0 ? data.author.name : id;
  return (
    <ArchiveLayout
      eyebrow="By the author"
      title={`Stories by ${displayName}`}
      subtitle="Recent posts from this author."
      result={data.posts}
    />
  );
}

export const magazineArchives: NpThemeArchives = {
  posts: {
    byCategory: { component: CategoryArchive },
    byAuthor: { component: AuthorArchive },
  },
};
