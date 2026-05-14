/**
 * Card representation of a post in a list / grid context. Used
 * by the post-list template's grid + the related-posts strip on
 * post detail.
 *
 * Two visual variants:
 *
 *   - `"grid"` (default) — cover on top, optional tags row,
 *     title, excerpt, author+meta row. The cover renders as a
 *     gradient swatch with an optional monogram figure (issue
 *     number, two-letter shortcode) when the document carries
 *     no real cover image. The template assigns
 *     `coverGradient: 1-6` based on grid index so the row reads
 *     as a typographic mosaic.
 *
 *   - `"feature"` — wide 2-col split: gradient cover on the
 *     left, body block (kicker / title / excerpt / meta) on the
 *     right. Bigger headline, more generous padding, hover lift.
 *     One feature card sits above the grid.
 *
 * Stays defensive on field shapes — sites can fork the posts
 * collection schema, so we use type guards rather than a hard
 * shape requirement. Any visual hint (`coverGradient`,
 * `coverFigure`, `kicker`, `avatarTone`) is template-supplied
 * presentation metadata; the underlying doc keeps its plain
 * `title` / `excerpt` / `tags` / `author` shape.
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
  /** Tag labels for the kicker row on grid cards. Plain strings. */
  tags?: string[];
}

export interface PostCardProps {
  doc: PostCardDoc;
  /** Visual variant. `"grid"` is the default; `"feature"` is the big 2-col splash card. */
  variant?: "grid" | "feature";
  /**
   * Template-supplied gradient swatch index (1–6) used when the
   * doc has no real cover image. Cycles across the grid so cards
   * read as a typographic mosaic rather than uniform tiles.
   */
  coverGradient?: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Big monogram drawn into the cover (e.g. `"01"`, `"RW"`,
   * doc-id slice). Treated as decoration; falls back to a blank
   * cover when omitted.
   */
  coverFigure?: string;
  /**
   * Two short labels rendered along the bottom edge of the cover
   * on the feature card variant only — typically issue number on
   * the left and read time on the right.
   */
  coverOverlay?: { left: string; right: string };
  /**
   * Eyebrow above the title (e.g. `"Engineering · Featured"`).
   * Rendered uppercase + monospace + primary color on feature
   * cards; grid cards use the `tags` row instead.
   */
  kicker?: string;
  /**
   * Author-avatar gradient hint, cycled across the grid so cards
   * with the same author still don't all wear the same color
   * tile. Values 1–4 map to gradient pairs in styles.ts.
   */
  avatarTone?: 1 | 2 | 3 | 4;
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
  if (typeof value === "number") return `${value.toString()} min`;
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

export function PostCard({
  doc,
  variant = "grid",
  coverGradient,
  coverFigure,
  coverOverlay,
  kicker,
  avatarTone,
}: PostCardProps) {
  const href = postHref(doc);
  const cover = coverImageUrl(doc.cover);
  const date = formatDate(doc.publishedAt);
  const reading = readingTimeLabel(doc.readingTime);
  const author = authorName(doc.author);
  const title = doc.title ?? "Untitled";
  const articleClass =
    variant === "feature"
      ? "np-post-card np-post-card-feature"
      : "np-post-card";
  const coverClass = [
    "np-post-card-cover",
    !cover && coverGradient ? `np-cover-grad-${coverGradient.toString()}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const avatarClass = [
    "np-post-card-meta-avatar",
    avatarTone ? `tone-${avatarTone.toString()}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={articleClass}>
      <Link href={href} className="np-post-card-link">
        <div className={coverClass}>
          {cover ? (
            <img src={cover} alt={coverAlt(doc.cover, title)} loading="lazy" />
          ) : coverFigure ? (
            <div className="np-post-card-cover-figure">{coverFigure}</div>
          ) : null}
          {variant === "feature" && coverOverlay ? (
            <div className="np-post-card-cover-overlay">
              <span>{coverOverlay.left}</span>
              <span>{coverOverlay.right}</span>
            </div>
          ) : null}
        </div>
        <div className="np-post-card-body">
          {variant === "feature" && kicker ? (
            <span className="np-post-card-kicker">{kicker}</span>
          ) : null}
          {variant !== "feature" && doc.tags && doc.tags.length > 0 ? (
            <ul className="np-post-card-tags">
              {doc.tags.map((tag, idx) => (
                <li key={`tag-${tag}-${idx.toString()}`}>{tag}</li>
              ))}
            </ul>
          ) : null}
          <h3 className="np-post-card-title">{title}</h3>
          {doc.excerpt ? (
            <p className="np-post-card-excerpt">{doc.excerpt}</p>
          ) : null}
          <div className="np-post-card-meta">
            {author ? (
              <span className="np-post-card-meta-author">
                <span className={avatarClass} aria-hidden="true" />
                {author}
              </span>
            ) : null}
            {author && (date || reading) ? (
              <span className="np-post-card-meta-sep" aria-hidden="true" />
            ) : null}
            {date && !reading ? (
              <time dateTime={String(doc.publishedAt)}>{date}</time>
            ) : null}
            {reading ? <span>{reading}</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
