/**
 * Card representation of a post in a list / grid context. Used
 * by the post-list template's grid + the related-posts strip on
 * post detail.
 *
 * Renders a small card with title, optional cover image, excerpt,
 * date, and reading time when those fields exist on the doc.
 * Stays defensive on field shapes — sites can fork the posts
 * collection schema, so we use type guards rather than a hard
 * shape requirement.
 */

import Link from "next/link";

export interface PostCardDoc {
  id?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  cover?: { url?: string; alt?: string } | string | null;
  publishedAt?: string | Date;
  readingTime?: number | string;
  author?: { name?: string } | string;
}

export interface PostCardProps {
  doc: PostCardDoc;
  /** Visual variant. "grid" is the default; "feature" is bigger and lets the cover image stretch. */
  variant?: "grid" | "feature";
}

function coverImageUrl(cover: PostCardDoc["cover"]): string | null {
  if (!cover) return null;
  if (typeof cover === "string") return cover;
  return cover.url ?? null;
}

function coverAlt(cover: PostCardDoc["cover"], fallback: string): string {
  if (cover && typeof cover === "object" && cover.alt) return cover.alt;
  return fallback;
}

function formatDate(value: PostCardDoc["publishedAt"]): string | null {
  if (!value) return null;
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function readingTimeLabel(value: PostCardDoc["readingTime"]): string | null {
  if (!value && value !== 0) return null;
  if (typeof value === "number") return `${value.toString()} min read`;
  return value;
}

function authorName(author: PostCardDoc["author"]): string | null {
  if (!author) return null;
  if (typeof author === "string") return author;
  return author.name ?? null;
}

function postHref(doc: PostCardDoc): string {
  if (doc.slug) {
    return doc.slug.startsWith("/") ? doc.slug : `/blog/${doc.slug}`;
  }
  return "#";
}

export function PostCard({ doc, variant = "grid" }: PostCardProps) {
  const href = postHref(doc);
  const cover = coverImageUrl(doc.cover);
  const date = formatDate(doc.publishedAt);
  const reading = readingTimeLabel(doc.readingTime);
  const author = authorName(doc.author);
  const title = doc.title ?? "Untitled";
  return (
    <article
      className={`np-post-card${variant === "feature" ? " np-post-card-feature" : ""}`}
    >
      <Link href={href} className="np-post-card-link">
        {cover ? (
          <div className="np-post-card-cover">
            <img src={cover} alt={coverAlt(doc.cover, title)} loading="lazy" />
          </div>
        ) : null}
        <div className="np-post-card-body">
          <h3 className="np-post-card-title">{title}</h3>
          {doc.excerpt ? (
            <p className="np-post-card-excerpt">{doc.excerpt}</p>
          ) : null}
          <div className="np-post-card-meta">
            {author ? <span>{author}</span> : null}
            {date ? <time dateTime={String(doc.publishedAt)}>{date}</time> : null}
            {reading ? <span>{reading}</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
