import * as React from "react";
import type { NpRouteRenderProps, NpThemeArchives } from "@nexpress/theme";
import {
  findDocuments,
  type NpFindResult,
} from "@nexpress/core";
import { cachedThemeFetch } from "@nexpress/next";

import { resolveMagazineSettings } from "./settings-helpers.js";

/**
 * Phase F.9 — magazine archive components.
 *
 * Each archive component fetches its own data (per design doc
 * §5.1 — components own queries; framework provides the route
 * dispatch only). The hasMany filter from F.E (#542) keeps the
 * code minimal: `where: { categories: id }` works directly.
 *
 * Two archives shipped:
 *   - byCategory at /category/:slug
 *   - byAuthor at /author/:id
 *
 * byTag and byDate are recorded as F.9.1 follow-up (the
 * shape mirrors byCategory; one less for review focus).
 */

interface ArchiveLayoutProps {
  title: string;
  subtitle?: string;
  result: NpFindResult<Record<string, unknown>>;
}

function ArchiveLayout({
  title,
  subtitle,
  result,
}: ArchiveLayoutProps): React.ReactElement {
  // `<div>` — (site)/layout.tsx already emits the page's `<main>`.
  return (
    <div
      className="np-magazine-archive"
      style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1.5rem" }}
    >
      <header
        style={{
          marginBottom: "2rem",
          borderBottom: "3px double var(--np-color-foreground)",
          paddingBottom: "1rem",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--np-color-muted-foreground)",
            fontSize: "0.8125rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontFamily: "var(--np-font-heading)",
          }}
        >
          Archive
        </p>
        <h1
          style={{
            margin: "0.5rem 0 0",
            fontSize: "2rem",
            fontFamily: "var(--np-font-heading)",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p style={{ margin: "0.75rem 0 0", color: "var(--np-color-muted-foreground)" }}>
            {subtitle}
          </p>
        ) : null}
        <p style={{ margin: "0.75rem 0 0", color: "var(--np-color-muted-foreground)", fontSize: "0.875rem" }}>
          {result.totalDocs} {result.totalDocs === 1 ? "story" : "stories"}
        </p>
      </header>
      {result.docs.length === 0 ? (
        <p style={{ color: "var(--np-color-muted-foreground)" }}>
          No stories yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {result.docs.map((doc) => (
            <li
              key={doc.id as string}
              style={{
                padding: "1.25rem 0",
                borderBottom: "1px solid var(--np-color-border)",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--np-font-heading)",
                  fontSize: "1.25rem",
                  margin: 0,
                }}
              >
                <a
                  href={`/blog/${doc.slug as string}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {doc.title as string}
                </a>
              </h2>
              {doc.excerpt ? (
                <p
                  style={{
                    margin: "0.5rem 0 0",
                    color: "var(--np-color-muted-foreground)",
                  }}
                >
                  {doc.excerpt as string}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function CategoryArchive({
  params,
}: NpRouteRenderProps): Promise<React.ReactElement> {
  const slug = params.slug ?? "";
  const settings = await resolveMagazineSettings();
  // v0.3 (H) — wrap the category + posts fetch in
  // `cachedThemeFetch` so /category/<slug> shares cache entries
  // per slug. The `nx:theme:<siteId>` tag (auto-applied) busts
  // on theme switch / settings save / theme uninstall.
  //
  // extraTags cover BOTH collections this archive reads:
  //   - `nx:collection:posts`     — new published post under
  //     this category re-renders the listing
  //   - `nx:collection:categories` — newly-created / renamed
  //     category invalidates the "not found" branch and lets
  //     `name`/`description` updates land within seconds
  // saveDocument fires `revalidateTag("nx:collection:<slug>")`
  // on every write through revalidateCollection, so this is
  // automatic — operators don't have to think about it.
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
      const posts = await findDocuments<Record<string, unknown>>("posts", {
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
    return <ArchiveLayout title="Category not found" result={data.posts} />;
  }
  return (
    <ArchiveLayout
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
  // v0.3 (H) — same caching shape as CategoryArchive. /author/<id>
  // shares one entry per id. extraTags cover both reads:
  //   - `nx:collection:posts`   — author publishes a new post
  //   - `nx:collection:authors` — author renames / updates bio
  // and the auto-applied `nx:theme:<siteId>` covers theme switch
  // / settings save / uninstall.
  const data = await cachedThemeFetch(
    ["magazine.author-archive", id, String(settings.postsPerPage)],
    async () => {
      const authorRes = await findDocuments<Record<string, unknown>>(
        "authors",
        { where: { id }, limit: 1 },
      );
      const author = authorRes.docs[0] ?? null;
      const posts = await findDocuments<Record<string, unknown>>("posts", {
        where: { status: "published", author: id },
        sort: "-publishedAt",
        limit: settings.postsPerPage,
      });
      return { author, posts };
    },
    {
      revalidate: 60,
      extraTags: ["nx:collection:posts", "nx:collection:authors"],
    },
  );

  const displayName =
    typeof data.author?.name === "string" && data.author.name.length > 0
      ? data.author.name
      : id;
  return (
    <ArchiveLayout
      title={`Stories by ${displayName}`}
      subtitle={
        typeof data.author?.bio === "string" && data.author.bio.length > 0
          ? data.author.bio
          : "Recent posts from this author."
      }
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
