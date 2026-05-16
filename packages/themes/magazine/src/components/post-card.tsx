/**
 * Magazine-style post card. Editorial flavor: serif headline,
 * small caps kicker (when a `kicker` field is present), thin
 * rule under the byline.
 */

export interface MagazinePostCardDoc {
  id?: string;
  slug?: string;
  title?: string;
  kicker?: string;
  excerpt?: string;
  cover?: { url?: string; alt?: string } | string | null;
  /** Theme-contributed upload field (`requires.collections.posts.coverImage`).
   *  Used by the index template's lead / 3-up / archive cards. */
  coverImage?: { url?: string; alt?: string } | string | null;
  publishedAt?: string | Date;
  authorName?: string;
  author?: { name?: string } | string;
  /** Reading-time estimate; usually populated by the reading-time
   *  plugin's `content:afterSave` hook. Number = minutes, string =
   *  pre-formatted label. */
  readingTime?: number | string;
  /** Promotes the doc to the index template's lead position.
   *  Operator-set via the admin's posts edit view. */
  featured?: boolean;
  /** Category references — relationship rows or just names.
   *  Surfaced as the kicker eyebrow on grid / archive cards. */
  categories?: Array<{ name?: string } | string>;
  /** Tag references — used as the kicker fallback when no
   *  category is set on the post. */
  tags?: Array<{ name?: string } | string>;
}

function coverUrl(value: MagazinePostCardDoc["cover"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.url ?? null;
}

function coverAlt(value: MagazinePostCardDoc["cover"], fallback: string): string {
  if (value && typeof value === "object" && value.alt) return value.alt;
  return fallback;
}

function authorLabel(doc: MagazinePostCardDoc): string | null {
  if (doc.authorName) return doc.authorName;
  if (!doc.author) return null;
  if (typeof doc.author === "string") return doc.author;
  return doc.author.name ?? null;
}

function formatDate(value: MagazinePostCardDoc["publishedAt"]): string | null {
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

function postHref(doc: MagazinePostCardDoc): string {
  if (doc.slug) {
    return doc.slug.startsWith("/") ? doc.slug : `/blog/${doc.slug}`;
  }
  return "#";
}

export interface MagazinePostCardProps {
  doc: MagazinePostCardDoc;
  variant?: "feature" | "grid" | "list";
}

export function MagazinePostCard({ doc, variant = "grid" }: MagazinePostCardProps) {
  const href = postHref(doc);
  const cover = coverUrl(doc.cover);
  const date = formatDate(doc.publishedAt);
  const author = authorLabel(doc);
  const title = doc.title ?? "Untitled";

  return (
    <article className={`np-magazine-card np-magazine-card-${variant}`}>
      <a href={href} className="np-magazine-card-link">
        {cover ? (
          <figure className="np-magazine-card-cover">
            <img src={cover} alt={coverAlt(doc.cover, title)} loading="lazy" />
          </figure>
        ) : null}
        <div className="np-magazine-card-body">
          {doc.kicker ? <p className="np-magazine-card-kicker">{doc.kicker}</p> : null}
          <h3 className="np-magazine-card-title">{title}</h3>
          {doc.excerpt ? <p className="np-magazine-card-excerpt">{doc.excerpt}</p> : null}
          {(author || date) ? (
            <p className="np-magazine-card-meta">
              {author ? <span>{author}</span> : null}
              {author && date ? <span aria-hidden="true"> · </span> : null}
              {date ? <time dateTime={String(doc.publishedAt)}>{date}</time> : null}
            </p>
          ) : null}
        </div>
      </a>
    </article>
  );
}
