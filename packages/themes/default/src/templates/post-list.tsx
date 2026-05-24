import type { NpTemplateRenderProps } from "@nexpress/theme";
import Link from "next/link";

import { PostCard, type PostCardDoc } from "../components/post-card.js";

// `NewsletterForm` (the client component with useState for
// inline success / error messaging) lives in its own bundle so
// the `"use client"` directive survives. Pulling it into this
// server template would inline `useState` into the main theme
// bundle and crash the Next build. The inline newsletter here
// renders a plain `<form action="/api/newsletter">` instead —
// same endpoint the footer's NewsletterForm POSTs to, so the
// operator only wires up one route. Sites that want the
// inline-feedback variant override the `newsletter` doc field
// with their own component.

/**
 * Blog index template. The first post becomes the feature card
 * (large 2-column splash); the rest fill a 3-column grid. The
 * page header carries a small eyebrow pill above the headline,
 * an intro paragraph, and an optional category pill strip.
 *
 * The template is collection-agnostic — sites can route any
 * collection through it (e.g. /resources, /case-studies). The
 * doc shape we expect is `{ docs: PostCardDoc[] }`; pagination
 * metadata is rendered when the consumer provides it on `doc`.
 *
 * Visual hints (cover gradient swatch, avatar tone) are derived
 * from each card's index in the grid so the row reads as a
 * typographic mosaic rather than uniform tiles. Documents
 * without a real cover image fall back to a gradient + monogram
 * figure that's stable per doc.
 */
interface PostCardWithTags extends PostCardDoc {
  /** Category label rendered as the feature kicker; first tag otherwise. */
  category?: string;
  /** Override for the cover-figure monogram (e.g. "01", "RW"). */
  coverFigure?: string;
}

interface PaginationLink {
  label: string;
  href?: string;
  current?: boolean;
  disabled?: boolean;
  gap?: boolean;
}

interface PostListDoc {
  docs?: PostCardWithTags[];
  /** Page heading shown above the grid. */
  heading?: string;
  /** Optional small label rendered in a primary-tinted pill above the headline. */
  eyebrow?: string;
  /** Optional paragraph beneath the heading. */
  intro?: string;
  /** Category strip pills. */
  categories?: Array<{ label: string; href?: string; count?: number; active?: boolean }>;
  /** Section head meta string (e.g. "68 posts · sorted by date"). */
  sectionMeta?: string;
  /** Pagination items. When omitted the pagination row is hidden. */
  pagination?: PaginationLink[];
  /** Newsletter copy / form override. Hidden when `false`. */
  newsletter?:
    | false
    | {
        heading?: string;
        body?: string;
      };
}

type CategoryStripItem = NonNullable<PostListDoc["categories"]>[number];

const COVER_GRADIENTS: Array<1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6];
const AVATAR_TONES: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
const DEFAULT_INDEX_COPY = {
  eyebrow: "/writing",
  heading: "Notes from the edge of distributed systems.",
  intro:
    "Long-form essays and shorter notes on the trade-offs that show up when you actually ship — databases, type systems, queues, the bits in between.",
  sectionMeta: "68 posts · sorted by date",
  featureOverlay: {
    left: "ISSUE\u00a0#47",
    right: "14\u00a0MIN\u00a0READ",
  },
  newsletter: {
    heading: "One essay every other Tuesday. No threads, no roundups.",
    body: "Three thousand engineers read it. Cancel any time — the archive stays public.",
  },
};
const DEFAULT_INDEX_CATEGORIES: CategoryStripItem[] = [
  { label: "All", active: true },
  { label: "Engineering", href: "/tag/engineering", count: 24 },
  { label: "Postgres", href: "/tag/postgres", count: 12 },
  { label: "TypeScript", href: "/tag/typescript", count: 9 },
  { label: "Distributed", href: "/tag/distributed", count: 7 },
  { label: "Product", href: "/tag/product", count: 5 },
];

