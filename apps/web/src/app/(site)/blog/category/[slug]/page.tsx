import { buildPageMetadata } from "@nexpress/next";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PaginationNav } from "@/components/pagination-nav";
import {
  postsCategoriesTable,
  postsTable,
} from "@/db/generated/collections";
import {
  findCategories,
  type CategoriesDocument,
  type PostsDocument,
} from "@/db/generated/documents";
import { getDb } from "@/lib/bootstrap";
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

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  await ensureFor("read");
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) return {};
  return buildPageMetadata({
    title: `${category.name} — Blog`,
    description:
      category.description ?? `Posts categorized as ${category.name}.`,
    path: `/blog/category/${category.slug}`,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  await ensureFor("read");
  const { slug } = await params;
  const category = await loadCategory(slug);
  if (!category) notFound();

  const { page: pageRaw } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);

  // ─── hasMany relationship filter — raw Drizzle ────────────────
  //
  // findPosts (and findDocuments under it) only filter by direct
  // columns. The `categories` field on a post is a hasMany
  // relationship stored in `np_c_posts__categories` — there's no
  // `categories` column on `np_c_posts`. Until the framework
  // grows hasMany filtering on findDocuments, the join has to be
  // explicit. The pattern: subquery the join table for matching
  // post ids, then filter the posts query by `id IN (...)`.
  //
  // The codegen typed wrappers don't help here — they generate
  // `where: Partial<PostsDocument>` which lets you SAY
  // `categories: [id]` but the runtime ignores the field. Phase
  // E candidate: detect hasMany fields at codegen and emit a
  // helper.
  const db = getDb();
  const offset = (pageNum - 1) * PAGE_SIZE;
  const postIdSubquery = db
    .select({ id: postsCategoriesTable.postsId })
    .from(postsCategoriesTable)
    .where(eq(postsCategoriesTable.targetId, category.id));

  const filter = and(
    eq(postsTable.status, "published"),
    inArray(postsTable.id, postIdSubquery),
  );

  const [docs, totalRow] = await Promise.all([
    db
      .select()
      .from(postsTable)
      .where(filter)
      .orderBy(desc(postsTable.publishedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ total: count() }).from(postsTable).where(filter),
  ]);
  const totalDocs = Number(totalRow[0]?.total ?? 0);
  const totalPages = totalDocs === 0 ? 0 : Math.ceil(totalDocs / PAGE_SIZE);
  // The rows come from `postsTable` directly so they're already
  // shaped like `PostsDocument` — same projection the typed
  // wrappers return.
  const posts = docs as unknown as PostsDocument[];

  return (
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
        <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.75rem" }}>
          {category.name}
        </h1>
        {category.description ? (
          <p style={{ margin: "0.75rem 0 0", color: "#475569" }}>
            {category.description}
          </p>
        ) : null}
        <p
          style={{
            margin: "0.5rem 0 0",
            color: "#94a3b8",
            fontSize: "0.875rem",
          }}
        >
          {totalDocs} {totalDocs === 1 ? "post" : "posts"}
        </p>
      </header>

      {posts.length === 0 ? (
        <p style={{ color: "#64748b" }}>
          No posts in {category.name} yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {posts.map((doc) => (
            <li
              key={doc.id}
              style={{ padding: "1rem 0", borderBottom: "1px solid #e2e8f0" }}
            >
              <h2 style={{ fontSize: "1.125rem", margin: 0 }}>
                <Link href={`/blog/${doc.slug}`}>{doc.title}</Link>
              </h2>
              {doc.excerpt ? (
                <p style={{ margin: "0.5rem 0 0", color: "#475569" }}>
                  {doc.excerpt}
                </p>
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
        totalPages={totalPages}
        hasPrevPage={pageNum > 1 && totalDocs > 0}
        hasNextPage={pageNum < totalPages}
        hrefForPage={(p) => `/blog/category/${category.slug}?page=${p}`}
      />
    </article>
  );
}
