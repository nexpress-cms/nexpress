import { renderRichText } from "@nexpress/editor/server";
import type { NxRichTextContent } from "@nexpress/editor";

import type { NxTemplateRenderProps } from "@nexpress/theme";

/**
 * Post detail template. Produces a centered article column with
 * a small meta header (date / author / reading time) and the
 * Lexical body. Renders defensively — sites can attach extra
 * fields (cover, tags, related) and the template surfaces what
 * exists without breaking when fields are missing.
 *
 * The hero / cover image, when present, sits above the title in
 * a constrained 16:9 frame so portrait images don't blow up the
 * viewport. Tags render as small badges at the top of the meta
 * row when the doc carries them; otherwise we skip the row.
 */

interface PostDoc {
  title?: string;
  excerpt?: string;
  content?: NxRichTextContent;
  publishedAt?: string | Date;
  author?: { name?: string; slug?: string } | string;
  readingTime?: number | string;
  cover?: { url?: string; alt?: string } | string | null;
  tags?: Array<string | { label?: string; slug?: string }> | null;
}

function coverUrl(value: PostDoc["cover"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.url ?? null;
}

function coverAlt(value: PostDoc["cover"], fallback: string): string {
  if (value && typeof value === "object" && value.alt) return value.alt;
  return fallback;
}

function authorLabel(author: PostDoc["author"]): string | null {
  if (!author) return null;
  if (typeof author === "string") return author;
  return author.name ?? null;
}

function tagItems(tags: PostDoc["tags"]) {
  if (!tags || tags.length === 0) return [] as Array<{ label: string; slug?: string }>;
  return tags.map((tag) => {
    if (typeof tag === "string") return { label: tag };
    return { label: tag.label ?? tag.slug ?? "tag", slug: tag.slug };
  });
}

function formatDate(value: PostDoc["publishedAt"]): string | null {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function readingTimeLabel(value: PostDoc["readingTime"]): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "number") return `${value.toString()} min read`;
  return value;
}

export function PostDefaultTemplate({ doc }: NxTemplateRenderProps) {
  const post = doc as PostDoc;
  const title = post.title ?? "Untitled";
  const cover = coverUrl(post.cover);
  const author = authorLabel(post.author);
  const date = formatDate(post.publishedAt);
  const reading = readingTimeLabel(post.readingTime);
  const tags = tagItems(post.tags);

  return (
    <article className="nx-post nx-post-default">
      {cover ? (
        <figure className="nx-post-cover">
          <img src={cover} alt={coverAlt(post.cover, title)} />
        </figure>
      ) : null}
      <header className="nx-post-header">
        {tags.length > 0 ? (
          <ul className="nx-post-tags">
            {tags.map((tag) => (
              <li key={tag.slug ?? tag.label}>
                {tag.slug ? (
                  <a href={`/tags/${tag.slug}`}>{tag.label}</a>
                ) : (
                  <span>{tag.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <h1 className="nx-post-title">{title}</h1>
        {post.excerpt ? <p className="nx-post-excerpt">{post.excerpt}</p> : null}
        <div className="nx-post-meta">
          {author ? (
            <span className="nx-post-meta-author">By {author}</span>
          ) : null}
          {date ? (
            <time
              className="nx-post-meta-date"
              dateTime={String(post.publishedAt)}
            >
              {date}
            </time>
          ) : null}
          {reading ? (
            <span className="nx-post-meta-reading">{reading}</span>
          ) : null}
        </div>
      </header>
      <div className="nx-post-body">
        {post.content ? renderRichText(post.content) : null}
      </div>
    </article>
  );
}
