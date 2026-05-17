import { findDocuments, findPosts, resolveTemplateComponent } from "@nexpress/core";
import { buildPageMetadata, createSiteScopedBlockRenderContext } from "@nexpress/next";
import { getActiveTheme } from "@nexpress/theme";
import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";

import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "../../lib/init-core";

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
}

/**
 * Metadata for `/blog`.
 *
 * Baseline: a stable title + description so the page has
 * meaningful SEO defaults instead of inheriting whatever the
 * root layout exposes. Operators who want a different copy can
 * override by registering their own theme template for the blog
 * index — the metadata only fires when this framework route is
 * the one that renders.
 *
 * Canonical: some themes (magazine, portfolio) ship a
 * `pages.front` template that's literally the post-list /
 * project-grid layout, and their seeded home page renders it.
 * That makes `/` and `/blog` effectively the same content;
 * search engines would dedupe unpredictably. We emit
 * `alternates.canonical: "/"` only when the active theme meets
 * all of the following:
 *
 *   - `pages.front` template is registered
 *   - The home page (`slug = "/"`) is set to use it
 *   - The theme also provides `templates.posts.list` or
 *     `templates.posts.index` — the keys the framework actually
 *     dispatches to from `/blog`
 *
 * The third condition rules out docs: docs has `pages.front`
 * and a seeded `/` that uses it, but `/blog` falls back to the
 * framework default list because docs only ships
 * `templates.posts.doc`. Different content → no canonical.
 */
export async function generateMetadata({
  searchParams,
}: BlogPageProps): Promise<Metadata> {
  await ensureFor("read");

  const { page } = await searchParams;
  // Parse the same way the page component does so an invalid
  // `?page=abc` falls back to page 1 in BOTH the metadata and
  // the rendered list — otherwise the metadata canonical and
  // the body would describe different pages.
  const pageNum = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const isFirstPage = pageNum === 1;

  // `path` is what THIS page is — drives the OpenGraph `url` so
  // social cards reflect the resource being shared.
  // `canonicalPath` is where search engines should treat the
  // content as canonical. They diverge only on page 1 of a
  // theme that renders the post list at `/` (canonical → "/"
  // while OG stays at /blog). Paginated pages stay self-
  // canonical regardless of theme.
  const path = isFirstPage ? "/blog" : `/blog?page=${pageNum}`;
  const canonicalPath =
    isFirstPage && (await shouldCanonicalizeToHome()) ? "/" : path;

  return buildPageMetadata({
    title: isFirstPage ? "Blog" : `Blog — page ${pageNum}`,
    description: "Recent posts from the blog.",
    path,
    canonicalPath,
  });
}

async function shouldCanonicalizeToHome(): Promise<boolean> {
  const active = await getActiveTheme();
  const postTemplates = active?.impl.templates?.posts;
  const hasListOrIndex = Boolean(
    postTemplates?.list ?? postTemplates?.index,
  );
  const hasFrontTemplate = Boolean(active?.impl.templates?.pages?.front);
  if (!hasFrontTemplate || !hasListOrIndex) return false;

  const home = await findDocuments<{ slug?: string; template?: string }>(
    "pages",
    {
      where: { slug: "/", status: "published" },
      limit: 1,
    },
  );
  const homeTemplate =
    typeof home.docs[0]?.template === "string" ? home.docs[0].template : null;
  return homeTemplate === "front";
}

/**
 * Blog index page.
 *
 * Phase #612 (2026-05-11) — dispatches through the active
 * theme's `templates.posts.{list,index,feature}` if any is
 * declared, falling back to the framework's inline list when
 * the theme doesn't provide one. Theme template IDs aren't
 * standardized across themes (magazine uses "list", portfolio
 * uses "index", magazine also has "feature"), so the lookup
 * tries each in priority order.
 *
 * The list payload is packed into a synthetic `doc` matching
 * the convention magazine's `PostListTemplate` and portfolio's
 * `ProjectIndexTemplate` already use: `{ heading, intro, docs,
 * totalDocs, pageNum, totalPages, hasPrevPage, hasNextPage }`.
 * Templates that read additional keys just see undefined and
 * fall back to their internal defaults.
 */
export default async function BlogPage({ searchParams }: BlogPageProps) {
  await ensureFor("plugins");
  const { page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page || "1", 10));

  const result = await findPosts({
    where: { status: "published" },
    sort: "-createdAt",
    page: pageNum,
    limit: 10,
  });
  const { docs, totalPages, hasPrevPage, hasNextPage } = result;

  const ListTemplate = await resolvePostsListTemplate();

  if (ListTemplate) {
    const blockCtx = await createSiteScopedBlockRenderContext();
    return (
      <ShellWrap surface="site">
        <ListTemplate
          doc={{
            heading: "Blog",
            docs,
            totalDocs: result.totalDocs,
            pageNum,
            totalPages,
            hasPrevPage,
            hasNextPage,
          }}
          blockCtx={blockCtx}
        />
      </ShellWrap>
    );
  }

  return (
    <ShellWrap surface="site">
      <div className="np-blog">
        <h1>Blog</h1>
        <div className="np-blog-list">
          {docs.map((post) => (
            <article key={post.id as string} className="np-blog-card">
              <h2>
                <Link href={`/blog/${post.slug as string}`}>{post.title as string}</Link>
              </h2>
              {post.excerpt ? <p className="np-blog-excerpt">{post.excerpt as string}</p> : null}
              <time dateTime={(post.createdAt as Date)?.toISOString?.()}>
                {(post.createdAt as Date)?.toLocaleDateString?.()}
              </time>
            </article>
          ))}
        </div>
        {totalPages > 1 && (
          <nav className="np-blog-pagination">
            {hasPrevPage && <Link href={`/blog?page=${pageNum - 1}`}>← Previous</Link>}
            <span>
              Page {pageNum} of {totalPages}
            </span>
            {hasNextPage && <Link href={`/blog?page=${pageNum + 1}`}>Next →</Link>}
          </nav>
        )}
      </div>
    </ShellWrap>
  );
}

type PostsListTemplate = ComponentType<{
  doc: Record<string, unknown>;
  blockCtx?: unknown;
}>;

/**
 * Walk the conventional list-template IDs in priority order.
 * Magazine uses `list`, portfolio uses `index` — both for the
 * list view. Themes that ship neither fall back to the inline
 * framework default.
 *
 * Note: `feature` is NOT in this priority list. Magazine's
 * `feature` template is a long-form post DETAIL template
 * ("Large headline, byline rule, dropcap on the first
 * paragraph"), which renders one doc — wrong shape for a list
 * view. It belongs to the detail dispatcher in
 * `[slug]/page.tsx`.
 */
async function resolvePostsListTemplate(): Promise<PostsListTemplate | null> {
  for (const templateId of ["list", "index"] as const) {
    const entry = (await resolveTemplateComponent("posts", templateId)) as
      | { component?: PostsListTemplate }
      | null;
    if (entry?.component) return entry.component;
  }
  return null;
}
