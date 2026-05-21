import { fetchFrontListPosts } from "@nexpress/next";
import type { NpTemplateRenderProps } from "@nexpress/theme";

interface JournalPost {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string | null;
  publishedAt?: string | Date | null;
}

function postHref(post: JournalPost): string {
  if (!post.slug) return "#";
  return post.slug.startsWith("/") ? post.slug : `/blog/${post.slug}`;
}

function formatDate(value: JournalPost["publishedAt"]): string {
  if (!value) return "Undated";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Undated";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function PageJournalTemplate(_props: NpTemplateRenderProps) {
  const docs = await fetchFrontListPosts({ kind: "article", limit: 12 });

  return (
    <article className="np-portfolio-journal-page">
      <section className="np-portfolio-subpage-hero np-portfolio-container">
        <p>Journal</p>
        <h1>Process notes, references, and the work behind the work.</h1>
        <div>
          <p>
            The journal is the studio's slower feed: process notes, references we keep coming back
            to, and opinions on type and editorial work that did not quite fit on a project page.
          </p>
        </div>
      </section>

      <section className="np-portfolio-container">
        {docs.length === 0 ? (
          <div className="np-portfolio-empty">
            <h1>The journal is quiet.</h1>
            <p>Add article posts to publish studio notes here.</p>
          </div>
        ) : (
          <ul className="np-portfolio-journal-list">
            {docs.map((post: JournalPost) => (
              <li key={post.id ?? post.slug ?? post.title}>
                <a href={postHref(post)}>
                  <time
                    dateTime={typeof post.publishedAt === "string" ? post.publishedAt : undefined}
                  >
                    {formatDate(post.publishedAt)}
                  </time>
                  <h2>{post.title ?? "Untitled"}</h2>
                  {post.excerpt ? <p>{post.excerpt}</p> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