export function createDefaultPostListDoc(docs: unknown[]): PostListDoc {
  return {
    docs: docs as PostCardWithTags[],
    heading: DEFAULT_INDEX_COPY.heading,
    eyebrow: DEFAULT_INDEX_COPY.eyebrow,
    intro: DEFAULT_INDEX_COPY.intro,
    categories: DEFAULT_INDEX_CATEGORIES,
    sectionMeta: DEFAULT_INDEX_COPY.sectionMeta,
    newsletter: DEFAULT_INDEX_COPY.newsletter,
  };
}

function gridCoverGradient(index: number): 1 | 2 | 3 | 4 | 5 | 6 {
  // Six-step cycle so consecutive cards never share a gradient.
  return COVER_GRADIENTS[index % COVER_GRADIENTS.length];
}

function gridAvatarTone(index: number): 1 | 2 | 3 | 4 {
  return AVATAR_TONES[index % AVATAR_TONES.length];
}

function gridCoverFigure(doc: PostCardWithTags, index: number): string {
  // Operator override wins; otherwise emit a zero-padded sequence
  // number ("01", "02", ...). Stable across re-renders because the
  // grid order is the data's order.
  if (doc.coverFigure) return doc.coverFigure;
  return (index + 1).toString().padStart(2, "0");
}

function featureKicker(doc: PostCardWithTags): string | undefined {
  if (doc.category) return `${doc.category} · Featured`;
  if (doc.tags && doc.tags.length > 0) return `${doc.tags[0]} · Featured`;
  return "Featured";
}

function featureFigure(doc: PostCardWithTags): string | undefined {
  if (doc.coverFigure) return doc.coverFigure;
  if (!doc.title) return undefined;
  // First two non-space letters, uppercase. Lets a card with
  // title "Read-your-writes…" render "RW" in the cover.
  return doc.title
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}

function readingMinutes(value: PostCardDoc["readingTime"]): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const m = /^(\d+)/.exec(value);
    if (m) return Number(m[1]);
  }
  return null;
}

