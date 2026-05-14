import { findPosts, resolveTemplateComponent } from "@nexpress/core";
import { createSiteScopedBlockRenderContext } from "@nexpress/next";
import Link from "next/link";
import type { ComponentType } from "react";

import { ShellWrap } from "../../components/shell-wrap";
import { ensureFor } from "../../lib/init-core";

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
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
