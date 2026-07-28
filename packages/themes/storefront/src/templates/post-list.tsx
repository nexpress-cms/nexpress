import type { NpTemplateRenderProps } from "@nexpress/theme";
import Link from "next/link";

interface StorefrontPostListDoc {
  heading?: string;
  docs?: Array<{
    id?: string;
    slug?: string;
    title?: string;
    excerpt?: string;
    publishedAt?: Date | string;
  }>;
}

export function StorefrontPostList({ doc }: NpTemplateRenderProps) {
  const data = doc as StorefrontPostListDoc;
  const posts = data.docs ?? [];
  return (
    <main className="np-storefront-container np-storefront-journal">
      <header>
        <p>Brand journal</p>
        <h1>{data.heading ?? "Stories"}</h1>
        <span>제품, 재료, 만드는 사람과 오래 사용하는 방법을 기록합니다.</span>
      </header>
      {posts.length > 0 ? (
        <div className="np-storefront-journal-grid">
          {posts.map((post, index) => (
            <article key={post.id ?? post.slug ?? index}>
              <span aria-hidden="true">{(index + 1).toString().padStart(2, "0")}</span>
              <div>
                <h2>
                  <Link href={`/blog/${post.slug ?? ""}`}>{post.title ?? "Untitled"}</Link>
                </h2>
                {post.excerpt ? <p>{post.excerpt}</p> : null}
                {post.publishedAt ? (
                  <time dateTime={new Date(post.publishedAt).toISOString()}>
                    {new Date(post.publishedAt).toLocaleDateString()}
                  </time>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="np-storefront-empty">아직 공개된 이야기가 없습니다.</p>
      )}
    </main>
  );
}