function deriveCategoryStrip(
  docs: PostCardWithTags[],
): Array<{ label: string; href?: string; count?: number; active?: boolean }> {
  const counts = new Map<string, number>();
  for (const d of docs) {
    for (const tag of d.tags ?? []) {
      if (typeof tag === "string" && tag.length > 0) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
  return [{ label: "All", count: docs.length, active: true }, ...top];
}

export function PostListTemplate({ doc }: NpTemplateRenderProps) {
  const data = doc as PostListDoc;
  const useDefaultIndexCopy =
    data.heading === "Blog" &&
    !data.eyebrow &&
    !data.intro &&
    !data.categories &&
    !data.sectionMeta &&
    data.newsletter === undefined;
  const heading = useDefaultIndexCopy ? DEFAULT_INDEX_COPY.heading : (data.heading ?? "Posts");
  const eyebrow = useDefaultIndexCopy ? DEFAULT_INDEX_COPY.eyebrow : data.eyebrow;
  const intro = useDefaultIndexCopy ? DEFAULT_INDEX_COPY.intro : data.intro;
  const all = data.docs ?? [];
  const categories =
    data.categories ??
    (useDefaultIndexCopy
      ? DEFAULT_INDEX_CATEGORIES
      : all.length > 0
        ? deriveCategoryStrip(all)
        : []);

  if (all.length === 0) {
    return (
      <section className="np-post-list np-post-list-empty">
        <header className="np-post-list-header">
          {eyebrow ? <span className="np-post-list-eyebrow">{eyebrow}</span> : null}
          <h1>{heading}</h1>
          <p className="np-post-list-intro">
            No posts yet — once you publish from the admin, they'll appear here.
          </p>
        </header>
      </section>
    );
  }

  const [feature, ...rest] = all;
  const featureCoverOverlay = feature
    ? useDefaultIndexCopy
      ? DEFAULT_INDEX_COPY.featureOverlay
      : {
          left: `ISSUE\u00a0#${all.length.toString().padStart(2, "0")}`,
          right: (() => {
            const m = readingMinutes(feature.readingTime);
            return m ? `${m.toString()}\u00a0MIN\u00a0READ` : "FEATURED";
          })(),
        }
    : undefined;
  const sectionMetaCopy =
    data.sectionMeta ??
    (useDefaultIndexCopy
      ? DEFAULT_INDEX_COPY.sectionMeta
      : rest.length > 0
        ? `${rest.length.toString()} ${rest.length === 1 ? "post" : "posts"} · sorted by date`
        : undefined);
  const newsletter =
    data.newsletter === false
      ? null
      : (data.newsletter ?? (useDefaultIndexCopy ? DEFAULT_INDEX_COPY.newsletter : {}));
  const pagination = data.pagination ?? [];

  return (
    <section className="np-post-list">
      <header className="np-post-list-header">
        {eyebrow ? <span className="np-post-list-eyebrow">{eyebrow}</span> : null}
        <h1>{heading}</h1>
        {intro ? <p className="np-post-list-intro">{intro}</p> : null}
        {categories.length > 0 ? (
          <nav className="np-tax-strip" aria-label="Categories">
            {categories.map((cat, i) => (
              <Link
                key={`cat-${i.toString()}-${cat.label}`}
                href={cat.href ?? "#"}
                data-active={cat.active ? "true" : undefined}
              >
                {cat.label}
                {typeof cat.count === "number" ? (
                  <>
                    <span>·</span>
                    {cat.count}
                  </>
                ) : null}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      {feature ? (
        <div className="np-post-list-feature">
          <PostCard
            doc={feature}
            variant="feature"
            kicker={featureKicker(feature)}
            coverFigure={featureFigure(feature)}
            {...(featureCoverOverlay ? { coverOverlay: featureCoverOverlay } : {})}
            avatarTone={1}
          />
        </div>
      ) : null}

      {rest.length > 0 ? (
        <>
          <div className="np-section-head">
            <h2>Latest</h2>
            {sectionMetaCopy ? (
              <span className="np-section-head-meta">{sectionMetaCopy}</span>
            ) : null}
          </div>
          <ul className="np-post-list-grid">
            {rest.map((post, index) => (
              <li key={post.id ?? post.slug ?? post.title ?? `post-${index.toString()}`}>
                <PostCard
                  doc={post}
                  coverGradient={gridCoverGradient(index)}
                  coverFigure={gridCoverFigure(post, index)}
                  avatarTone={gridAvatarTone(index)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {newsletter ? (
        <section className="np-newsletter-inline" aria-label="Newsletter">
          <div>
            <h3>{newsletter.heading ?? "One post every other Tuesday."}</h3>
            <p>
              {newsletter.body ??
                "Sign up to receive new essays in your inbox. No threads, no roundups, cancel any time."}
            </p>
          </div>
          <form className="np-newsletter-form" action="/api/newsletter" method="POST">
            <label className="sr-only" htmlFor="np-newsletter-email">
              Email address
            </label>
            <input
              id="np-newsletter-email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
            <button type="submit">Subscribe</button>
          </form>
        </section>
      ) : null}

      {pagination.length > 0 ? (
        <nav className="np-pagination" aria-label="Pagination">
          {pagination.map((item, i) => {
            const key = `pag-${i.toString()}-${item.label}`;
            const cls = item.gap
              ? "np-pagination-gap"
              : item.current
                ? "np-pagination-page np-pagination-current"
                : item.disabled
                  ? "np-pagination-step np-pagination-disabled"
                  : item.label.length <= 3 && /^\d+$/.test(item.label)
                    ? "np-pagination-page"
                    : "np-pagination-step";
            if (item.gap || item.disabled || !item.href) {
              return (
                <span key={key} className={cls} aria-disabled={item.disabled ? true : undefined}>
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={key}
                href={item.href}
                className={cls}
                aria-current={item.current ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </section>
  );
}
