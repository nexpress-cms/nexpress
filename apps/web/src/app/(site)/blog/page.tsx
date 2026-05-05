import { findPosts } from "@nexpress/core";
import Link from "next/link";

import { ensureFor } from "@/lib/init-core";

interface BlogPageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  await ensureFor("read");
  const { page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page || "1", 10));

  const { docs, totalPages, hasPrevPage, hasNextPage } = await findPosts({
    where: { status: "published" },
    sort: "-createdAt",
    page: pageNum,
    limit: 10,
  });

  return (
    <div className="np-blog">
      <h1>Blog</h1>
      <div className="np-blog-list">
        {docs.map((post) => (
          <article key={post.id as string} className="np-blog-card">
            <h2>
              <Link href={`/blog/${post.slug as string}`}>
                {post.title as string}
              </Link>
            </h2>
            {post.excerpt ? (
              <p className="np-blog-excerpt">{post.excerpt as string}</p>
            ) : null}
            <time dateTime={(post.createdAt as Date)?.toISOString?.()}>
              {(post.createdAt as Date)?.toLocaleDateString?.()}
            </time>
          </article>
        ))}
      </div>
      {totalPages > 1 && (
        <nav className="np-blog-pagination">
          {hasPrevPage && (
            <Link href={`/blog?page=${pageNum - 1}`}>← Previous</Link>
          )}
          <span>
            Page {pageNum} of {totalPages}
          </span>
          {hasNextPage && (
            <Link href={`/blog?page=${pageNum + 1}`}>Next →</Link>
          )}
        </nav>
      )}
    </div>
  );
}
