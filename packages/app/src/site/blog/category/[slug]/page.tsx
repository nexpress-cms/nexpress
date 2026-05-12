import { buildPageMetadata } from "@nexpress/next";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PaginationNav } from "../../../../components/pagination-nav";
import { ShellWrap } from "../../../../components/shell-wrap";
import { findCategories, findPosts, type CategoriesDocument } from "@/db/generated/documents";
import { ensureFor } from "@/lib/init-core";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

const PAGE_SIZE = 20;

async function loadCategory(slug: string): Promise<CategoriesDocument | null> {
  const result = await findCategories({
    where: { slug },
    limit: 1,
  });
  return result.docs[0] ?? null;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  await ensureFor("read");
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) return {};
  return buildPageMetadata({
    title: `${category.name} — Blog`,
    description: category.description ?? `Posts categorized as ${category.name}.`,
    path: `/blog/category/${category.slug}`,
  });
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  await ensureFor("read");
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) notFound();

  const { page: pageRaw } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  // hasMany filter — Phase E made this work natively. The
  // codegen wrapper for `findPosts` detects `categories` as a
  // hasMany relationship, subqueries `np_c_posts__categories`
  // for matching post ids, and delegates to `findDocuments` with
  // an `id: idList` filter. siteId / visibility / access.read
  // gates are all preserved (we're going through findDocuments,
  // not raw Drizzle).
  const result = await findPosts({
    where: {
      status: "published",
      categories: category.id,
    },
    sort: "-publishedAt",
    page: pageNum,
    limit: PAGE_SIZE,
  });

  return (
    <ShellWrap surface="site">
      <article
        className="np-blog-category"
        style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1.5rem" }}
      >
        <header style={{ marginBottom: "2rem" }}>
          <p
            style={{
              margin: 0,
              color: "#64748b",
              fontSize: "0.8125rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Category
          </p>
          <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem" }}>{category.name}</h1>
          {category.description ? (
            <p style={{ margin: "0.75rem 0 0", color: "#475569" }}>{category.description}</p>
          ) : null}
          <p
            style={{
              margin: "0.5rem 0 0",
              color: "#94a3b8",
              fontSize: "0.875rem",
            }}
          >
            {result.totalDocs} {result.totalDocs === 1 ? "post" : "posts"}
          </p>
        </header>

        {result.docs.length === 0 ? (
          <p style={{ color: "#64748b" }}>No posts in {category.name} yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {result.docs.map((doc) => (
              <li key={doc.id} style={{ padding: "1rem 0", borderBottom: "1px solid #e2e8f0" }}>
                <h2 style={{ fontSize: "1.125rem", margin: 0 }}>
                  <Link href={`/blog/${doc.slug}`}>{doc.title}</Link>
                </h2>
                {doc.excerpt ? (
                  <p style={{ margin: "0.5rem 0 0", color: "#475569" }}>{doc.excerpt}</p>
                ) : null}
                {doc.publishedAt ? (
                  <time
                    dateTime={doc.publishedAt.toISOString()}
                    style={{
                      display: "block",
                      marginTop: "0.5rem",
                      color: "#94a3b8",
                      fontSize: "0.8125rem",
                    }}
                  >
                    {doc.publishedAt.toLocaleDateString()}
                  </time>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <PaginationNav
          page={pageNum}
          totalPages={result.totalPages}
          hasPrevPage={result.hasPrevPage}
          hasNextPage={result.hasNextPage}
          hrefForPage={(p) => `/blog/category/${category.slug}?page=${p}`}
        />
      </article>
    </ShellWrap>
  );
}
